/**
 * @file bot_activation_service.js
 * @description Smart Bot Re-Activation Service
 *
 * FUNGSI UTAMA:
 *  Ketika bot di-toggle dari OFF → ON, service ini:
 *  1. Scan semua kontak aktif (30 hari terakhir)
 *  2. Cek status percakapan via ChatSummary
 *  3. Skip kontak yang sudah closing/selesai (tidak diganggu)
 *  4. Update summary untuk kontak yang dibalas CS manual saat bot OFF
 *  5. Reschedule follow-up yang relevan (dengan delay agar tidak spam)
 *
 * EDGE CASES YANG DITANGANI:
 *  - Kontak sudah closing → tidak di-follow-up
 *  - CS sudah balas dari HP → summary diupdate, follow-up dibatalkan
 *  - Customer masih menunggu → follow-up dijadwal ulang setelah 15 menit
 *  - Multiple store → isolasi penuh per store
 *  - Summary belum ada → langsung skip follow-up check, biarkan AI handle organik
 */

'use strict';

const { Op } = require('sequelize');
const logger = require('../utils/logger');

// Kata kunci status yang menandakan percakapan selesai — tidak perlu follow-up
const CLOSING_PATTERNS = [
    /\bstatus:\s*(closing|selesai)\b/i,
    /\bsudah\s+(closing|selesai|transfer|bayar|lunas)\b/i,
    /\bpesanan\s+selesai\b/i,
    /\border\s+confirmed\b/i,
];

/**
 * Parse apakah sebuah summary text mengindikasikan percakapan sudah closing.
 * @param {string} summaryText
 * @returns {boolean}
 */
