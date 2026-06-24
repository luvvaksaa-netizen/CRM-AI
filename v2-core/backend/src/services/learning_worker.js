/**
 * @file learning_worker.js
 * @description Isolated Learning Worker — Background Queue Processor
 *
 * ARSITEKTUR:
 *  - message_handler hanya memanggil pushLearningJob() [non-blocking, <1ms]
 *  - Worker loop berjalan setiap 5 detik di background
 *  - Satu job diproses per giliran (mencegah overload API)
 *  - Setelah N analisis, otomatis merevisi prompt agent (bukan menambah terus)
 *  - Hasil revisi disimpan ke PromptEvolutionLog untuk UI tab "Evolusi Prompt"
 *
 * JAMINAN:
 *  - Zero blocking ke main message handler
 *  - Error di worker TIDAK pernah crash server
 *  - Graceful shutdown support
 */

'use strict';

const logger = require('../utils/logger');

// ─── Konfigurasi ────────────────────────────────────────────────────────────
const WORKER_TICK_MS        = 5000;   // Cek antrian setiap 5 detik
const IDLE_DEBOUNCE_MS      = 5 * 60 * 1000; // 5 menit idle sebelum analisis
const DEDUP_WINDOW_MS       = 10 * 60 * 1000; // Kontak yang sama tidak dianalisis 2x dalam 10 menit
const REVISION_EVERY_N_JOBS = 5;     // Setiap 5 analisis selesai → revisi prompt agent
const MAX_PATTERNS_INJECT   = 8;     // Maks pola yang dibaca saat revisi
const MAX_QUEUE_SIZE        = 200;   // Batas atas antrian agar tidak memori bocor

// ─── State Internal ──────────────────────────────────────────────────────────
const _queue      = [];              // Job queue: [{ storeWaId, contactId, agentId, queuedAt }]
const _dedup      = new Map();       // Dedup tracker: "storeWaId:contactId" → timestamp
const _debounce   = new Map();       // Debounce timers: "storeWaId:contactId" → timerRef
const _revisionCount = new Map();   // Tracking per agentId: berapa analisis sejak revisi terakhir

let _workerTimer  = null;            // Referensi setInterval worker
let _isRunning    = false;           // Flag agar tidak proses ganda
let _isShutdown   = false;           // Flag graceful shutdown

/**
 * Antrekan job analisis untuk sebuah kontak.
 * Dipanggil dari message_handler.js setiap kali ada pesan masuk/keluar.
 * NON-BLOCKING — hanya push ke array, langsung return.
 *
 * @param {object} job - { storeWaId, contactId, agentId }
 */
function pushLearningJob(job) {
    if (_isShutdown) return;
    if (!job?.storeWaId || !job?.contactId) return;

    const key = `${job.storeWaId}:${job.contactId}`;

    // Reset debounce timer — tunggu chat benar-benar idle 5 menit
    if (_debounce.has(key)) {
        clearTimeout(_debounce.get(key));
    }

    const timer = setTimeout(() => {
        _debounce.delete(key);

        // Cek apakah kontak ini sudah dianalisis baru-baru ini
        const lastRun = _dedup.get(key);
        if (lastRun && (Date.now() - lastRun) < DEDUP_WINDOW_MS) {
            return; // Skip — terlalu baru
        }

        // Cek batas ukuran antrian
        if (_queue.length >= MAX_QUEUE_SIZE) {
            logger.warn('[LearningWorker] Queue penuh, job dibuang untuk mencegah memory leak.');
            return;
        }

        // Cek duplikat dalam antrian
        const alreadyQueued = _queue.some(q => q.storeWaId === job.storeWaId && q.contactId === job.contactId);
        if (!alreadyQueued) {
            _queue.push({ ...job, queuedAt: Date.now() });
        }
    }, IDLE_DEBOUNCE_MS);

    _debounce.set(key, timer);
}

/** Format contactId menjadi nomor manusiawi untuk log (hilangkan @lid/@c.us) */
function _formatId(contactId) {
    if (!contactId) return '?';
    if (contactId.endsWith('@c.us')) return `+${contactId.replace('@c.us', '')}`;
    if (contactId.endsWith('@lid')) {
        const digits = contactId.replace('@lid', '').replace(/\D/g, '');
        return `LID-${digits.slice(-6) || '?'}`;
    }
    return contactId;
}

/**
 * Proses satu job dari antrian.
 * Dipanggil oleh worker loop.
 */
