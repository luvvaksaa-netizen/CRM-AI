/**
 * @file learning_service.js
 * @description Learning Bot Engine — Continuous Improvement System
 *
 * CARA KERJA:
 *  1. Setiap kali label "Closing" terpasang ke kontak → trigger onClosingDetected()
 *  2. AI menganalisis seluruh percakapan → ekstrak "pola sukses" (teknik, kalimat, konteks)
 *  3. Pola disimpan ke tabel ClosingPatterns (frekuensi naik jika pola sama terulang)
 *  4. Top N pola dinjeksikan ke system prompt AI → bot otomatis adopsi best practice
 *
 * FITUR:
 *  - Auto-detect product type (DTF/UV)
 *  - Quality scoring 1-10 per percakapan
 *  - Dedup pola (sama = naikkan frequency, bukan duplikat)
 *  - Proses dataset offline (.txt files)
 *  - Non-blocking: semua operasi background
 */

'use strict';

const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config');

const openai = new OpenAI({ 
    apiKey: process.env.DEEPSEEK_API_KEY || config.OPENAI_API_KEY,
    baseURL: process.env.DEEPSEEK_API_KEY ? 'https://api.deepseek.com/v1' : undefined
});

// Threshold similarity untuk dedup pola (0.0-1.0)
const SIMILARITY_THRESHOLD = 0.75;

// Max pola per agent yang diinjeksikan ke prompt
const MAX_PATTERNS_INJECT = 6;

// Confidence boost setiap kali pola terulang
const CONFIDENCE_BOOST_PER_REPEAT = 0.08;
const MAX_CONFIDENCE = 0.98;

// Debounce: hindari analisis ganda untuk kontak yang sama dalam 5 menit
const _closingDebounce = new Map();

/**
 * Deteksi jenis produk dari teks percakapan.
 * @param {string} chatText
 * @returns {'dtf'|'uv'|'generic'}
 */
function detectProductType(chatText) {
    const lower = (chatText || '').toLowerCase();
    if (/\buv\b|stiker keras|timbul|botol|helm|tumbler|kaca|ember/.test(lower)) return 'uv';
    if (/\bdtf\b|setrika|baju|kain|seragam|hijab|label nama/.test(lower)) return 'dtf';
    return 'generic';
}

/**
 * Hitung skor kualitas percakapan closing 1-10.
 * Digunakan untuk memilih dataset terbaik dan memfilter noise.
 * @param {string} chatText - Full percakapan
 * @param {object} analysisData - Hasil analisis AI
 * @returns {number} 1-10
 */
function calculateQualityScore(chatText, analysisData = {}) {
    let score = 5; // base

    // Positif: flow lengkap (produk → nama → varian → alamat → ongkir → rekap)
    const hasFlowComplete = /rekap|nota|total.*bayar|pembayaran ke/i.test(chatText);
    if (hasFlowComplete) score += 1.5;

    // Positif: customer konfirmasi
    const hasConfirmation = /iya.*sesuai|sudah sesuai|benar|iya.*betul|ok.*(jalan|kirim)|siap/i.test(chatText);
    if (hasConfirmation) score += 1;

    // Positif: data lengkap (ada nama, alamat, varian)
    const hasCompleteData = /nama penerima/i.test(chatText) && /kecamatan|kec\s*:/i.test(chatText);
    if (hasCompleteData) score += 1;

    // Positif: ada upselling yang ditawarkan
    const hasUpsell = /bundling|back to school|promo/i.test(chatText);
    if (hasUpsell) score += 0.5;

    // Negatif: ada pertanyaan berulang (tanda bot/CS lupa)
    const hasRepeatQuestion = /(nama.*cetak|nama.*label|mau pesan|berapa paket).{0,50}(nama.*cetak|nama.*label|mau pesan|berapa paket)/is.test(chatText);
    if (hasRepeatQuestion) score -= 1.5;

    // Negatif: ada komplain serius
    const hasSeriousComplaint = /ketipu|tidak jadi|cancel|batal|tidak sampai|hilang/i.test(chatText);
    if (hasSeriousComplaint) score -= 2;

    // Negatif: percakapan sangat panjang (>100 pesan = ada masalah)
    const messageCount = (chatText.match(/^\d{2}\/\d{2}\/\d{2}/mg) || []).length;
    if (messageCount > 80) score -= 1;

    // Bonus dari AI analysis score jika ada
    if (analysisData.score && typeof analysisData.score === 'number') {
        score = (score + analysisData.score) / 2; // rata-rata
    }

    return Math.max(1, Math.min(10, Math.round(score * 10) / 10));
}

