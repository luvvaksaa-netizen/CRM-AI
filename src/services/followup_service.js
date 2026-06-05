/**
 * @file followup_service.js
 * @description Automated Follow-Up System — Multi-Stage Customer Re-Engagement.
 *
 * KEY FEATURES:
 *  - 4-stage follow-up pipeline (10min, 1hr, 7pm, 6am next day)
 *  - Random delay 2-5 minutes between customers (anti-spam/anti-banned)
 *  - Multiple copywriting templates per stage (variasi anti-deteksi)
 *  - Personalized with customer name from chat summary
 *  - Auto-cancel when customer replies
 *  - Respects bot toggle (global + per-contact pause)
 *  - Context-aware: references last conversation topic
 */

const { Op } = require('sequelize');
const logger = require('../utils/logger');
const { FollowUp, Store, ChatSummary, MediaAsset, BotAgent } = require('../database/index');

// ══════════════════════════════════════════════════════════════════
// FOLLOW-UP STAGE TEMPLATES
// Setiap stage memiliki beberapa variasi copywriting untuk anti-spam.
// {name} akan diganti dengan nama customer.
// ══════════════════════════════════════════════════════════════════

const DEFAULT_FOLLOWUP_CONFIG = {
    1: {
        delay_minutes: 10,
        media_type: 'video',
        media_label_hints: ['video label', 'video produk', 'video'],
        ai_instruction: "Sapa ramah, beri tahu ada video cara pemakaian yang bagus. Ajak untuk pesan sekarang."
    },
    2: {
        delay_minutes: 60,
        media_type: 'image',
        media_label_hints: ['value', 'keunggulan', 'foto value', 'testimoni'],
        ai_instruction: "Berikan keunggulan produk (misal: anti air, tidak luntur). Sapa ramah."
    },
    3: {
        scheduled_hour: 19,
        media_type: 'video',
        media_label_hints: ['video label', 'video produk', 'video'],
        ai_instruction: "Ingatkan bahwa kalau pesan malam ini, besok bisa langsung diproses/dikirim."
    },
    4: {
        scheduled_hour: 6,
        scheduled_next_day: true,
        media_type: 'mixed',
        media_label_hints: ['testimoni', 'pemasangan', 'video pemasangan', 'review', 'video', 'value'],
        ai_instruction: "Ucapkan selamat pagi. Beri tahu banyak customer lain puas dengan hasilnya. Tanyakan apakah masih berminat pesan."
    }
};

/**
 * Helper: Ambil konfigurasi follow-up per-store dari DB, atau fallback ke default.
 */
async function getFollowUpConfig(storeWaId) {
    try {
        const store = await Store.findOne({ where: { wa_id: storeWaId } });
        if (store && store.followup_config) {
            const parsed = JSON.parse(store.followup_config);
            // Validasi sederhana, pastikan object punya key 1,2,3,4
            if (parsed && typeof parsed === 'object' && parsed['1']) {
                return parsed;
            }
        }
    } catch (e) {
        logger.warn(`[FollowUp] Gagal parse config DB untuk ${storeWaId}, pakai default.`);
    }
    return DEFAULT_FOLLOWUP_CONFIG;
}


const SCHEDULER_INTERVAL_MS = 60 * 1000;   // Cek tiap 60 detik
const RANDOM_DELAY_MIN_MS   = 2 * 60 * 1000; // Min 2 menit antar-customer
const RANDOM_DELAY_MAX_MS   = 5 * 60 * 1000; // Max 5 menit antar-customer
const MAX_CONCURRENT_FU     = 5;              // Maks 5 follow-up diproses bersamaan

let schedulerInterval = null;
let isProcessing = false;
let ioRef = null; // Socket.io reference

/**
 * Inisialisasi Follow-Up Scheduler.
 * Dipanggil sekali dari index.js setelah DB ready.
 */
function initFollowUpScheduler(io) {
    ioRef = io;

    if (schedulerInterval) {
        clearInterval(schedulerInterval);
    }

    schedulerInterval = setInterval(async () => {
        if (isProcessing) return; // Prevent overlap
        isProcessing = true;
        try {
            await processScheduledFollowUps();
        } catch (e) {
            logger.error(`[FollowUp] Scheduler error: ${e.message}`);
        } finally {
            isProcessing = false;
        }
    }, SCHEDULER_INTERVAL_MS);

    logger.success('[FollowUp] Scheduler otomatis aktif (cek tiap 60 detik).');
}