async function _processNextJob() {
    if (_queue.length === 0 || _isRunning) return;

    _isRunning = true;
    const job = _queue.shift();
    const key = `${job.storeWaId}:${job.contactId}`;

    try {
        logger.info(`[LearningWorker] 🔄 Memproses job: [${job.storeWaId}] kontak [${_formatId(job.contactId)}]`);

        // Tandai sebagai sedang diproses (dedup)
        _dedup.set(key, Date.now());
        // Bersihkan dedup setelah window berlalu
        setTimeout(() => _dedup.delete(key), DEDUP_WINDOW_MS);

        // Jalankan analisis closing
        const learningService = require('./learning_service');
        await learningService._runClosingAnalysis({
            storeWaId: job.storeWaId,
            contactId: job.contactId,
            agentId: job.agentId || null,
            sourceType: 'manual_idle'
        });

        logger.info(`[LearningWorker] ✅ Analisis selesai untuk [${job.contactId}]`);

        // Hitung berapa analisis untuk agent ini sejak revisi terakhir
        const agentKey = String(job.agentId || 'global');
        const count = (_revisionCount.get(agentKey) || 0) + 1;
        _revisionCount.set(agentKey, count);

        // Setiap N analisis → trigger revisi prompt
        if (count >= REVISION_EVERY_N_JOBS) {
            _revisionCount.set(agentKey, 0);
            // Jalankan revisi di background, tidak block job berikutnya
            _reviseAgentPrompt(job.agentId).catch(e =>
                logger.warn(`[LearningWorker] Revisi prompt gagal: ${e.message}`)
            );
        }

    } catch (err) {
        logger.warn(`[LearningWorker] ❌ Error memproses job [${key}]: ${err.message}`);
    } finally {
        _isRunning = false;
    }
}

/**
 * Revisi Prompt Agent secara cerdas.
 * Bukan hanya menambah — AI membaca prompt lama + pola terbaru,
 * lalu menulis ulang versi yang lebih ringkas dan powerful.
 *
 * @param {number|null} agentId
 */
