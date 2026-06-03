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

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

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
 * Hitung jumlah pesan sampai closing.
 * @param {string} chatText
 * @returns {number}
 */
function countMessagesUntilClosing(chatText) {
    const lines = (chatText || '').split('\n').filter(l => /^\d{2}\/\d{2}\/\d{2}/.test(l));
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

Analisis percakapan WhatsApp closing berikut antara CS toko (Label Nama CS Dea / Admin Dea) dan customer.
Tugas kamu: ekstrak POLA SUKSES yang membuat customer akhirnya deal/order.

KRITERIA POLA YANG BAIK:
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
  "catatan_perbaikan": "Apa yang bisa diperbaiki dari percakapan ini untuk performa lebih baik"
}

PERCAKAPAN:
---
${chatText.slice(0, 8000)}
---

Berikan output JSON yang valid. Extract MAKSIMAL 5 pola terbaik saja.`;

    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 2000
    }, { timeout: 30000 });

    const content = response.choices[0]?.message?.content || '{}';
    return JSON.parse(content);
}

/**
 * Simpan/update satu pola ke ClosingPatterns.
 * Jika pola serupa sudah ada → naikkan frequency & confidence.
 * Jika baru → buat entry baru.
 * @param {object} pattern - { teknik, contoh_kalimat, konteks, dampak }
 * @param {object} meta - { agentId, productType, sourceType, sourceFile }
 */
async function saveOrUpdatePattern(pattern, meta = {}) {
    const { ClosingPattern } = require('../database/index');

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
    const { ClosingAnalytic } = require('../database/index');
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
            const { ChatMessage } = require('../database/index');
            const messages = await ChatMessage.findAll({
                where: { store_wa_id: storeWaId, contact_id: contactId },
                order: [['timestamp', 'ASC']],
                limit: 200
            });
            if (messages.length < 3) {
                logger.info(`[Learning] [${contactId}] Terlalu sedikit pesan (${messages.length}), skip.`);
                return;
            }
            fullChatText = messages.map(m => {
                const who = m.is_from_me ? 'CS' : 'Customer';
                return `${who}: ${m.body || ''}`;
            }).join('\n');
        }

        if (!fullChatText || fullChatText.length < 200) {
            logger.info(`[Learning] Percakapan terlalu pendek, skip.`);
            return;
        }

        const productType = detectProductType(fullChatText);
        logger.info(`[Learning] 🔍 Menganalisis closing${contactId ? ' [' + contactId + ']' : ''}... Produk: ${productType}`);

        // Panggil AI untuk ekstrak pola
        const analysis = await extractPatternsWithAI(fullChatText, productType);
        const patterns = analysis.patterns || [];

        // Hitung score akhir
        const finalScore = calculateQualityScore(fullChatText, analysis);
        const messageCount = analysis.jumlah_pesan || countMessagesUntilClosing(fullChatText);
        const metodeBayar = analysis.metode_bayar || detectPaymentMethod(fullChatText);

        logger.info(`[Learning] 📊 Score: ${finalScore}/10, Pesan: ${messageCount}, Pola: ${patterns.length}`);

        // ─────────────────────────────────────────────────────────────
        // QUALITY GATE: Hanya simpan pola jika percakapan benar-benar
        // merupakan closing yang valid dan berkualitas tinggi.
        //
        // Syarat WAJIB (semua harus terpenuhi):
        //  1. Score ≥ 6.0  → kualitas percakapan cukup baik
        //  2. alur_lengkap = true → alur produk→nama→alamat→ongkir→rekap ada
        //  3. data_lengkap = true → semua data customer terpenuhi sebelum rekap
        //
        // Jika tidak memenuhi → catat analytic (untuk statistik) tapi
        // JANGAN simpan pola agar bot tidak belajar dari closing palsu/tidak lengkap.
        // ─────────────────────────────────────────────────────────────
        const MINIMUM_QUALITY_SCORE = 6.0;
        const isQualified = finalScore >= MINIMUM_QUALITY_SCORE
                         && analysis.alur_lengkap === true
                         && analysis.data_lengkap === true;

        if (!isQualified) {
            logger.warn(
                `[Learning] ⛔ Quality Gate GAGAL untuk [${contactId || sourceFile || 'dataset'}]. ` +
                `Score: ${finalScore}/10, alur_lengkap: ${analysis.alur_lengkap}, data_lengkap: ${analysis.data_lengkap}. ` +
                `Pola TIDAK disimpan untuk mencegah bot belajar dari data tidak valid.`
            );
            // Tetap simpan analytic record untuk monitoring — tapi tandai sebagai "rejected"
            await saveAnalytic({
                storeWaId, contactId, agentId, productType,
                score: finalScore, messageCount, metodeBayar,
                alurLengkap: analysis.alur_lengkap || false,
                dataLengkap: analysis.data_lengkap || false,
                adaKomplain: analysis.ada_komplain || false,
                patternsExtracted: 0, // 0 karena ditolak
                analysisJson: JSON.stringify({ ...analysis, quality_gate_rejected: true, rejection_reason: `score:${finalScore}<${MINIMUM_QUALITY_SCORE} alur:${analysis.alur_lengkap} data:${analysis.data_lengkap}` }),
                sourceType: sourceType || 'production',
                sourceFile: sourceFile || null
            });
            return; // Hentikan proses — tidak ada yang disimpan ke ClosingPatterns
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

        // Simpan analytic record
        await saveAnalytic({
            storeWaId, contactId, agentId, productType,
            score: finalScore,
            messageCount,
            metodeBayar,
            alurLengkap: analysis.alur_lengkap || false,
            dataLengkap: analysis.data_lengkap || false,
            adaKomplain: analysis.ada_komplain || false,
            patternsExtracted: savedCount,
            analysisJson: JSON.stringify(analysis),
            sourceType: sourceType || 'production',
            sourceFile: sourceFile || null
        });

        logger.info(`[Learning] ✅ Analisis selesai: ${savedCount} pola tersimpan (score: ${finalScore}/10)`);

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
    const { ClosingPattern } = require('../database/index');
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
    const { ClosingPattern, ClosingAnalytic, sequelize } = require('../database/index');
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
    const { ClosingPattern } = require('../database/index');
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
    const patterns = await getTopPatterns(agentId, productType, MAX_PATTERNS_INJECT);

    if (patterns.length === 0) {
        return ''; // Tidak ada pattern — jangan inject section kosong
    }

    const patternText = patterns.map((p, i) => {
        const freq = p.frequency || 1;
        const conf = Math.round((p.confidence || 0.5) * 100);
        return [
            `${i + 1}. [Teknik: ${p.teknik}] (Terbukti ${freq}x, Kepercayaan: ${conf}%)`,
            `   Contoh: "${p.contoh_kalimat}"`,
            p.konteks ? `   Kapan dipakai: ${p.konteks}` : null,
            p.dampak ? `   Efeknya: ${p.dampak}` : null
        ].filter(Boolean).join('\n');
    }).join('\n\n');

    return `
═══════════════════════════════════════════
TEKNIK TERBUKTI DARI PERCAKAPAN SUKSES:
(Dipelajari otomatis dari closing nyata CS Mbak Dea — wajib diadopsi!)
═══════════════════════════════════════════
${patternText}

⚡ INSTRUKSI: Gunakan teknik-teknik di atas sebagai referensi cara menjawab.
Adaptasi secara natural ke konteks percakapan saat ini. Jangan copy-paste verbatim.
`.trim();
}

module.exports = {
    onClosingDetected,
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