function isConversationClosed(summaryText) {
    if (!summaryText) return false;
    const text = String(summaryText).toLowerCase();
    return CLOSING_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Parse apakah summary text mengindikasikan customer sedang dalam proses
 * (bukan baru mulai, bukan selesai) → perlu diprioritaskan follow-up.
 * @param {string} summaryText
 * @returns {boolean}
 */
function isConversationActive(summaryText) {
    if (!summaryText || summaryText.includes('Percakapan baru saja dimulai')) return false;
    const closed = isConversationClosed(summaryText);
    return !closed;
}

/**
 * Hitung waktu jadwal follow-up saat bot baru ON.
 * Memberikan jeda acak (jitter) 15 hingga 180 menit agar ratusan pesan tidak dikirim serentak saat server restart.
 * @returns {Date}
 */
function getActivationFollowUpTime() {
    const minMinutes = 15;
    const maxMinutes = 180;
    const randomMinutes = Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes;
    return new Date(Date.now() + randomMinutes * 60 * 1000);
}

/**
 * Entry point utama — dipanggil saat bot di-toggle OFF→ON.
 * Berjalan di background (non-blocking).
 *
 * @param {string} storeWaId - ID store/WA yang baru diaktifkan
 */
// ── Global lock: cegah BotActivation jalan 2x bersamaan untuk store yang sama ──
const _activationLocks = new Set();

async function onBotActivated(storeWaId) {
    // Cegah double-activation untuk store yang sama
    if (_activationLocks.has(storeWaId)) {
        logger.warn(`[BotActivation] 🔒 [${storeWaId}] Sudah berjalan, skip duplikat.`);
        return;
    }
    _activationLocks.add(storeWaId);
    logger.info(`[BotActivation] 🔄 Bot [${storeWaId}] dinyalakan. Memulai scan konteks percakapan...`);

    try {
        const {
            ChatMessage, ChatSummary, FollowUp, Store, BotAgent
        } = require('../database/index');

        // Guard: pastikan store+agent valid
        const store = await Store.findOne({
            where: { wa_id: storeWaId },
            include: [{ model: BotAgent, as: 'BotAgent' }]
        });

        if (!store || !store.BotAgent) {
            logger.warn(`[BotActivation] Store [${storeWaId}] tidak ditemukan atau belum punya agen. Skip.`);
            return;
        }

        // Ambil semua kontak unik yang aktif dalam 30 hari terakhir
        const since30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const activeContacts = await ChatMessage.findAll({
            attributes: ['contact_id', 'contact_display_name', 'sender_name', 'contact_phone'],
            where: {
                store_wa_id: storeWaId,
                is_from_me: false,
                timestamp: { [Op.gte]: since30Days }
            },
            group: ['contact_id'],
            order: [['timestamp', 'DESC']]
        });

        if (activeContacts.length === 0) {
            logger.info(`[BotActivation] Tidak ada kontak aktif dalam 30 hari untuk [${storeWaId}]. Selesai.`);
            _activationLocks.delete(storeWaId);
            return;
        }

        // ── RATE LIMITER: Batasi maks 150 kontak per aktivasi untuk mencegah banjir ──
        const MAX_CONTACTS = 150;
        const contactsToProcess = activeContacts.slice(0, MAX_CONTACTS);
        if (activeContacts.length > MAX_CONTACTS) {
            logger.warn(`[BotActivation] [${storeWaId}] ${activeContacts.length} kontak ditemukan, diproses ${MAX_CONTACTS} terbaru saja.`);
        }

        logger.info(`[BotActivation] Ditemukan ${activeContacts.length} kontak aktif untuk dievaluasi (proses: ${contactsToProcess.length}).`);

        let countSkipped = 0;
        let countRescheduled = 0;
        let countCsHandled = 0;

        // Waktu saat bot terakhir mati — gunakan 24 jam lalu sebagai proxy aman
        // (Tidak mungkin tahu exact waktu bot dimatikan dari DB saat ini)
        const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

        for (const row of contactsToProcess) {
            const contactId = row.contact_id;
            const contactName = row.contact_display_name || row.sender_name || 'kak';

            try {
                await _evaluateContact({
                    storeWaId, contactId, contactName,
                    store, since24h,
                    ChatMessage, ChatSummary, FollowUp,
                    counters: { countSkipped, countRescheduled, countCsHandled }
                });

                // Update counter dari hasil evaluasi (passed by ref workaround)
                const result = _lastEvalResult;
                if (result.skipped) countSkipped++;
                else if (result.csHandled) countCsHandled++;
                else if (result.rescheduled) countRescheduled++;
            } catch (contactErr) {
                logger.warn(`[BotActivation] Gagal evaluasi kontak [${contactId}]: ${contactErr.message}`);
            }

            // ── RATE LIMITER: 400ms jeda antar kontak untuk mencegah DB + event loop flood ──
            await new Promise(r => setTimeout(r, 400));
        }

        logger.success(
            `[BotActivation] ✅ Scan selesai untuk [${storeWaId}]: ` +
            `${countSkipped} closing (skip), ${countCsHandled} sudah dibalas CS, ` +
            `${countRescheduled} follow-up dijadwal ulang.`
        );

    } catch (err) {
        logger.error(`[BotActivation] Error saat scan aktivasi [${storeWaId}]: ${err.message}`);
    } finally {
        // SELALU hapus lock meski error, agar bisa jalan lagi nanti
        _activationLocks.delete(storeWaId);
    }
}

// Simple per-call result holder (no shared state corruption risk karena sequential loop)
let _lastEvalResult = { skipped: false, csHandled: false, rescheduled: false };

/**
 * Evaluasi satu kontak saat bot re-aktivasi.
 */
async function _evaluateContact({
    storeWaId, contactId, contactName,
    store, since24h,
    ChatMessage, ChatSummary, FollowUp
}) {
    _lastEvalResult = { skipped: false, csHandled: false, rescheduled: false };

    // 1. Cek ChatSummary — apakah percakapan sudah closing?
    const summaryRecord = await ChatSummary.findOne({
        where: { store_wa_id: storeWaId, contact_id: contactId }
    });
    const summaryText = summaryRecord?.summary || '';

    // FIX #4 — Cek wa_labels dari DB DULU (lebih akurat dari parse teks summary).
    // Ini mencegah kasus di mana label sudah "Closing" di DB tapi summary
    // belum sempat terupdate — bot tetap bisa follow-up ke kontak yg sudah deal.
    let isClosedByLabel = false;
    try {
        const rawLabels = summaryRecord?.wa_labels;
        if (rawLabels) {
            const labelsArr = JSON.parse(rawLabels);
            const closedLabels = ['Closing', 'Cancel'];
            isClosedByLabel = labelsArr.some(l => closedLabels.includes(l));
        }
    } catch (_) {}

    if (isClosedByLabel || isConversationClosed(summaryText)) {
        logger.info(`[BotActivation] [${contactId}] sudah closing (via ${isClosedByLabel ? 'wa_labels DB' : 'summary text'}) — skip semua aksi.`);
        _lastEvalResult.skipped = true;
        return;
    }


    // 2. Cek apakah CS manual sudah membalas selama bot OFF (24 jam terakhir)
    const csManualReplies = await ChatMessage.findAll({
        where: {
            store_wa_id: storeWaId,
            contact_id: contactId,
            is_from_me: true,
            sender_name: 'CS (dari HP)',
            timestamp: { [Op.gte]: since24h }
        },
        order: [['timestamp', 'DESC']],
        limit: 5
    });

    if (csManualReplies.length > 0) {
        logger.info(
            `[BotActivation] [${contactId}] sudah dibalas CS manual ${csManualReplies.length}x saat bot OFF. ` +
            `Memperbarui rekap background & membatalkan follow-up lama.`
        );

        // Cancel follow-up lama yang sudah irrelevant (CS sudah handle)
        await FollowUp.update(
            { status: 'cancelled', cancel_reason: 'CS sudah membalas saat bot OFF' },
            { where: { store_wa_id: storeWaId, contact_id: contactId, status: 'pending' } }
        );

        // Trigger summary update background (tidak await — non-blocking)
        _triggerSummaryUpdate(storeWaId, contactId, contactName).catch(() => {});

        _lastEvalResult.csHandled = true;
        return;
    }

    // 3. Cek apakah customer mengirim pesan saat bot OFF tanpa dapat balasan
    const customerMsgsDuringOff = await ChatMessage.findOne({
        where: {
            store_wa_id: storeWaId,
            contact_id: contactId,
            is_from_me: false,
            timestamp: { [Op.gte]: since24h }
        }
    });

    // Cek apakah ada pesan bot setelah pesan customer terakhir
    const lastBotReply = await ChatMessage.findOne({
        where: {
            store_wa_id: storeWaId,
            contact_id: contactId,
            is_from_me: true
        },
        order: [['timestamp', 'DESC']]
    });

    const lastCustomerMsg = await ChatMessage.findOne({
        where: {
            store_wa_id: storeWaId,
            contact_id: contactId,
            is_from_me: false
        },
        order: [['timestamp', 'DESC']]
    });

    // Jika customer mengirim pesan SETELAH balasan bot terakhir = customer masih menunggu
    const customerWaiting = lastCustomerMsg &&
        (!lastBotReply || lastCustomerMsg.timestamp > lastBotReply.timestamp);

    if (customerWaiting || (customerMsgsDuringOff && isConversationActive(summaryText))) {
        // Jadwalkan ulang follow-up dengan delay 15 menit agar tidak langsung spam
        const existingPending = await FollowUp.findOne({
            where: { store_wa_id: storeWaId, contact_id: contactId, status: 'pending' }
        });

        if (!existingPending) {
            await FollowUp.create({
                store_wa_id: storeWaId,
                contact_id: contactId,
                contact_name: contactName,
                stage: 1,
                scheduled_at: getActivationFollowUpTime(),
                status: 'pending',
                last_chat_context: `[Bot re-aktivasi] ${summaryText.slice(0, 200)}`
            });

            logger.info(
                `[BotActivation] [${contactId}] customer masih menunggu — ` +
                `follow-up dijadwal ulang dalam 15 menit.`
            );
            _lastEvalResult.rescheduled = true;
        } else {
            logger.info(`[BotActivation] [${contactId}] sudah ada follow-up pending, skip reschedule.`);
        }
    }
}

/**
 * Trigger summary update background untuk satu kontak.
 * Debounced: hanya 1x per kontak per 60 detik.
 */
const _summaryDebounce = new Map(); // contactId → timeoutId

async function _triggerSummaryUpdate(storeWaId, contactId, senderName) {
    const key = `${storeWaId}_${contactId}`;

    // Debounce: jika dalam 60 detik sudah dijadwal → reset timer
    if (_summaryDebounce.has(key)) {
        clearTimeout(_summaryDebounce.get(key));
    }

    const timerId = setTimeout(async () => {
        _summaryDebounce.delete(key);
        try {
            const { ChatMessage, ChatSummary } = require('../database/index');
            const { generateChatSummary } = require('../ai_service');

            const latestHistory = await ChatMessage.findAll({
                where: { contact_id: contactId, store_wa_id: storeWaId },
                limit: 50,
                order: [['timestamp', 'DESC']]
            });
            const history = latestHistory.map(h => h.get({ plain: true })).reverse();

            if (history.length < 3) return;

            const summaryText = await generateChatSummary(history);

            const [record, created] = await ChatSummary.findOrCreate({
                where: { store_wa_id: storeWaId, contact_id: contactId },
                defaults: { summary: summaryText, contact_name: senderName, last_updated: new Date() }
            });

            if (!created) {
                record.summary = summaryText;
                record.contact_name = senderName || record.contact_name;
                record.last_updated = new Date();
                await record.save();
            }

            let display = contactId;
            try {
                const { ChatSummary } = require('../database/index');
                const summary = await ChatSummary.findOne({ where: { store_wa_id: storeWaId, contact_id: contactId } });
                if (summary && summary.contact_name) {
                    display = `[${summary.contact_name}${summary.contact_phone ? ' | +' + summary.contact_phone : ''}] (${contactId})`;
                }
            } catch (e) { /* ignore */ }
            logger.info(`[BotActivation] Rekap ${display} diperbarui (CS manual context).`);

            // ── SMART LABEL ENGINE (Non-blocking) ──────────────────────────────
            // Terapkan label WA Business + simpan ke DB dari rekap manual CS
            try {
                const { applyLabelsFromSummary } = require('./smart_label_service');
                let waClient = null;
                try {
                    const { getActiveClient } = require('../whatsapp_service');
                    waClient = getActiveClient(storeWaId);
                } catch (_) {}
                applyLabelsFromSummary(storeWaId, contactId, summaryText, waClient).catch(e =>
                    logger.warn(`[BotActivation] Smart label manual update error: ${e.message}`)
                );
            } catch (labelErr) {
                logger.warn(`[BotActivation] Smart label setup manual error: ${labelErr.message}`);
            }

        } catch (e) {
            logger.warn(`[BotActivation] Gagal update rekap [${contactId}]: ${e.message}`);
        }
    }, 60 * 1000); // Tunggu 60 detik sebelum hit OpenAI (menggabungkan burst CS manual)

    _summaryDebounce.set(key, timerId);
}

/**
 * Trigger summary update dari luar (dipanggil oleh whatsapp_service saat CS manual balas).
 * Debounced 30 detik untuk menghindari banyak rekap saat CS kirim pesan berturut-turut.
 *
 * @param {string} storeWaId
 * @param {string} contactId
 * @param {string} senderName
 */
const _externalSummaryDebounce = new Map();

function triggerCsManualSummaryUpdate(storeWaId, contactId, senderName) {
    const key = `${storeWaId}_${contactId}`;

    if (_externalSummaryDebounce.has(key)) {
        clearTimeout(_externalSummaryDebounce.get(key));
    }

    const timerId = setTimeout(async () => {
        _externalSummaryDebounce.delete(key);
        await _triggerSummaryUpdate(storeWaId, contactId, senderName);
    }, 30 * 1000); // Debounce 30 detik dari pesan CS terakhir

    _externalSummaryDebounce.set(key, timerId);
}

module.exports = {
    onBotActivated,
    isConversationClosed,
    isConversationActive,
    triggerCsManualSummaryUpdate
};