async function _reviseAgentPrompt(agentId) {
    const { BotAgent, ClosingPattern, PromptEvolutionLog } = require('../models/index');
    const { logRequest } = require('./costTracker');
    const OpenAI = require('openai');
    const config = require('../config');

    logger.info(`[LearningWorker] 🧠 Memulai revisi prompt untuk agent [${agentId || 'global'}]`);

    try {
        // 1. Ambil data agent
        const agent = agentId ? await BotAgent.findByPk(agentId) : null;
        if (!agent && agentId) {
            logger.warn(`[LearningWorker] Agent [${agentId}] tidak ditemukan, skip revisi.`);
            return;
        }

        const currentSystemPrompt   = agent?.system_prompt || '';
        const currentProductKnow    = agent?.product_knowledge || '';
        const currentLearnedAddon   = agent?.learned_prompt_addon || '';

        // 2. Ambil top patterns terbaru
        const whereClause = agentId ? { agent_id: agentId, is_active: true } : { is_active: true };
        const topPatterns = await ClosingPattern.findAll({
            where: whereClause,
            order: [['confidence', 'DESC'], ['frequency', 'DESC']],
            limit: MAX_PATTERNS_INJECT
        });

        if (topPatterns.length === 0) {
            logger.info(`[LearningWorker] Tidak ada pola untuk digunakan dalam revisi agent [${agentId}].`);
            return;
        }

        const patternsText = topPatterns.map((p, i) => (
            `${i + 1}. Teknik: "${p.teknik}" | Contoh: "${p.contoh_kalimat}" | Konteks: "${p.konteks || '-'}" | Frekuensi: ${p.frequency}x | Kepercayaan: ${Math.round((p.confidence || 0.5) * 100)}%`
        )).join('\n');

        // 3. Prompt ke AI untuk revisi cerdas
        const revisionPrompt = `Kamu adalah AI Prompt Engineer untuk bot sales WhatsApp.
Tugasmu adalah MEREVISI dan MENYEMPURNAKAN "Addon Instruksi Bot" berdasarkan pola-pola komunikasi sukses terbaru yang dipelajari dari CS manusia nyata.

ATURAN REVISI (WAJIB DIIKUTI):
1. ✅ BACA DULU sistem prompt asli dan knowledge produk di bawah — JANGAN ubah atau masukkan ulang isinya ke addon.
2. ✅ Addon hanya berisi instruksi TAMBAHAN yang BELUM ADA di sistem prompt asli.
3. ✅ Jika ada instruksi di addon lama yang sudah ketinggalan zaman / tidak relevan → HAPUS.
4. ✅ Jika ada pola baru yang sangat mirip dengan yang sudah ada → GABUNGKAN menjadi lebih ringkas.
5. ✅ Tujuan akhir: Addon semakin hari semakin RINGKAS tapi POWERFUL — tidak boleh makin panjang terus.
6. ✅ Maksimal 400 kata untuk keseluruhan addon.
7. ✅ Gunakan bahasa Indonesia. Format sebagai blok instruksi langsung untuk bot (bukan deskripsi).

=== SISTEM PROMPT ASLI AGENT (JANGAN DUPLIKASI) ===
${currentSystemPrompt.slice(0, 2000)}

=== KNOWLEDGE PRODUK ASLI (JANGAN DUPLIKASI) ===
${currentProductKnow.slice(0, 1000)}

=== ADDON INSTRUKSI LAMA (AKAN DIREVISI / MUNGKIN DIHAPUS SEBAGIAN) ===
${currentLearnedAddon || '(Belum ada — ini revisi pertama)'}

=== POLA SUKSES TERBARU DARI CS MANUSIA ===
${patternsText}

=== OUTPUT YANG DIHARAPKAN ===
Berikan HANYA objek JSON berikut tanpa komentar lain:
{
  "addon_baru": "<teks addon instruksi yang sudah direvisi, maksimal 400 kata, langsung pakai>",
  "ringkasan_perubahan": "<1-3 kalimat: apa yang ditambah, apa yang dihapus, kenapa>"
}`;

        const openaiClient = new OpenAI({
            apiKey: process.env.DEEPSEEK_API_KEY || config.OPENAI_API_KEY,
            baseURL: process.env.DEEPSEEK_API_KEY ? 'https://api.deepseek.com/v1' : undefined
        });

        const response = await openaiClient.chat.completions.create({
            model: config.MODEL_NAME,
            messages: [{ role: 'user', content: revisionPrompt }],
            response_format: { type: 'json_object' },
            temperature: 0.3,
            max_tokens: 1200
        }, { timeout: 60000 });

        // 4. Track cost
        if (response.usage) {
            logRequest({
                model: config.MODEL_NAME,
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
                endpoint: 'prompt_revision',
                functionName: 'reviseAgentPrompt'
            }).catch(() => {});
        }

        // 5. Parse hasil revisi
        let result = {};
        try {
            const raw = response.choices[0]?.message?.content || '{}';
            result = JSON.parse(raw);
        } catch (e) {
            logger.warn(`[LearningWorker] Gagal parse hasil revisi JSON: ${e.message}`);
            return;
        }

        const newAddon    = (result.addon_baru || '').trim();
        const summaryText = (result.ringkasan_perubahan || '').trim();

        if (!newAddon) {
            logger.info(`[LearningWorker] AI tidak menghasilkan addon baru, skip.`);
            return;
        }

        // 6. Simpan addon baru ke BotAgent
        if (agent) {
            await agent.update({ learned_prompt_addon: newAddon });
        }

        // 7. Simpan ke PromptEvolutionLog untuk UI tab "Evolusi Prompt"
        await PromptEvolutionLog.create({
            agent_id: agentId || null,
            prompt_before: currentLearnedAddon || '(Kosong)',
            prompt_after: newAddon,
            summary_changes: summaryText,
            patterns_used: topPatterns.length,
            avg_conversation_score: 0,
            tokens_used: response.usage?.total_tokens || 0,
            created_at: new Date()
        });

        logger.info(`[LearningWorker] ✨ Revisi prompt selesai untuk agent [${agentId || 'global'}]. Perubahan: ${summaryText}`);

    } catch (err) {
        logger.warn(`[LearningWorker] Error revisi prompt agent [${agentId}]: ${err.message}`);
    }
}

/**
 * Mulai background worker loop.
 * Dipanggil SEKALI saat server startup (di app.ts).
 */
function startWorker() {
    if (_workerTimer) return; // Sudah berjalan
    _isShutdown = false;
    _workerTimer = setInterval(async () => {
        if (_isShutdown) return;
        try {
            await _processNextJob();
        } catch (e) {
            logger.warn(`[LearningWorker] Uncaught error in worker tick: ${e.message}`);
        }
    }, WORKER_TICK_MS);
    logger.info('[LearningWorker] 🚀 Background learning worker aktif (interval 5 detik).');
}

/**
 * Hentikan worker secara graceful.
 * Dipanggil saat server shutdown (di app.ts).
 */
function stopWorker() {
    _isShutdown = true;
    if (_workerTimer) {
        clearInterval(_workerTimer);
        _workerTimer = null;
    }
    // Bersihkan semua pending debounce timers
    for (const t of _debounce.values()) clearTimeout(t);
    _debounce.clear();
    logger.info('[LearningWorker] 🛑 Background learning worker dihentikan.');
}

/**
 * Expose current queue length untuk monitoring/health endpoint.
 */
function getQueueLength() {
    return _queue.length;
}

module.exports = {
    pushLearningJob,
    startWorker,
    stopWorker,
    getQueueLength,
    // Expose for direct use in testing
    _reviseAgentPrompt
};