/**
 * Hitung jumlah pesan dari format chat kita: baris yang dimulai '[Admin' atau '[Customer'
 * @param {string} chatText
 * @returns {number}
 */
function countMessagesUntilClosing(chatText) {
    // Format kita: "[Admin CS | 24 Jun 07:30]:" atau "[Customer | 24 Jun 07:30]:"
    const lines = (chatText || '').split('\n').filter(l => /^\[(Admin|Customer)/i.test(l));
    return lines.length;
}

/**
 * Deteksi metode bayar dari percakapan.
 * @param {string} chatText
 * @returns {'COD'|'Transfer'|null}
 */
function detectPaymentMethod(chatText) {
    if (/pengiriman\s*:\s*cod/i.test(chatText)) return 'COD';
    if (/pengiriman\s*:\s*non.?cod|transfer/i.test(chatText)) return 'Transfer';
    if (/\bcod\b/i.test(chatText) && !/non.?cod/i.test(chatText)) return 'COD';
    return null;
}

/**
 * Panggil OpenAI untuk ekstrak pola sukses dari percakapan closing.
 * Menggunakan model murah gpt-4o-mini dengan response JSON.
 * @param {string} chatText - Full teks percakapan
 * @param {string} productType - 'dtf' | 'uv' | 'generic'
 * @returns {Promise<object>} - { patterns: [], score: number, summary: string }
 */
async function extractPatternsWithAI(chatText, productType) {
    const productContext = productType === 'dtf'
        ? 'Label Nama DTF (bahan setrika untuk baju/kain)'
        : productType === 'uv'
        ? 'Stiker UV DTF timbul keras (untuk benda padat: botol, helm, tumbler)'
        : 'Produk label/stiker';

    const prompt = `Kamu adalah AI analyst untuk sistem CRM penjualan ${productContext}.

Analisis percakapan WhatsApp berikut antara CS toko dan customer. 
Percakapan ini BISA SAJA berujung closing (deal), BISA SAJA BELUM SELESAI, atau batal.
Tugas kamu: 
1. Ekstrak POLA POSITIF / TEKNIK KOMUNIKASI yang dilakukan CS (jika ada) yang membuat customer merespon dengan baik atau meningkatkan persentase (probabilitas) menuju closing. Jika tidak ada yang bagus, biarkan array patterns kosong [].
2. Berikan REKOMENDASI EVOLUSI PROMPT untuk memperbaiki sikap bot AI di masa depan berdasarkan percakapan ini.

KRITERIA POLA YANG BAIK (Ekstrak jika ada):
✅ Kalimat CS yang natural, hangat, dan tidak kaku
✅ Teknik persuasi yang berhasil (bukan hanya mendata)
✅ Cara CS menangani keberatan/pertanyaan customer
✅ Timing yang tepat (misal: kapan kirim katalog, kapan tanya alamat)
✅ Cara penyampaian yang sederhana dan mudah dipahami customer

KRITERIA POLA YANG BURUK (jangan extract):
❌ CS menanyakan ulang data yang sudah diberikan customer
❌ Kalimat template yang robotik/kaku
❌ Respon yang terlalu panjang dan bertele-tele
❌ Salah info produk

FORMAT OUTPUT JSON:
{
  "patterns": [
    {
      "teknik": "nama_teknik_singkat_tanpa_spasi",
      "contoh_kalimat": "Kalimat CS verbatim dari percakapan yang efektif",
      "konteks": "Situasi/kondisi customer saat teknik ini dipakai",
      "dampak": "Apa yang terjadi setelah kalimat ini (customer merespon positif, langsung setuju, dll)"
    }
  ],
  "score": <angka 1-10 kualitas percakapan keseluruhan>,
  "jumlah_pesan": <total pesan dalam percakapan>,
  "alur_lengkap": <true/false — apakah alur produk→nama→varian→alamat→ongkir→rekap terpenuhi>,
  "data_lengkap": <true/false — apakah semua data customer lengkap sebelum rekap>,
  "ada_komplain": <true/false>,
  "metode_bayar": "COD" atau "Transfer" atau null,
  "closing_probability": <angka 0-100 persentase kemungkinan customer ini akan transfer/deal berdasarkan minatnya>,
  "rekomendasi_prompt_ai": {
    "tambah_aturan": "1 aturan spesifik yang HARUS DITAMBAHKAN ke prompt bot AI agar bisa meniru kesuksesan CS manusia ini",
    "buang_kebiasaan": "1 kebiasaan bot yang HARUS DIBUANG agar tidak terlihat kaku/mengganggu (berdasarkan observasi percakapan ini)"
  }
}

PERCAKAPAN:
---
${chatText.slice(0, 8000)}
---

Berikan output JSON yang valid. Extract MAKSIMAL 5 pola terbaik saja.`;

    const response = await openai.chat.completions.create({
        model: config.MODEL_NAME,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 2000
    }, { timeout: 60000 });

    try {
        const { logRequest } = require('./costTracker');
        if (response.usage) {
            logRequest({
                model: config.MODEL_NAME,
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
                endpoint: 'chat_learning',
                functionName: 'extractPatternsWithAI'
            }).catch(() => {});
        }
    } catch (e) {
        // Ignore cost tracker error
    }

    const contentText = response.choices[0]?.message?.content || '{}';
    let parsed = {};
    try {
        parsed = JSON.parse(contentText);
    } catch (e) {
        try {
            // Fallback: extract json array or object if wrapped in markdown
            const match = contentText.match(/\{([\s\S]*)\}/);
            if (match) parsed = JSON.parse(match[0]);
            else {
                const matchArr = contentText.match(/\[([\s\S]*)\]/);
                if (matchArr) parsed = JSON.parse(matchArr[0]);
            }
        } catch (e2) {
            console.error('[Learning] Fallback JSON parse gagal:', e2.message);
        }
    }
    return parsed;
}

/**
 * Mengevaluasi chat manual yang sedang idle (CS manusia membalas).
 * Sama seperti onClosingDetected, tapi hanya berjalan untuk interaksi manual.
 */
async function onManualChatIdle(storeWaId, contactId, agentId) {
    const cacheKey = `${storeWaId}:${contactId}_idle`;
    if (_closingDebounce.has(cacheKey)) {
        clearTimeout(_closingDebounce.get(cacheKey));
    }
    
    const timer = setTimeout(async () => {
        _closingDebounce.delete(cacheKey);
        try {
            await _runClosingAnalysis({ storeWaId, contactId, agentId, sourceType: 'manual_idle' });
        } catch (e) {
            logger.warn(`[Learning] Error evaluasi manual idle: ${e.message}`);
        }
    }, 5 * 60 * 1000); // 5 menit debounce (tunggu chat benar-benar idle)
    
    _closingDebounce.set(cacheKey, timer);
}

/**
 * Simpan/update satu pola ke ClosingPatterns.
 * Jika pola serupa sudah ada → naikkan frequency & confidence.
 * Jika baru → buat entry baru.
 * @param {object} pattern - { teknik, contoh_kalimat, konteks, dampak }
 * @param {object} meta - { agentId, productType, sourceType, sourceFile }
 */
async function saveOrUpdatePattern(pattern, meta = {}) {
    const { ClosingPattern } = require('../models/index');

    const { teknik, contoh_kalimat, konteks, dampak } = pattern;
    const { agentId, productType, sourceType, sourceFile } = meta;

    if (!teknik || !contoh_kalimat) return null;

    try {
        // Cari pola yang sama/serupa berdasarkan nama teknik + agent
        const existing = await ClosingPattern.findOne({
            where: {
                agent_id: agentId || null,
                teknik: teknik.toLowerCase().trim()
            }
        });

        if (existing) {
            // Update: naikkan frequency dan confidence
            existing.frequency = (existing.frequency || 1) + 1;
            existing.confidence = Math.min(MAX_CONFIDENCE,
                (existing.confidence || 0.5) + CONFIDENCE_BOOST_PER_REPEAT
            );
            existing.last_seen_at = new Date();
            // Update contoh kalimat jika lebih panjang/lebih baik
            if (contoh_kalimat && contoh_kalimat.length > (existing.contoh_kalimat || '').length) {
                existing.contoh_kalimat = contoh_kalimat;
            }
            await existing.save();
            logger.info(`[Learning] ✅ Pattern "${teknik}" diperbarui (freq: ${existing.frequency}, conf: ${existing.confidence.toFixed(2)})`);
            return existing;
        } else {
            // Buat baru
            const newPattern = await ClosingPattern.create({
                agent_id: agentId || null,
                product_type: productType || 'generic',
                teknik: teknik.toLowerCase().trim(),
                contoh_kalimat,
                konteks,
                dampak,
                frequency: 1,
                confidence: 0.55,
                is_active: true,
                source_type: sourceType || 'auto',
                source_file: sourceFile || null,
                last_seen_at: new Date()
            });
            logger.info(`[Learning] ✨ Pattern baru "${teknik}" tersimpan (agent: ${agentId})`);
            return newPattern;
        }
    } catch (err) {
        logger.warn(`[Learning] Gagal simpan pattern "${teknik}": ${err.message}`);
        return null;
    }
}

/**
 * Simpan hasil analisis ke ClosingAnalytics.
 * @param {object} data
 */
async function saveAnalytic(data) {
    const { ClosingAnalytic } = require('../models/index');
    try {
        await ClosingAnalytic.create({
            store_wa_id: data.storeWaId || null,
            contact_id: data.contactId || null,
            agent_id: data.agentId || null,
            product_type: data.productType || 'generic',
            conversation_score: data.score || 0,
            pesan_sampai_closing: data.messageCount || 0,
            metode_bayar: data.metodeBayar || null,
            alur_lengkap: data.alurLengkap || false,
            data_lengkap: data.dataLengkap || false,
            ada_komplain: data.adaKomplain || false,
            closing_probability: data.closingProbability !== undefined ? data.closingProbability : null,
            patterns_extracted: data.patternsExtracted || 0,
            analysis_json: data.analysisJson || null,
            source_type: data.sourceType || 'production',
            source_file: data.sourceFile || null,
            analyzed_at: new Date()
        });
    } catch (err) {
        logger.warn(`[Learning] Gagal simpan analytic: ${err.message}`);
    }
}


/**
 * ENTRY POINT — Dipanggil saat label "Closing" terpasang pada kontak.
 * Berjalan di background (non-blocking).
 *
 * @param {string} storeWaId
 * @param {string} contactId
 * @param {number|null} agentId
 */
async function onClosingDetected(storeWaId, contactId, agentId = null) {
    const debounceKey = `${storeWaId}_${contactId}`;

    // Debounce: jangan proses 2x dalam 5 menit untuk kontak yang sama
    if (_closingDebounce.has(debounceKey)) {
        logger.info(`[Learning] [${contactId}] Debounce aktif — skip analisis ganda.`);
        return;
    }
    _closingDebounce.set(debounceKey, true);
    setTimeout(() => _closingDebounce.delete(debounceKey), 5 * 60 * 1000);

    // Jalankan analisis di background
    _runClosingAnalysis({ storeWaId, contactId, agentId, sourceType: 'production' })
        .catch(e => logger.warn(`[Learning] Background analysis error: ${e.message}`));
}

/**
 * Analisis percakapan closing dan simpan hasilnya.
 * Dipanggil oleh onClosingDetected() dan processDatasetFile().
 * @param {object} opts
 */
async function _runClosingAnalysis({ storeWaId, contactId, agentId, chatText, sourceType, sourceFile }) {
    try {
        let fullChatText = chatText;

        // Jika tidak ada chatText (production mode), ambil dari DB
        if (!fullChatText && storeWaId && contactId) {
            const { ChatMessage } = require('../models/index');
            const messages = await ChatMessage.findAll({
                where: { store_wa_id: storeWaId, contact_id: contactId },
                order: [['timestamp', 'ASC']],
                limit: 200
            });
            if (messages.length < 5) {
                logger.info(`[Learning] Percakapan [${contactId}] terlalu pendek (${messages.length} msg). Skip.`);
                return;
            }
            // Format natural — agar AI mudah mengenali pola percakapan dan menghitung pesan
            fullChatText = messages.map(m => {
                const who = m.is_from_me ? 'Admin CS' : 'Customer';
                const ts = new Date(m.timestamp);
                const dateStr = `${ts.getDate()} ${['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'][ts.getMonth()]} ${String(ts.getHours()).padStart(2,'0')}:${String(ts.getMinutes()).padStart(2,'0')}`;
                return `[${who} | ${dateStr}]: ${m.body || '(media/voice)'}`;
            }).join('\n');
        }

        if (!fullChatText || fullChatText.length < 200) {
            logger.info(`[Learning] Percakapan terlalu pendek, skip.`);
            return;
        }

        const productType = detectProductType(fullChatText);
        logger.info(`[Learning] Menganalisis percakapan [${contactId || sourceFile}], Tipe: ${productType}`);

        // Panggil AI untuk ekstrak pola
        const analysis = await extractPatternsWithAI(fullChatText, productType);

        // Simpan probability ke ChatSummary
        if (analysis && analysis.closing_probability !== undefined && storeWaId && contactId) {
            try {
                const { ChatSummary } = require('../models/index');
                const summary = await ChatSummary.findOne({ where: { store_wa_id: storeWaId, contact_id: contactId } });
                if (summary) {
                    let oldSummary = summary.summary || '';
                    // Remove old probability line if exists
                    oldSummary = oldSummary.replace(/\n\n\[Analisis AI: Probabilitas Closing \d+%\]/g, '');
                    summary.summary = oldSummary + `\n\n[Analisis AI: Probabilitas Closing ${analysis.closing_probability}%]`;
                    await summary.save();
                }
            } catch (sumErr) {
                logger.warn(`[Learning] Gagal update ChatSummary: ${sumErr.message}`);
            }
        }

        const patterns = analysis.patterns || [];

        // Hitung score akhir
        const finalScore = calculateQualityScore(fullChatText, analysis);
        const messageCount = analysis.jumlah_pesan || countMessagesUntilClosing(fullChatText);
        const metodeBayar = analysis.metode_bayar || detectPaymentMethod(fullChatText);

        logger.info(`[Learning] 📊 Score: ${finalScore}/10, Pesan: ${messageCount}, Pola: ${patterns.length}`);

        // ─────────────────────────────────────────────────────────────
        // (UPDATE): Sesuai request, semua pola yang berhasil diekstrak AI
        // tetap disimpan meskipun skornya rendah atau alur tidak lengkap,
        // asalkan AI memang menemukan poin pembelajaran yang berguna.
        // ─────────────────────────────────────────────────────────────
        const isQualified = true; // Selalu luluskan untuk mengambil pembelajaran

        // Tetap simpan analytic record untuk monitoring (sebelum pattern extraction)
        await saveAnalytic({
            storeWaId, contactId, agentId, productType,
            score: finalScore, messageCount, metodeBayar,
            alurLengkap: analysis.alur_lengkap || false,
            dataLengkap: analysis.data_lengkap || false,
            adaKomplain: analysis.ada_komplain || false,
            closingProbability: analysis.closing_probability || null,
            patternsExtracted: patterns.length,
            analysisJson: JSON.stringify(analysis),
            sourceType: sourceType || 'production',
            sourceFile: sourceFile || null
        });

        if (patterns.length === 0) {
             logger.info(`[Learning] Tidak ada pola yang diekstrak untuk [${contactId || sourceFile || 'dataset'}].`);
             return;
        }

        logger.info(`[Learning] ✅ Quality Gate LULUS (Score: ${finalScore}/10) — mulai simpan ${patterns.length} pola.`);

        // Simpan setiap pola ke DB
        let savedCount = 0;
        for (const pattern of patterns) {
            const saved = await saveOrUpdatePattern(pattern, {
                agentId, productType,
                sourceType: sourceType || 'production',
                sourceFile: sourceFile || null
            });
            if (saved) savedCount++;
        }

        // Update analytic dengan jumlah pola yang benar-benar tersimpan
        await saveAnalytic({
            storeWaId, contactId, agentId, productType,
            score: finalScore,
            messageCount,
            metodeBayar,
            alurLengkap: analysis.alur_lengkap || false,
            dataLengkap: analysis.data_lengkap || false,
            adaKomplain: analysis.ada_komplain || false,
            closingProbability: analysis.closing_probability || null,
            patternsExtracted: savedCount,
            analysisJson: JSON.stringify(analysis),
            sourceType: sourceType || 'production',
            sourceFile: sourceFile || null
        });

        logger.info(`[Learning] ✅ Analisis selesai: ${savedCount} pola tersimpan (score: ${finalScore}/10, prob: ${analysis.closing_probability || '?'}%)`);

    } catch (err) {
        logger.warn(`[Learning] Gagal analisis closing: ${err.message}`);
    }
}

/**
 * Proses satu file dataset offline (.txt) dan ekstrak polanya.
 * @param {string} filePath - Absolute path ke file .txt
 * @param {number|null} agentId
 */
async function processDatasetFile(filePath, agentId = null) {
    try {
        if (!fs.existsSync(filePath)) {
            logger.warn(`[Learning] File tidak ditemukan: ${filePath}`);
            return { success: false, error: 'File tidak ditemukan' };
        }

        const chatText = fs.readFileSync(filePath, 'utf8');
        const fileName = path.basename(filePath);

        logger.info(`[Learning] 📂 Memproses dataset: ${fileName} (${chatText.length} chars)`);

        await _runClosingAnalysis({
            storeWaId: null,
            contactId: null,
            agentId,
            chatText,
            sourceType: 'dataset',
            sourceFile: fileName
        });

        return { success: true, fileName };

    } catch (err) {
        logger.warn(`[Learning] Gagal proses dataset ${path.basename(filePath)}: ${err.message}`);
        return { success: false, error: err.message };
    }
}

/**
 * Ambil top N pola terbaik untuk diinjeksikan ke prompt AI.
 * Dipanggil oleh ai_service.js setiap kali membangun prompt.
 * @param {number|null} agentId
 * @param {string} productType - 'dtf' | 'uv' | 'generic'
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function getTopPatterns(agentId, productType = 'generic', limit = MAX_PATTERNS_INJECT) {
    const { ClosingPattern } = require('../models/index');
    const { Op } = require('sequelize');

    try {
        const whereClause = {
            is_active: true,
            confidence: { [Op.gte]: 0.5 }
        };

        // Filter per agent (atau ambil semua jika tidak ada agentId)
        if (agentId) {
            whereClause.agent_id = agentId;
        }

        // Prioritas: product type yang matching, fallback ke generic
        if (productType && productType !== 'generic') {
            whereClause.product_type = { [Op.in]: [productType, 'generic'] };
        }

        const patterns = await ClosingPattern.findAll({
            where: whereClause,
            order: [
                ['confidence', 'DESC'],
                ['frequency', 'DESC'],
                ['last_seen_at', 'DESC']
            ],
            limit
        });

        return patterns.map(p => p.get({ plain: true }));
    } catch (err) {
        logger.warn(`[Learning] Gagal ambil top patterns: ${err.message}`);
        return [];
    }
}

/**
 * Ambil statistik ringkas untuk dashboard.
 * @param {number|null} agentId
 * @returns {Promise<object>}
 */
async function getLearningStats(agentId = null) {
    const { ClosingPattern, ClosingAnalytic, sequelize } = require('../models/index');
    const { Op } = require('sequelize');

    try {
        const whereAgent = agentId ? { agent_id: agentId } : {};

        const totalPatterns = await ClosingPattern.count({ where: { ...whereAgent, is_active: true } });
        const totalAnalytics = await ClosingAnalytic.count({ where: whereAgent });

        const avgScore = await ClosingAnalytic.findOne({
            attributes: [[sequelize.fn('AVG', sequelize.col('conversation_score')), 'avg_score']],
            where: whereAgent,
            raw: true
        });

        // Analitik 7 hari terakhir
        const since7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const recentAnalytics = await ClosingAnalytic.findAll({
            where: { ...whereAgent, analyzed_at: { [Op.gte]: since7Days } },
            order: [['analyzed_at', 'DESC']],
            limit: 10
        });

        const avgScoreLast7 = recentAnalytics.length > 0
            ? recentAnalytics.reduce((s, a) => s + (a.conversation_score || 0), 0) / recentAnalytics.length
            : 0;

        // Top patterns untuk display
        const topPatterns = await ClosingPattern.findAll({
            where: { ...whereAgent, is_active: true },
            order: [['confidence', 'DESC'], ['frequency', 'DESC']],
            limit: 10
        });

        // Analitik breakdown: dataset vs production
        const datasetCount = await ClosingAnalytic.count({ where: { ...whereAgent, source_type: 'dataset' } });
        const productionCount = await ClosingAnalytic.count({ where: { ...whereAgent, source_type: 'production' } });

        return {
            totalPatterns,
            totalAnalytics,
            datasetCount,
            productionCount,
            avgScore: Math.round((avgScore?.avg_score || 0) * 10) / 10,
            avgScoreLast7Days: Math.round(avgScoreLast7 * 10) / 10,
            topPatterns: topPatterns.map(p => ({
                id: p.id,
                teknik: p.teknik,
                contoh_kalimat: p.contoh_kalimat,
                konteks: p.konteks,
                dampak: p.dampak,
                frequency: p.frequency,
                confidence: Math.round(p.confidence * 100),
                product_type: p.product_type,
                source_type: p.source_type,
                source_file: p.source_file,
                is_active: p.is_active,
                last_seen_at: p.last_seen_at
            })),
            recentAnalytics: recentAnalytics.map(a => ({
                id: a.id,
                product_type: a.product_type,
                conversation_score: a.conversation_score,
                pesan_sampai_closing: a.pesan_sampai_closing,
                metode_bayar: a.metode_bayar,
                alur_lengkap: a.alur_lengkap,
                data_lengkap: a.data_lengkap,
                ada_komplain: a.ada_komplain,
                patterns_extracted: a.patterns_extracted,
                source_type: a.source_type,
                source_file: a.source_file,
                analyzed_at: a.analyzed_at
            }))
        };
    } catch (err) {
        logger.warn(`[Learning] Gagal ambil stats: ${err.message}`);
        return { totalPatterns: 0, totalAnalytics: 0, topPatterns: [], recentAnalytics: [] };
    }
}

/**
 * Toggle aktif/nonaktif satu pattern (untuk kontrol manual dari dashboard).
 * @param {number} patternId
 * @param {boolean} isActive
 */
async function togglePattern(patternId, isActive) {
    const { ClosingPattern } = require('../models/index');
    try {
        const pattern = await ClosingPattern.findByPk(patternId);
        if (!pattern) return { success: false, error: 'Pattern tidak ditemukan' };
        pattern.is_active = isActive;
        await pattern.save();
        return { success: true, pattern: pattern.get({ plain: true }) };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Build learning section untuk diinjeksikan ke system prompt AI.
 * Dipanggil di ai_service.js saat membangun fullSystemInstruction.
 * @param {number|null} agentId
 * @param {string} productType
 * @returns {Promise<string>}
 */
async function buildLearningPromptSection(agentId, productType = 'generic') {
    const { BotAgent } = require('../models/index');

    // 1. Prioritas: Gunakan learned_prompt_addon yang sudah direvisi AI jika tersedia
    //    Ini adalah "hasil akhir" yang sudah dipadatkan dan dioptimasi oleh Prompt Revision Engine.
    if (agentId) {
        try {
            const agent = await BotAgent.findByPk(agentId, { attributes: ['learned_prompt_addon'] });
            if (agent?.learned_prompt_addon && agent.learned_prompt_addon.trim().length > 50) {
                return `\n═══════════════════════════════════════════\nINSTRUKSI TAMBAHAN (Hasil Pembelajaran Otomatis dari CS Nyata):\n═══════════════════════════════════════════\n${agent.learned_prompt_addon.trim()}\n⚡ Instruksi di atas wajib dipatuhi sebagai pelengkap sistem prompt utama.\n`;
            }
        } catch (e) { /* Jika gagal baca, fallback ke raw patterns */ }
    }

    // 2. Fallback: Belum ada learned_prompt_addon → bangun dari raw patterns (mode awal)
    const patterns = await getTopPatterns(agentId, productType, MAX_PATTERNS_INJECT);
    const refinements = await getRecentPromptRefinements(agentId, 3);

    if (patterns.length === 0 && refinements.length === 0) {
        return ''; // Tidak ada pattern & refinement — jangan inject section kosong
    }

    let patternText = '';
    if (patterns.length > 0) {
        patternText = `
═══════════════════════════════════════════
TEKNIK TERBUKTI DARI PERCAKAPAN SUKSES:
(Dipelajari otomatis dari closing nyata CS — wajib diadopsi!)
═══════════════════════════════════════════
` + patterns.map((p, i) => {
            const freq = p.frequency || 1;
            const conf = Math.round((p.confidence || 0.5) * 100);
            return [
                `${i + 1}. [Teknik: ${p.teknik}] (Terbukti ${freq}x, Kepercayaan: ${conf}%)`,
                `   Contoh: "${p.contoh_kalimat}"`,
                p.konteks ? `   Kapan dipakai: ${p.konteks}` : null,
                p.dampak ? `   Efeknya: ${p.dampak}` : null
            ].filter(Boolean).join('\n');
        }).join('\n\n') + `\n\n⚡ INSTRUKSI: Gunakan teknik-teknik di atas sebagai referensi cara menjawab. Adaptasi secara natural ke konteks percakapan saat ini. Jangan copy-paste verbatim.`;
    }

    let refinementText = '';
    if (refinements.length > 0) {
        refinementText = `
═══════════════════════════════════════════
EVALUASI & PERBAIKAN SIKAP BOT (Dari Observasi CS Manusia):
═══════════════════════════════════════════
` + refinements.map((r, i) => {
            return `* REKOMENDASI ${i + 1}:\n  (+) TAMBAHKAN ATURAN: "${r.tambah_aturan}"\n  (-) BUANG KEBIASAAN: "${r.buang_kebiasaan}"`;
        }).join('\n\n') + `\n\n⚡ INSTRUKSI: Patuhi evaluasi di atas. Jadikan evaluasi ini sebagai koreksi mutlak terhadap caramu berinteraksi!`;
    }

    return [patternText, refinementText].filter(Boolean).join('\n\n').trim();
}

/**
 * Mengambil rekomendasi evolusi prompt terbaru dari hasil analisis AI.
 * @param {number|null} agentId 
 * @param {number} limit 
 * @returns {Promise<Array>} Array of { tambah_aturan, buang_kebiasaan }
 */
async function getRecentPromptRefinements(agentId, limit = 3) {
    const { ClosingAnalytic } = require('../models/index');
    const { Op } = require('sequelize');

    try {
        const whereClause = {
            conversation_score: { [Op.gte]: 7 } // Hanya ambil dari closing yang berkualitas baik
        };
        if (agentId) whereClause.agent_id = agentId;

        const analytics = await ClosingAnalytic.findAll({
            where: whereClause,
            order: [['analyzed_at', 'DESC']],
            limit: limit * 3 // Fetch lebih banyak untuk difilter di memory
        });

        const refinements = [];
        for (const a of analytics) {
            if (refinements.length >= limit) break;
            try {
                const analysis = typeof a.analysis_json === 'string' ? JSON.parse(a.analysis_json) : (a.analysis_json || {});
                if (analysis.rekomendasi_prompt_ai && analysis.rekomendasi_prompt_ai.tambah_aturan) {
                    refinements.push(analysis.rekomendasi_prompt_ai);
                }
            } catch (e) { /* ignore parse error */ }
        }
        return refinements;
    } catch (err) {
        logger.warn(`[Learning] Gagal ambil prompt refinements: ${err.message}`);
        return [];
    }
}

module.exports = {
    onClosingDetected,
    onManualChatIdle,
    processDatasetFile,
    getTopPatterns,
    getLearningStats,
    togglePattern,
    buildLearningPromptSection,
    detectProductType,
    // Expose untuk seed script
    _runClosingAnalysis,
    saveOrUpdatePattern,
    saveAnalytic
};