/**
 * Proses semua follow-up yang sudah waktunya.
 * Eksekusi sequential dengan jeda random antar-customer (anti-banned).
 */
async function processScheduledFollowUps() {
    const now = new Date();

    const pendingList = await FollowUp.findAll({
        where: {
            status: 'pending',
            scheduled_at: { [Op.lte]: now }
        },
        order: [['scheduled_at', 'ASC']],
        limit: MAX_CONCURRENT_FU
    });

    if (pendingList.length === 0) return;

    logger.info(`[FollowUp] ${pendingList.length} follow-up siap dikirim.`);

    for (let i = 0; i < pendingList.length; i++) {
        const fu = pendingList[i];

        try {
            await executeFollowUp(fu);
        } catch (err) {
            logger.error(`[FollowUp] Gagal eksekusi stage-${fu.stage} untuk [${fu.contact_id}]: ${err.message}`);
            await fu.update({ status: 'cancelled', cancel_reason: `Error: ${err.message}` });
        }

        // Jeda random 2-5 menit antar-customer (jika masih ada antrian)
        if (i < pendingList.length - 1) {
            const delay = Math.floor(Math.random() * (RANDOM_DELAY_MAX_MS - RANDOM_DELAY_MIN_MS)) + RANDOM_DELAY_MIN_MS;
            logger.info(`[FollowUp] Jeda ${Math.round(delay / 1000)}s sebelum follow-up berikutnya...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

/**
 * Eksekusi satu follow-up: kirim media + teks ke WhatsApp.
 */
async function executeFollowUp(followUp) {
    // 1. Guard: Cek apakah bot masih aktif
    const store = await Store.findOne({
        where: { wa_id: followUp.store_wa_id },
        include: [{ model: BotAgent, as: 'BotAgent' }]
    });

    if (!store || store.is_bot_active === false) {
        await followUp.update({ status: 'cancelled', cancel_reason: 'Bot non-aktif' });
        logger.info(`[FollowUp] Dibatalkan (bot OFF): stage-${followUp.stage} [${followUp.contact_id}]`);
        emitFollowUpUpdate(followUp.store_wa_id);
        return;
    }

    // 2. Guard: Cek apakah kontak di-pause (Human Override)
    const { pausedContacts } = require('../events/message_handler');
    const pauseKey = `${followUp.store_wa_id}_${followUp.contact_id}`;
    if (pausedContacts.has(pauseKey)) {
        await followUp.update({ status: 'cancelled', cancel_reason: 'Kontak dipause oleh CS' });
        logger.info(`[FollowUp] Dibatalkan (paused): stage-${followUp.stage} [${followUp.contact_id}]`);
        emitFollowUpUpdate(followUp.store_wa_id);
        return;
    }

    // 3. Guard: Cek ChatSummary terbaru — apakah percakapan sudah closing?
    // Ini memastikan follow-up tidak dikirim ke customer yang sudah selesai order,
    // bahkan jika follow-up dijadwalkan sebelum status berubah.
    const { ChatMessage, ChatSummary: ChatSummaryModel } = require('../database/index');
    const freshSummary = await ChatSummaryModel.findOne({
        where: { store_wa_id: followUp.store_wa_id, contact_id: followUp.contact_id }
    });

    if (freshSummary?.summary) {
        const { isConversationClosed } = require('./bot_activation_service');
        if (isConversationClosed(freshSummary.summary)) {
            await followUp.update({ status: 'cancelled', cancel_reason: 'Percakapan sudah closing/selesai' });
            logger.info(`[FollowUp] Dibatalkan (closing): stage-${followUp.stage} [${followUp.contact_id}]`);
            emitFollowUpUpdate(followUp.store_wa_id);
            return;
        }
    }

    // 4. Guard: Cek apakah CS sudah membalas dari HP setelah follow-up ini dijadwalkan
    // Jika CS sudah handle manual → tidak perlu follow-up otomatis lagi
    const csManualReply = await ChatMessage.findOne({
        where: {
            store_wa_id: followUp.store_wa_id,
            contact_id: followUp.contact_id,
            is_from_me: true,
            sender_name: 'CS (dari HP)',
            timestamp: { [Op.gt]: followUp.createdAt }
        }
    });

    if (csManualReply) {
        await followUp.update({ status: 'cancelled', cancel_reason: 'CS sudah membalas manual dari HP' });
        logger.info(`[FollowUp] Dibatalkan (CS manual reply): stage-${followUp.stage} [${followUp.contact_id}]`);
        emitFollowUpUpdate(followUp.store_wa_id);
        return;
    }

    // 5. Guard: Cek apakah customer sudah merespons setelah follow-up dijadwalkan
    const recentCustomerMsg = await ChatMessage.findOne({
        where: {
            store_wa_id: followUp.store_wa_id,
            contact_id: followUp.contact_id,
            is_from_me: false,
            timestamp: { [Op.gt]: followUp.createdAt }
        },
        order: [['timestamp', 'DESC']]
    });

    if (recentCustomerMsg) {
        await followUp.update({ status: 'replied', cancel_reason: 'Customer sudah merespons' });
        logger.info(`[FollowUp] Dibatalkan (customer reply): stage-${followUp.stage} [${followUp.contact_id}]`);
        emitFollowUpUpdate(followUp.store_wa_id);
        return;
    }

    const config = await getFollowUpConfig(followUp.store_wa_id);
    const template = config[followUp.stage];
    if (!template) {
        await followUp.update({ status: 'cancelled', cancel_reason: 'Template config tidak ditemukan' });
        return;
    }

    const customerName = followUp.contact_name || 'kak';

    // 6. Generate pesan secara organik lewat AI
    const aiService = require('../ai_service');
    const productKnowledge = store.BotAgent?.product_knowledge || '';
    const personalizedCopy = await aiService.generateOrganicFollowUp(
        customerName, 
        followUp.last_chat_context, 
        template.ai_instruction, 
        productKnowledge
    );

    // 5. Cari media yang sesuai dari katalog Agent (Cerdas & Multi-Produk Aware)
    const agentId = store.agent_id;
    let mediaToSend = null;

    if (agentId && template.media_label_hints.length > 0) {
        // Ambil summary chat pelanggan untuk mendeteksi preferensi produk (DTF vs UV)
        let productKeyword = '';
        try {
            const summaryRecord = await ChatSummary.findOne({
                where: { store_wa_id: followUp.store_wa_id, contact_id: followUp.contact_id }
            });
            const summaryText = (summaryRecord?.summary || '').toLowerCase();

            if (summaryText.includes('dtf uv') || summaryText.includes('label dtf uv') || summaryText.includes('uv dtf') || summaryText.includes('stiker keras')) {
                productKeyword = 'uv';
            } else if (summaryText.includes('dtf') || summaryText.includes('label dtf') || summaryText.includes('bahan setrika')) {
                productKeyword = 'dtf';
            }
        } catch (summaryErr) {
            logger.warn(`[FollowUp] Gagal membaca preferensi produk untuk [${followUp.contact_id}]: ${summaryErr.message}`);
        }

        const allMedia = await MediaAsset.findAll({
            where: {
                agent_id: agentId,
                purpose: { [Op.ne]: 'knowledge_only' }
            }
        });

        // Taktik 1: Cari media yang cocok dengan keyword produk (dtf/uv) DAN hint label-nya
        if (productKeyword) {
            for (const hint of template.media_label_hints) {
                const match = allMedia.find(m => {
                    const labelLower = (m.label || '').toLowerCase();
                    return labelLower.includes(hint.toLowerCase()) &&
                           labelLower.includes(productKeyword) &&
                           (template.media_type === 'mixed' || m.type === template.media_type);
                });
                if (match) {
                    mediaToSend = match;
                    break;
                }
            }
        }

        // Taktik 2: Fallback ke hint label umum (jika tidak terdeteksi preferensi produk atau file khusus tidak ada)
        if (!mediaToSend) {
            for (const hint of template.media_label_hints) {
                const match = allMedia.find(m => {
                    const labelLower = (m.label || '').toLowerCase();
                    return labelLower.includes(hint.toLowerCase()) &&
                           (template.media_type === 'mixed' || m.type === template.media_type);
                });
                if (match) {
                    mediaToSend = match;
                    break;
                }
            }
        }

        // Taktik 3: Fallback terakhir ke media pertama sesuai tipe (image/video)
        if (!mediaToSend && template.media_type !== 'mixed') {
            mediaToSend = allMedia.find(m => m.type === template.media_type);
        }
    }

    // 6. Kirim via WhatsApp — dengan retry jika client baru saja restart
    const MAX_WAIT_RESTART_MS = 3 * 60 * 1000; // Tunggu maks 3 menit jika client restart
    const startWait = Date.now();
    
    while (true) {
        try {
            const whatsappService = require('../whatsapp_service');
            await whatsappService.sendFollowUpMessage(
                followUp.store_wa_id,
                followUp.contact_id,
                personalizedCopy,
                mediaToSend
            );

            await followUp.update({ status: 'sent', sent_at: new Date() });
            logger.success(`[FollowUp] ✅ Stage-${followUp.stage} terkirim ke [${customerName}] (${followUp.contact_id})`);

            // 7. Jadwalkan stage berikutnya (jika belum stage terakhir)
            if (followUp.stage < 4) {
                await scheduleNextStage(followUp);
            }

            emitFollowUpUpdate(followUp.store_wa_id);
            return; // Berhasil
        } catch (sendErr) {
            const isRestartError = /null|evaluate|detached|not ready|belum siap/i.test(sendErr.message);
            const elapsed = Date.now() - startWait;

            if (isRestartError && elapsed < MAX_WAIT_RESTART_MS) {
                // Client sedang restart, tunggu 15 detik lalu coba lagi
                logger.warn(`[FollowUp] Client sedang restart, menunggu 15 detik lalu coba kirim ulang stage-${followUp.stage} ke [${customerName}]...`);
                await new Promise(r => setTimeout(r, 15000));
                continue;
            }

            // Gagal permanent — jadwal ulang 5 menit kemudian (bukan cancel)
            logger.error(`[FollowUp] Gagal kirim stage-${followUp.stage}: ${sendErr.message}`);
            const retryAt = new Date(Date.now() + 5 * 60 * 1000);
            await followUp.update({ scheduled_at: retryAt });
            logger.info(`[FollowUp] Follow-up stage-${followUp.stage} dijadwal ulang ke ${retryAt.toLocaleTimeString('id-ID')}`);
            emitFollowUpUpdate(followUp.store_wa_id);
            return;
        }
    }
}

/**
 * Jadwalkan follow-up stage berikutnya setelah stage saat ini berhasil dikirim.
 */
async function scheduleNextStage(currentFollowUp) {
    const nextStage = currentFollowUp.stage + 1;
    const config = await getFollowUpConfig(currentFollowUp.store_wa_id);
    const nextTemplate = config[nextStage];
    if (!nextTemplate) return;

    const scheduledAt = calculateScheduleTime(nextTemplate);

    await FollowUp.create({
        store_wa_id: currentFollowUp.store_wa_id,
        contact_id: currentFollowUp.contact_id,
        contact_name: currentFollowUp.contact_name,
        stage: nextStage,
        scheduled_at: scheduledAt,
        status: 'pending',
        last_chat_context: currentFollowUp.last_chat_context
    });

    logger.info(`[FollowUp] Stage-${nextStage} dijadwalkan untuk [${currentFollowUp.contact_name}] pada ${scheduledAt.toLocaleString('id-ID')}`);
}

/**
 * Hitung waktu jadwal berdasarkan template.
 */
function calculateScheduleTime(template) {
    const now = new Date();

    // Stage berbasis delay (10 menit, 1 jam)
    if (template.delay_minutes) {
        return new Date(now.getTime() + template.delay_minutes * 60 * 1000);
    }

    // Stage berbasis jam tetap (jam 19:00, jam 06:00)
    if (template.scheduled_hour !== undefined) {
        const target = new Date(now);
        target.setHours(template.scheduled_hour, 0, 0, 0);

        // Jika waktunya sudah lewat hari ini, jadwalkan besok
        if (target <= now || template.scheduled_next_day) {
            target.setDate(target.getDate() + 1);
        }

        return target;
    }

    // Fallback: 30 menit dari sekarang
    return new Date(now.getTime() + 30 * 60 * 1000);
}

// ══════════════════════════════════════════════════════════════════
// PUBLIC API — Dipanggil oleh message_handler dan dashboard_service
// ══════════════════════════════════════════════════════════════════

/**
 * Jadwalkan follow-up stage 1 untuk customer yang belum closing.
 * Dipanggil setelah AI reply terkirim.
 */
async function scheduleFollowUp(storeWaId, contactId, contactName, chatContext) {
    try {
        // Cek apakah sudah ada follow-up pending untuk customer ini
        const existing = await FollowUp.findOne({
            where: {
                store_wa_id: storeWaId,
                contact_id: contactId,
                status: 'pending'
            }
        });

        if (existing) {
            // Sudah ada follow-up pending, tidak perlu jadwalkan baru
            return null;
        }

        const config = await getFollowUpConfig(storeWaId);
        const template = config[1];
        if (!template) return null;
        
        const scheduledAt = calculateScheduleTime(template);

        const followUp = await FollowUp.create({
            store_wa_id: storeWaId,
            contact_id: contactId,
            contact_name: contactName || 'kak',
            stage: 1,
            scheduled_at: scheduledAt,
            status: 'pending',
            last_chat_context: chatContext || ''
        });

        logger.info(`[FollowUp] Stage-1 dijadwalkan untuk [${contactName}] pada ${scheduledAt.toLocaleString('id-ID')}`);
        emitFollowUpUpdate(storeWaId);
        return followUp;
    } catch (e) {
        logger.error(`[FollowUp] Gagal menjadwalkan: ${e.message}`);
        return null;
    }
}

/**
 * Batalkan semua follow-up pending untuk customer tertentu.
 * Dipanggil saat customer merespons atau CS manual cancel.
 */
async function cancelPendingFollowUps(storeWaId, contactId, reason = 'Customer merespons') {
    try {
        const [updated] = await FollowUp.update(
            { status: 'replied', cancel_reason: reason },
            { where: { store_wa_id: storeWaId, contact_id: contactId, status: 'pending' } }
        );

        if (updated > 0) {
            let display = contactId;
            try {
                const { ChatSummary } = require('../database/index');
                const summary = await ChatSummary.findOne({ where: { store_wa_id: storeWaId, contact_id: contactId } });
                if (summary && summary.contact_name) {
                    display = `[${summary.contact_name}${summary.contact_phone ? ' | +' + summary.contact_phone : ''}] (${contactId})`;
                }
            } catch (e) { /* ignore */ }
            
            logger.info(`[FollowUp] ${updated} follow-up dibatalkan untuk ${display}: ${reason}`);
            emitFollowUpUpdate(storeWaId);
        }
        return updated;
    } catch (e) {
        logger.error(`[FollowUp] Gagal membatalkan: ${e.message}`);
        return 0;
    }
}

/**
 * Ambil daftar follow-up untuk store tertentu.
 */
async function getFollowUps(storeWaId, options = {}) {
    const where = { store_wa_id: storeWaId };

    if (options.status) {
        where.status = options.status;
    }

    return FollowUp.findAll({
        where,
        order: [['scheduled_at', 'DESC']],
        limit: options.limit || 100
    });
}

/**
 * Ambil statistik follow-up per store.
 */
async function getFollowUpStats(storeWaId) {
    const pending = await FollowUp.count({ where: { store_wa_id: storeWaId, status: 'pending' } });
    const sent    = await FollowUp.count({ where: { store_wa_id: storeWaId, status: 'sent' } });
    const replied = await FollowUp.count({ where: { store_wa_id: storeWaId, status: 'replied' } });

    return { pending, sent, replied, total: pending + sent + replied };
}

/**
 * Ambil statistik follow-up semua store (untuk badge di dashboard).
 */
async function getAllPendingCount() {
    return FollowUp.count({ where: { status: 'pending' } });
}

/**
 * Manual cancel follow-up spesifik by ID.
 */
async function cancelFollowUpById(followUpId, reason = 'Dibatalkan manual oleh CS') {
    const fu = await FollowUp.findByPk(followUpId);
    if (!fu || fu.status !== 'pending') return false;

    await fu.update({ status: 'cancelled', cancel_reason: reason });
    emitFollowUpUpdate(fu.store_wa_id);
    logger.info(`[FollowUp] Follow-up #${followUpId} dibatalkan manual.`);
    return true;
}

/**
 * Bersihkan follow-up lama (> 7 hari) untuk menjaga ukuran DB.
 */
async function cleanupOldFollowUps() {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const deleted = await FollowUp.destroy({
        where: {
            status: { [Op.ne]: 'pending' },
            createdAt: { [Op.lt]: cutoff }
        }
    });

    if (deleted > 0) {
        logger.info(`[FollowUp] ${deleted} follow-up lama (>7 hari) dibersihkan.`);
    }
}

/**
 * Emit update ke dashboard via Socket.io.
 */
function emitFollowUpUpdate(storeWaId) {
    if (ioRef) {
        ioRef.emit('followUpUpdated', { storeWaId });
    }
}

module.exports = {
    DEFAULT_FOLLOWUP_CONFIG,
    getFollowUpConfig,
    initFollowUpScheduler,
    scheduleFollowUp,
    cancelPendingFollowUps,
    cancelFollowUpById,
    getFollowUps,
    getFollowUpStats,
    getAllPendingCount,
    cleanupOldFollowUps,
    emitFollowUpUpdate
};
