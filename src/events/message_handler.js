/**
 * @file message_handler.js
 * @description Core Message Engine — Production-Grade Refactored.
 *
 * KEY UPGRADES:
 *  - Smart Message Debouncer: Menunggu sebentar sebelum proses AI,
 *    menggabungkan semua pesan beruntun menjadi 1 request (Anti-Spam)
 *  - Media Download Timeout: Mencegah hang jika pelanggan hapus pesan
 *  - Graceful Error Recovery: Tidak pernah crash, selalu log
 *  - Anti-Leak Storage: File sementara langsung dihapus setelah analisis
 */

const logger = require('../utils/logger');
const { getAIResponse, calculateTypingDelay, prepareOutboundBubbles, RESPONSE_TYPE } = require('../ai_service');
const { Store, ChatMessage } = require('../database/index');
const { analyzeImage } = require('../services/vision_service');
const { safeSendReactionToMessage, safeAddLabelByName, resolvePhoneForChatId, safeMarkIsRead } = require('../services/wajs_bridge');
const dashboard = require('../services/dashboard_service');
const path = require('path');
const fs = require('fs');
const { MessageMedia } = require('whatsapp-web.js');
const { UPLOADS_DIR } = require('../config');
const { buildContactIdentity, shouldIgnoreIncomingChat } = require('../utils/contact_identity');

function formatWaNumber(id) {
    if (!id) return '';
    let num = id.split('@')[0];
    if (num.startsWith('62')) return `+62 ${num.slice(2, 5)}-${num.slice(5, 9)}-${num.slice(9)}`;
    return `+${num}`;
}

// ══════════════════════════════════════════════════════════════════
// PERSISTENT PAUSE REGISTRY (Human Override — Survives Restart)
// ══════════════════════════════════════════════════════════════════

// In-memory cache yang di-sync dari DB saat startup
const pausedContacts = new Set();

/**
 * Load semua paused contacts dari database ke memory saat startup.
 * Dipanggil otomatis saat module di-require pertama kali.
 */
async function _loadPausedFromDB() {
    try {
        const { PausedContact } = require('../database/index');
        const records = await PausedContact.findAll();
        records.forEach(r => pausedContacts.add(`${r.store_wa_id}_${r.contact_id}`));
        if (records.length > 0) {
            logger.info(`[Pause] Dipulihkan ${records.length} kontak yang dipause dari database.`);
        }
    } catch (e) {
        // Table mungkin belum ada saat pertama kali — diabaikan
    }
}

// Auto-load saat module di-require (setelah DB init)
setTimeout(() => _loadPausedFromDB(), 3000);

async function pauseBotForContact(storeWaId, contactId) {
    const key = `${storeWaId}_${contactId}`;
    pausedContacts.add(key);
    try {
        const { PausedContact } = require('../database/index');
        await PausedContact.findOrCreate({
            where: { store_wa_id: storeWaId, contact_id: contactId },
            defaults: { paused_at: new Date(), paused_by: 'manual' }
        });
    } catch (e) { /* DB write fail is non-critical */ }
    logger.info(`[${storeWaId}] Bot DIPAUSE secara manual untuk kontak: ${contactId}`);
}

async function resumeBotForContact(storeWaId, contactId) {
    const key = `${storeWaId}_${contactId}`;
    pausedContacts.delete(key);
    try {
        const { PausedContact } = require('../database/index');
        await PausedContact.destroy({ where: { store_wa_id: storeWaId, contact_id: contactId } });
    } catch (e) { /* DB delete fail is non-critical */ }
    logger.info(`[${storeWaId}] Bot DIAKTIFKAN KEMBALI untuk kontak: ${contactId}`);
}

// ══════════════════════════════════════════════════════════════════
// SMART MESSAGE DEBOUNCER (Anti-Spam / Anti-Brutal AI)
//
// Mekanisme:
//  1. Pelanggan kirim "Halo"       → Timer singkat dimulai
//  2. Pelanggan kirim "Mau tanya"  → Timer di-reset
//  3. Pelanggan kirim "Harganya?"  → Timer di-reset
//  4. Timer berlalu tanpa pesan baru → Semua digabung: "Halo\nMau tanya\nHarganya?"
//  5. AI memproses 1 kali saja → 1 balasan koheren.
// ══════════════════════════════════════════════════════════════════
const DEBOUNCE_MS = Number(process.env.AI_REPLY_DEBOUNCE_MS || 1200); // Responsif, tetap menahan chat beruntun singkat
const ACTIVE_REPLY_WAIT_MS = Number(process.env.AI_ACTIVE_REPLY_WAIT_MS || 600);
const THINKING_DELAY_MIN_MS = Number(process.env.AI_THINKING_DELAY_MIN_MS || 80);
const THINKING_DELAY_JITTER_MS = Number(process.env.AI_THINKING_DELAY_JITTER_MS || 200);
const BETWEEN_BUBBLE_DELAY_MS = Number(process.env.AI_BETWEEN_BUBBLE_DELAY_MS || 200);
const BETWEEN_MEDIA_DELAY_MS = Number(process.env.AI_BETWEEN_MEDIA_DELAY_MS || 500);
const MEDIA_STABILITY_DELAY_MS = Number(process.env.WA_MEDIA_STABILITY_DELAY_MS || 250);
const WA_TYPING_PULSE_MS = Number(process.env.WA_TYPING_PULSE_MS || 5000);
const WA_TYPING_HARD_STOP_MS = Number(process.env.WA_TYPING_HARD_STOP_MS || 7000);
const WA_SEND_RETRY_DELAY_MS = Number(process.env.WA_SEND_RETRY_DELAY_MS || 1200);
const debounceTimers = new Map();      // Key: 'storeWaId_contactId' → timeoutId
const pendingMessages = new Map();     // Key: 'storeWaId_contactId' → { messages: [], mediaContexts: [], tempPaths: [], senderName, message (last) }

/**
 * Handle incoming message event — Entry Point
 * Setiap pesan masuk TIDAK langsung diproses AI.
 * Ia akan ditampung dulu oleh Debouncer.
 */
const autoLabelCache = new Set();
const activeAIReplies = new Set();
const queuedAIReplyBatches = new Map();
const coalescedReplyLogAt = new Map();

// In-memory cache to prevent processing the same WWebJS message multiple times
const processedIncomingMsgIds = new Set();
setInterval(() => processedIncomingMsgIds.clear(), 3600000); // Clear every hour


function _scheduleAutoLabels(message, storeWaId, contactId, identity) {
    if (process.env.WAJS_AUTO_LABEL_ENABLED === 'false') return;
    if (!message?.client) return;

    const cacheKey = `${storeWaId}:${contactId}`;
    if (autoLabelCache.has(cacheKey)) return;
    autoLabelCache.add(cacheKey);

    setTimeout(() => {
        safeAddLabelByName(message.client, contactId, 'AI Lead Baru', undefined, storeWaId);
        if (identity?.type === 'lid') {
            safeAddLabelByName(message.client, contactId, 'Kontak LID', undefined, storeWaId);
        }
    }, 0);
}

function _mergeReplyBatches(existing, incoming) {
    if (!existing) return incoming;
    return {
        messages: [...(existing.messages || []), ...(incoming.messages || [])],
        mediaContexts: [...(existing.mediaContexts || []), ...(incoming.mediaContexts || [])],
        tempPaths: [...(existing.tempPaths || []), ...(incoming.tempPaths || [])],
        senderName: incoming.senderName || existing.senderName,
        lastMessage: incoming.lastMessage || existing.lastMessage
    };
}

function _getMessageId(message) {
    return message?.id?._serialized || message?.id?.id || message?.quotedMsgId || message?.quoted_message_id || '';
}

function _clipQuoteBody(value, maxLength = 500) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function _quoteContextFromMessage(message, fallbackSender = '') {
    const quotedBody = _clipQuoteBody(message?.body || message?.caption || message?.quotedBody || message?.quoted_body || '');
    return {
        quoted_message_id: _getMessageId(message),
        quoted_body: quotedBody || (message?.hasMedia ? '(Media)' : ''),
        quoted_from_me: Boolean(message?.fromMe),
        quoted_sender_name: fallbackSender || (message?.fromMe ? 'Admin/AI' : 'Pelanggan')
    };
}

function _isVideoMediaAsset(mediaAsset = {}) {
    const ext = path.extname(mediaAsset.filename || '').toLowerCase();
    return mediaAsset.type === 'video' || ['.mp4', '.mov', '.avi', '.mkv', '.3gp'].includes(ext);
}

async function _extractQuotedContext(message, storeWaId) {
    try {
        const directQuotedId = message?.quotedMsgId || message?.quoted_message_id || message?._data?.quotedMsg?.id?._serialized || message?._data?.quotedMsgId?._serialized || message?._data?.quotedStanzaID;
        const directQuotedBody = message?.quotedBody || message?.quoted_body || message?._data?.quotedMsg?.body || message?._data?.quotedMsg?.caption || '';

        if (message?.hasQuotedMsg && typeof message.getQuotedMessage === 'function') {
            const quoted = await message.getQuotedMessage();
            if (quoted) {
                return _quoteContextFromMessage(quoted, quoted.fromMe ? 'Admin/AI' : 'Pelanggan');
            }
        }

        if (directQuotedId || directQuotedBody) {
            return {
                quoted_message_id: directQuotedId || null,
                quoted_body: _clipQuoteBody(directQuotedBody),
                quoted_from_me: message?.quotedFromMe ?? message?.quoted_from_me ?? null,
                quoted_sender_name: message?.quotedSenderName || message?.quoted_sender_name || null
            };
        }
    } catch (error) {
        logger.warn(`[${storeWaId}] Gagal membaca konteks quoted reply: ${error.message}`);
    }
    return {};
}

async function handleMessage(message, storeWaId, shouldAIReply = true) {
    if (message.isStatus || shouldIgnoreIncomingChat(message.from)) return;

    // FIREWALL 0: Duplicate Message Prevention
    // WWebJS sometimes emits unread messages again upon reconnection.
    const msgId = message.id?._serialized || message.id?.id;
    if (msgId) {
        if (processedIncomingMsgIds.has(msgId)) {
            logger.info(`[${storeWaId}] Mengabaikan pesan duplikat (memory cache): ${msgId}`);
            return;
        }
        processedIncomingMsgIds.add(msgId);

        try {
            const existing = await ChatMessage.findOne({ where: { wa_message_id: msgId }, attributes: ['id'] });
            if (existing) {
                logger.info(`[${storeWaId}] Mengabaikan pesan duplikat (DB cache): ${msgId}`);
                return;
            }
        } catch (e) {
            // Abaikan error DB agar tidak memblokir alur
        }
    }

    const contactId = message.from;
    const body = message.body || "";
    const debounceKey = `${storeWaId}_${contactId}`;
    let customerMediaContext = "";
    let tempPath = "";
    // Deklarasi identity di awal agar selalu tersedia (termasuk di catch block)
    let identity = { displayName: contactId, phone: null, lid: null, type: 'unknown', source: 'fallback' };
    let senderName = contactId;

    try {
        // ═══════════════════════════════════════════════════════
        // STEP 1: CEK & ANALISIS MEDIA (Vision / Whisper)
        // ═══════════════════════════════════════════════════════
        const isSticker = message.type === 'sticker';
        
        if (message.hasMedia && !isSticker) {
            // Timeout Wrapper: Mencegah hang jika pesan sudah dihapus
            const media = await _downloadMediaWithTimeout(message, 20000);
            if (!media) {
                logger.warn(`[${storeWaId}] Media gagal diunduh (mungkin sudah dihapus). Lanjut proses teks.`);
            } else {
                // A. FOTO (Vision)
                if (media.mimetype.startsWith('image/')) {
                    logger.info(`[${storeWaId}] Menerima foto dari pelanggan. Menganalisis...`);
                    const fileName = `customer_${storeWaId}_${Date.now()}.${media.mimetype.split('/')[1]}`;
                    tempPath = path.join(UPLOADS_DIR, fileName);
                    fs.writeFileSync(tempPath, Buffer.from(media.data, 'base64'));

                    const { BotAgent } = require('../database/index');
                    const store = await Store.findOne({ 
                        where: { wa_id: storeWaId },
                        include: [{ model: BotAgent, as: 'BotAgent' }]
                    });
                    const agent = store?.BotAgent;
                    const storeContext = `Nama Toko: ${store?.name || 'Toko'}\nKonten Agen: ${agent?.product_knowledge || ''}`;
                    const analysis = await analyzeImage(tempPath, storeContext);
                    
                    logger.success(`[${storeWaId}] AI "melihat" foto pelanggan.`);
                    customerMediaContext = `[MEDIA:/uploads/${fileName}]\n\n[AI-VISION: ${analysis}]`;
                }

                // B. VOICE NOTE (Transcription)
                if (media.mimetype.startsWith('audio/')) {
                    logger.info(`[${storeWaId}] Menerima Voice Note. Mendengarkan...`);
                    const audioExt = media.mimetype.split('/')[1].split(';')[0] || 'ogg';
                    const audioName = `voice_${storeWaId}_${Date.now()}.${audioExt}`;
                    const audioPath = path.join(UPLOADS_DIR, audioName);
                    tempPath = audioPath;
                    fs.writeFileSync(audioPath, Buffer.from(media.data, 'base64'));

                    const { transcribeAudio } = require('../ai_service');
                    const transcription = await transcribeAudio(audioPath);

                    if (transcription) {
                        logger.success(`[${storeWaId}] AI "mendengar" VN: ${transcription}`);
                        customerMediaContext = `[AI-TRANSKRIPSI: ${transcription}]`;
                    }
                }
            }
        } else if (isSticker) {
            customerMediaContext = `(Pelanggan Mengirim Stiker)`;
        }

        // ═══════════════════════════════════════════════════════
        // STEP 2: LOG PESAN KE DATABASE & DASHBOARD (SELALU)
        // Blok ini SELALU dijalankan, terlepas dari status bot ON/OFF.
        // Tujuan: pastikan SEMUA pesan customer tersimpan untuk CS manusia & audit.
        // ═══════════════════════════════════════════════════════
        const logBody = customerMediaContext 
            ? `${customerMediaContext}\n${body}`.trim()
            : body;

        if (!logBody) {
            logger.info(`[${storeWaId}] Pesan kosong dari [${contactId}] diabaikan.`);
            _cleanupTempFile(tempPath, storeWaId);
            return;
        }

        let contact = {};
        try {
            contact = await message.getContact();
        } catch (e) {
            logger.warn(`[${storeWaId}] Gagal membaca profil kontak [${contactId}]: ${e.message}`);
        }
        let resolvedPhone = '';
        if (contactId.endsWith('@lid') && message.client) {
            try {
                let resolved = await resolvePhoneForChatId(message.client, contactId, storeWaId);
                if (!resolved?.phone) {
                    // Coba fallback menggunakan native contact info dari klien
                    let nativeContact = await message.client.getContactById(contactId);
                    if (nativeContact && nativeContact.number) {
                        resolvedPhone = nativeContact.number;
                    }
                } else {
                    resolvedPhone = resolved.phone;
                }
            } catch (_) {}
            
            // BACKGROUND TASK: Jika nomor HP belum dapat (karena LID lambat sinkron),
            // lakukan pencarian lagi di background setelah 5 detik dan update Dashboard.
            if (!resolvedPhone) {
                setTimeout(async () => {
                    try {
                        let finalResolved = await resolvePhoneForChatId(message.client, contactId, storeWaId);
                        if (!finalResolved?.phone) {
                            let finalContact = await message.client.getContactById(contactId);
                            if (finalContact && finalContact.number) {
                                finalResolved = { phone: finalContact.number, contact: finalContact };
                            }
                        }
                        if (finalResolved && finalResolved.phone) {
                            dashboard.updateContactPhoneIdentity(storeWaId, contactId, finalResolved);
                        }
                    } catch (e) {}
                }, 5000);
            }
        }
        try {
            identity = buildContactIdentity(contactId, {
                name: contact.name,
                pushname: contact.pushname,
                shortName: contact.shortName,
                displayName: contact.displayName,
                number: resolvedPhone || contact.number
            });
        } catch (identityErr) {
            logger.warn(`[${storeWaId}] buildContactIdentity gagal [${contactId}]: ${identityErr.message}`);
            // identity tetap menggunakan default fallback dari atas
        }
        senderName = identity.displayName;
        const quotedContext = await _extractQuotedContext(message, storeWaId);

        await dashboard.addToChatHistory(storeWaId, {
            id: message.id?._serialized || message.id?.id,
            from: contactId,
            body: logBody,
            isMe: false,
            timestamp: new Date(),
            sender_name: senderName,
            contactIdentity: identity,
            ...quotedContext
        });
        _scheduleAutoLabels(message, storeWaId, contactId, identity);

        // Cancel pending follow-ups ketika customer merespons (SELALU, terlepas bot ON/OFF)
        try {
            const { cancelPendingFollowUps } = require('../services/followup_service');
            await cancelPendingFollowUps(storeWaId, contactId, 'Customer merespons');
        } catch (e) { /* Non-critical: follow-up cancel failure */ }

        // ── BACKGROUND SUMMARY UPDATE (SELALU — bot ON maupun OFF) ──────────────
        // Rekap percakapan diperbarui setiap kali customer mengirim pesan,
        // agar ketika bot dinyalakan kembali, AI langsung tau konteks terbarunya.
        // Debounced 60 detik agar tidak membebani OpenAI saat customer kirim banyak pesan.
        _triggerBackgroundSummaryIfNeeded(storeWaId, contactId, senderName);

        const logDisplay = `[${identity.displayName || ''}${identity.phone ? ' | +' + identity.phone : ''}] (${contactId})`;
        logger.info(`[${storeWaId}] Pesan masuk terdaftar: ${logDisplay}`);

        // ═══════════════════════════════════════════════════════
        // FIREWALL 1: MODE SINKRONISASI (Tanpa AI Reply)
        // ═══════════════════════════════════════════════════════
        if (!shouldAIReply) {
            logger.info(`[${storeWaId}] Jalur Sinkronisasi: Pesan dicatat, AI Dilewati.`);
            _cleanupTempFile(tempPath, storeWaId);
            return;
        }

        // ═══════════════════════════════════════════════════════
        // FIREWALL 2: HUMAN OVERRIDE (Bot Dipause per-kontak)
        // ═══════════════════════════════════════════════════════
        if (pausedContacts.has(debounceKey)) {
            logger.info(`[${storeWaId}] Bot sedang dipause (Human Override) untuk: ${logDisplay}`);
            _cleanupTempFile(tempPath, storeWaId);
            return;
        }

        // ═══════════════════════════════════════════════════════
        // FIREWALL 3: GLOBAL BOT OFF CHECK (Early DB Check)
        // Cek is_bot_active SEBELUM masuk debouncer agar tidak buang CPU.
        // Double-checked lagi di _processAIReplyUnlocked (defense-in-depth).
        // ═══════════════════════════════════════════════════════
        try {
            const storeCheck = await Store.findOne({ where: { wa_id: storeWaId }, attributes: ['is_bot_active'] });
            if (!storeCheck || storeCheck.is_bot_active === false) {
                logger.info(`[${storeWaId}] Bot NON-AKTIF (FIREWALL 3). Pesan dari ${logDisplay} dicatat, AI tidak membalas.`);
                // FIREWALL 3: Kirim reaction hanya saat bot aktif (tidak leaking presence ke customer)
                if (customerMediaContext) {
                    safeSendReactionToMessage(message, '\uD83D\uDC4D', storeWaId);
                }
                _cleanupTempFile(tempPath, storeWaId);
                return;
            }
        } catch (fwErr) {
            // Jika DB check gagal, lanjut ke layer berikutnya (defense-in-depth tetap aman)
            logger.warn(`[${storeWaId}] FIREWALL 3 DB check gagal: ${fwErr.message}. Lanjut ke layer berikutnya.`);
        }

        // Reaction 👍 hanya dikirim jika bot AKTIF (tidak membingungkan customer di mode CS manual)
        if (customerMediaContext) {
            safeSendReactionToMessage(message, '\uD83D\uDC4D', storeWaId);
        }

        // ═══════════════════════════════════════════════════════
        // STEP 3: DEBOUNCER — Tampung pesan, tunggu singkat sesuai AI_REPLY_DEBOUNCE_MS
        // ═══════════════════════════════════════════════════════
        // Batalkan timer sebelumnya jika ada (pelanggan masih mengetik)
        if (debounceTimers.has(debounceKey)) {
            clearTimeout(debounceTimers.get(debounceKey));
        }

        // Tampung pesan ke buffer
        if (!pendingMessages.has(debounceKey)) {
            pendingMessages.set(debounceKey, {
                messages: [],
                mediaContexts: [],
                tempPaths: [],
                senderName: senderName,
                lastMessage: message  // Simpan reference pesan terakhir untuk reply
            });
        }

        const buffer = pendingMessages.get(debounceKey);
        if (body) buffer.messages.push(body);
        if (customerMediaContext) buffer.mediaContexts.push(customerMediaContext);
        if (tempPath) buffer.tempPaths.push(tempPath);
        buffer.senderName = senderName;
        buffer.lastMessage = message;

        // Set timer baru: Proses AI hanya jika tidak ada pesan baru dalam window debounce
        const timerId = setTimeout(async () => {
            debounceTimers.delete(debounceKey);
            const batch = pendingMessages.get(debounceKey);
            pendingMessages.delete(debounceKey);

            if (!batch) return;

            try {
                await _processAIReply(storeWaId, contactId, batch);
            } catch (err) {
                logger.error(`[${storeWaId}] Debounced AI Error [${contactId}]: ${err.message}`);
            } finally {
                // Bersihkan SEMUA file sementara dari batch ini
                for (const tp of batch.tempPaths) {
                    _cleanupTempFile(tp, storeWaId);
                }
            }
        }, DEBOUNCE_MS);

        debounceTimers.set(debounceKey, timerId);

    } catch (error) {
        logger.error(`[${storeWaId}] Gagal memproses [${contactId}]: ${error.message}`);
        _cleanupTempFile(tempPath, storeWaId);
    }
}

/**
 * PROSES AI REPLY — Dipanggil oleh Debouncer setelah pelanggan selesai mengetik.
 * Menerima batch pesan yang sudah digabung.
 */
async function _processAIReply(storeWaId, contactId, batch) {
    const replyKey = `${storeWaId}_${contactId}`;
    if (activeAIReplies.has(replyKey)) {
        queuedAIReplyBatches.set(replyKey, _mergeReplyBatches(queuedAIReplyBatches.get(replyKey), batch));
        const now = Date.now();
        const lastLogAt = coalescedReplyLogAt.get(replyKey) || 0;
        if (now - lastLogAt > 5000) {
            logger.info(`[${storeWaId}] AI masih membalas [${contactId}]. Batch baru digabung ke antrean lanjutan, bukan dibuat menunggu sendiri.`);
            coalescedReplyLogAt.set(replyKey, now);
        }
        return;
    }
    const MAX_WAIT_MS = 180000; // 3 menit — prevent infinite spin jika AI sebelumnya hang
    const startWait = Date.now();

    while (activeAIReplies.has(replyKey)) {
        if (Date.now() - startWait > MAX_WAIT_MS) {
            // Paksa hapus kunci yang stuck agar tidak blokir selamanya
            logger.warn(`[${storeWaId}] Paksa hapus lock AI yang macet untuk [${contactId}] (timeout 3 menit).`);
            activeAIReplies.delete(replyKey);
            break;
        }
        logger.info(`[${storeWaId}] AI reply untuk [${contactId}] masih berjalan. Menahan batch baru agar tidak spam.`);
        await new Promise(resolve => setTimeout(resolve, ACTIVE_REPLY_WAIT_MS));
    }

    activeAIReplies.add(replyKey);
    try {
        let currentBatch = batch;
        while (currentBatch) {
            try {
                await _processAIReplyUnlocked(storeWaId, contactId, currentBatch);
            } catch (err) {
                logger.error(`[${storeWaId}] AI reply gagal untuk [${contactId}]: ${err.message}`);
            }

            currentBatch = queuedAIReplyBatches.get(replyKey);
            queuedAIReplyBatches.delete(replyKey);
            if (currentBatch) {
                logger.info(`[${storeWaId}] Memproses batch lanjutan yang sudah digabung untuk [${contactId}].`);
            }
        }
    } finally {
        activeAIReplies.delete(replyKey);
        coalescedReplyLogAt.delete(replyKey);
    }
}

async function _processAIReplyUnlocked(storeWaId, contactId, batch) {
    const { messages, mediaContexts, senderName, lastMessage } = batch;

    // Gabungkan semua pesan menjadi 1 paragraf
    const combinedBody = messages.join('\n').trim();
    const combinedMedia = mediaContexts.join('\n').trim();

    // 1. Ambil Konfigurasi Bot & Agen dari DB
    const { BotAgent } = require('../database/index');
    const store = await Store.findOne({ 
        where: { wa_id: storeWaId },
        include: [{ model: BotAgent, as: 'BotAgent' }]
    });
    const agent = store?.BotAgent;

    // JIKA STORE TIDAK ADA atau BOT OFF: Berhenti
    if (!store || store.is_bot_active === false) {
        logger.info(`[${storeWaId}] Bot NON-AKTIF untuk Toko ini. Mengirim sinyal pembaruan rekap secara background...`);
        try {
            const { triggerCsManualSummaryUpdate } = require('./services/bot_activation_service');
            triggerCsManualSummaryUpdate(storeWaId, contactId, senderName);
        } catch (e) { /* non-critical */ }
        return;
    }

    // JIKA BELUM ADA AGEN TERPASANG: Berhenti
    if (!agent) {
        logger.warn(`[${storeWaId}] Perangkat ini belum terikat ke Agen AI manapun.`);
        return;
    }

    let chat = null;
    try {
        chat = typeof lastMessage.getChat === 'function' ? await lastMessage.getChat() : null;
    } catch (error) {
        logger.warn(`[${storeWaId}] Gagal membaca chat aktif [${contactId}]: ${error.message}`);
    }
    let stopTyping = () => {};

    try {
    // 2. Ambil Riwayat Chat & Rekapan Sebelumnya
    const recentHistory = await ChatMessage.findAll({
        where: { contact_id: contactId, store_wa_id: storeWaId },
        limit: 30,
        order: [['timestamp', 'DESC']]
    });
    const history = recentHistory.map(h => h.get({ plain: true })).reverse();

    const { ChatSummary } = require('../database/index');
    const summaryRecord = await ChatSummary.findOne({ where: { store_wa_id: storeWaId, contact_id: contactId } });
    const summary = summaryRecord?.summary || "Percakapan baru saja dimulai.";

    // 3. Status Terbaca (Centang Biru)
    await safeMarkIsRead(lastMessage.client, contactId, storeWaId);

    // 4. MARKETING AUTOPILOT (Trigger Keyword Check)
    const { MediaAsset } = require('../database/index');
    const agentAssets = await MediaAsset.findAll({ where: { agent_id: agent.id } });
    let triggeredAsset = null;

    for (const asset of agentAssets) {
        if (!asset.trigger_words) continue;
        const keywords = asset.trigger_words.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
        const bodyLower = combinedBody.toLowerCase();
        
        // Menggunakan exact word boundary untuk menghindari salah deteksi (misal "namanya" terdeteksi "nama")
        if (keywords.some(kw => {
            // Escape regex khusus agar aman
            const safeKw = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`\\b${safeKw}\\b`, 'i');
            return regex.test(bodyLower);
        })) {
            triggeredAsset = asset;
            break;
        }
    }

    let autopilotContext = "";
    if (triggeredAsset) {
        logger.success(`[${storeWaId}] Keyword trigger [${agent.name}] aktif. Mengirim Katalog via Autopilot!`);
        await _markTyping(chat, storeWaId, contactId, lastMessage.client);
        await new Promise(r => setTimeout(r, 1200)); 
        
        const caption = triggeredAsset.description || triggeredAsset.label;
        await _sendMediaToChat(lastMessage, triggeredAsset, caption, storeWaId, contactId, agent);
        
        // Beri tahu AI bahwa sistem baru saja mengirim gambar ini agar tidak dikirim ulang
        autopilotContext = `\n\n[SISTEM: Sistem baru saja otomatis mengirimkan gambar/katalog '${triggeredAsset.label}' ke pelanggan berdasarkan kata kuncinya. Lanjutkan obrolan secara natural dan JANGAN kirim gambar yang sama.]`;
    }

    // Gabungkan konteks autopilot ke body pesan agar AI tahu
    const finalBodyForAI = combinedBody + autopilotContext;

    // 4. Jeda berpikir singkat agar respons tetap terasa natural tanpa membuat customer menunggu lama.
    await new Promise(r => setTimeout(r, Math.floor(Math.random() * THINKING_DELAY_JITTER_MS) + THINKING_DELAY_MIN_MS));

    // 5. Status Mengetik
    // Typing WA sengaja ditunda sampai respons siap dikirim, agar tidak muncul lama lalu hilang.

    // 6. PROSES AI (dengan pesan yang sudah digabung)
    const interactionCount = history.filter(h => !h.is_from_me).length + 1;
    // Ambil nomor HP customer dari summary record untuk diinjeksi ke AI prompt.
    // CATATAN: variabel `identity` TIDAK tersedia di scope ini (hanya ada di handleMessage).
    // Fallback: ekstrak dari contactId langsung (62xxx@c.us → 62xxx) jika summary belum punya nomor.
    const _phoneFromContactId = typeof contactId === 'string' ? contactId.replace(/@(c\.us|lid|s\.whatsapp\.net)$/, '') : '';
    const customerPhone = summaryRecord?.contact_phone || _phoneFromContactId || '';
    const aiResult = await getAIResponse(finalBodyForAI, history, store, agent, combinedMedia, summary, interactionCount, customerPhone);
    
    // SAFETY NET: Pastikan selalu ada konten untuk membalas, mencegah error WWebJS "Message cannot be empty"
    const fallbackContent = aiResult.content || "Mohon maaf, saya sedang kesulitan memproses pesan Anda. Bisa diulangi pertanyaannya Kak?";

    const outboundBubbles = prepareOutboundBubbles(fallbackContent);
    const primaryTextForDelay = outboundBubbles[0] || fallbackContent;

    // 7. Siapkan jeda mengetik singkat. Heartbeat dimulai nanti, tepat sebelum kirim.
    // Hard cap 4500ms agar total waktu typing + kirim customer selalu < 7 detik
    const typingDelay = Math.min(calculateTypingDelay(primaryTextForDelay), 4500);

    // 8. Eksekusi Tool Khusus Non-Pesan (misal: Auto-Label)
    if (aiResult.tool_calls && aiResult.tool_calls.length > 0) {
        for (const tc of aiResult.tool_calls) {
            if (tc.function.name === 'tambahkan_label_chat') {
                try {
                    const args = JSON.parse(tc.function.arguments);
                    const { safeAddLabelByName } = require('../services/wajs_bridge');
                    const labelNames = args.label_names || [];
                    for (const labelName of labelNames) {
                        await safeAddLabelByName(lastMessage.client, contactId, labelName, undefined, storeWaId);
                        logger.success(`[${storeWaId}] AI otomatis melabeli '${labelName}' untuk [${contactId}]`);
                    }
                } catch (e) {
                    logger.warn(`[${storeWaId}] AI gagal menambah label: ${e.message}`);
                }
            }

            if (tc.function.name === 'matikan_bot_kontak') {
                try {
                    const args = JSON.parse(tc.function.arguments || '{}');
                    await pauseBotForContact(storeWaId, contactId);
                    logger.info(`[${storeWaId}] AI mem-pause bot untuk [${contactId}]: ${args.reason || 'perlu CS manusia'}`);
                } catch (e) {
                    logger.warn(`[${storeWaId}] AI gagal mem-pause bot: ${e.message}`);
                }
            }
        }
    }

    stopTyping = _startTypingHeartbeat(chat, storeWaId, contactId, lastMessage.client, Math.max(WA_TYPING_HARD_STOP_MS, typingDelay + 1000));
    await new Promise(r => setTimeout(r, typingDelay));

    // 9. KIRIM RESPONS
    try {
        // TAHAP AKHIR: Cek status toggle satu kali lagi SEBELUM benar-benar mengirim.
        // Jika CS mematikan toggle selama masa "delay mengetik" atau pemrosesan AI, BATALKAN PENGIRIMAN.
        if (pausedContacts.has(`${storeWaId}_${contactId}`)) {
            logger.warn(`[${storeWaId}] HARD STOP: Pengiriman pesan AI digugurkan karena Toggle dimatikan secara manual oleh CS untuk [${contactId}]`);
            return;
        }

        if (aiResult.type === RESPONSE_TYPE.MEDIA && aiResult.mediaList && aiResult.mediaList.length > 0) {
            const hasVideo = aiResult.mediaList.some(item => _isVideoMediaAsset(item.media));
            let textAlreadySent = false;

            if (aiResult.content && hasVideo) {
                await _sendTextBubbles(lastMessage, chat, storeWaId, contactId, outboundBubbles, agent.bot_name);
                textAlreadySent = true;
            }

            for (let i = 0; i < aiResult.mediaList.length; i++) {
                // Cek lagi tiap loop media (jika ada jeda)
                if (pausedContacts.has(`${storeWaId}_${contactId}`)) {
                    logger.warn(`[${storeWaId}] HARD STOP: Pengiriman media AI digugurkan di tengah jalan.`);
                    return;
                }
                const item = aiResult.mediaList[i];
                await _markTyping(chat, storeWaId, contactId, lastMessage.client);
                await _sendMediaToChat(lastMessage, item.media, item.caption || "", storeWaId, contactId, agent);
                
                if (i < aiResult.mediaList.length - 1) {
                    await new Promise(r => setTimeout(r, BETWEEN_MEDIA_DELAY_MS));
                }
            }

            if (aiResult.content && !textAlreadySent) {
                if (pausedContacts.has(`${storeWaId}_${contactId}`)) return;
                await _sendTextBubbles(lastMessage, chat, storeWaId, contactId, outboundBubbles, agent.bot_name);
            }
        } else {
            if (pausedContacts.has(`${storeWaId}_${contactId}`)) return;
            await _sendTextBubbles(lastMessage, chat, storeWaId, contactId, outboundBubbles, agent.bot_name);
        }
        logger.success(`[${storeWaId}] Sesi [${contactId}] — Dibalas via AI (${messages.length} pesan digabung).`);
    } catch (sendErr) {
        logger.error(`[${storeWaId}] Gagal mengirim balasan AI ke [${contactId}]: ${sendErr.message}`);
    }

    // TAHAP 4: Update Rekap Chat (Summary) & Jadwalkan Follow-Up secara background (Non-blocking)
    _updateConversationSummary(storeWaId, contactId, senderName);

    } finally {
        stopTyping();
    }
}

// ══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ══════════════════════════════════════════════════════════════════

/**
 * Download media dengan timeout (Anti-Hang).
 * Jika pelanggan menghapus pesannya sebelum bot mengunduh, ini akan timeout dengan aman.
 */
function _isDetachedFrameError(error) {
    return /detached Frame|Execution context was destroyed|Target closed|Session closed|Cannot find context|Protocol error/i
        .test(String(error?.message || error || ''));
}

async function _sendActiveMessage(storeWaId, contactId, payload, options = {}) {
    const { waitForActiveClient, restartClientRuntime } = require('../whatsapp_service');
    let lastError;

    for (let attempt = 1; attempt <= 2; attempt++) {
        const client = await waitForActiveClient(storeWaId);
        try {
            return await client.sendMessage(contactId, payload, options);
        } catch (error) {
            lastError = error;
            if (!_isDetachedFrameError(error) || attempt === 2) {
                throw error;
            }
            logger.warn(`[${storeWaId}] Client WA sempat detach saat kirim ke [${contactId}], mencoba ulang dengan client aktif...`);
            restartClientRuntime(storeWaId, 'send-detached-frame').catch(() => {});
            await new Promise(r => setTimeout(r, WA_SEND_RETRY_DELAY_MS));
        }
    }

    throw lastError;
}

async function _markTyping(chat, storeWaId, contactId, client) {
    try {
        const { isCurrentClient } = require('../whatsapp_service');
        if (client && !isCurrentClient(storeWaId, client)) return false;
        const { safeMarkIsComposing } = require('../services/wajs_bridge');
        const markedByWajs = await safeMarkIsComposing(client, contactId, 6000, storeWaId);
        if (!markedByWajs && typeof chat?.sendStateTyping === 'function') {
            await chat.sendStateTyping();
        }
        dashboard.emitTypingStatus(storeWaId, contactId, true);
        return true;
    } catch (e) {
        // Detached frame = client sudah restart, skip typing DIAM tanpa warning spam
        if (_isDetachedFrameError(e)) return false;
        logger.warn(`[${storeWaId}] Gagal menampilkan typing untuk [${contactId}]: ${e.message}`);
        return false;
    }
}

function _startTypingHeartbeat(chat, storeWaId, contactId, client, hardStopMs = WA_TYPING_HARD_STOP_MS) {
    let stopped = false;
    const pulse = async () => {
        if (stopped) return;
        const ok = await _markTyping(chat, storeWaId, contactId, client);
        if (!ok) stop();
    };

    pulse();
    const interval = setInterval(pulse, WA_TYPING_PULSE_MS);
    const hardStop = setTimeout(() => stop(), hardStopMs);

    function stop() {
        if (stopped) return;
        stopped = true;
        clearInterval(interval);
        clearTimeout(hardStop);
        dashboard.emitTypingStatus(storeWaId, contactId, false);
    }

    return stop;
}

async function _downloadMediaWithTimeout(message, timeoutMs = 20000) {
    try {
        if (typeof message.downloadMedia !== 'function') {
            return null; // Graceful fallback for WA-JS sync messages
        }
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Media download timeout')), timeoutMs)
        );
        return await Promise.race([message.downloadMedia(), timeoutPromise]);
    } catch (e) {
        logger.warn(`[Media] Download gagal/timeout: ${e.message}`);
        return null;
    }
}

/**
 * Mengirim balasan teks sebagai beberapa bubble pendek jika AI memisahkan baris.
 */
async function _sendTextBubbles(message, chat, storeWaId, contactId, bubbles, botName) {
    const list = (Array.isArray(bubbles) ? bubbles : [bubbles])
        .map(item => String(item || '').trim())
        .filter(Boolean);

    const safeList = list.length > 0 ? list : ['Mohon maaf kak, bisa diulangi sebentar?'];
    const debounceKey = `${storeWaId}_${contactId}`;

    for (let i = 0; i < safeList.length; i++) {
        // HARD STOP: Cek apakah bot sudah dipause sebelum kirim tiap bubble
        if (pausedContacts.has(debounceKey)) {
            logger.warn(`[${storeWaId}] HARD STOP: Bubble ke-${i+1} digugurkan karena bot dipause untuk [${contactId}]`);
            return;
        }
        // Juga cek is_bot_active dari database (toggle global)
        try {
            const storeCheck = await Store.findOne({ where: { wa_id: storeWaId }, attributes: ['is_bot_active'] });
            if (!storeCheck || storeCheck.is_bot_active === false) {
                logger.warn(`[${storeWaId}] HARD STOP: Bot global OFF. Bubble ke-${i+1} digugurkan.`);
                return;
            }
        } catch (_) { /* non-critical, lanjut kirim */ }

        const bubble = safeList[i];
        await _markTyping(chat, storeWaId, contactId, message.client);
        if (i > 0) {
            await new Promise(r => setTimeout(r, BETWEEN_BUBBLE_DELAY_MS));
        }

        const quotedMessageId = i === 0 ? _getMessageId(message) : '';
        const sendOptions = quotedMessageId
            ? { quotedMessageId, ignoreQuoteErrors: true }
            : {};
        const sentMsg = await _sendActiveMessage(storeWaId, contactId, bubble, sendOptions);

        // Capture WA message ID to prevent message_create event from double-logging
        const waMessageId = sentMsg?.id?._serialized || sentMsg?.id?.id || null;
        await _logBotReply(storeWaId, contactId, bubble, botName, waMessageId, _quoteContextFromMessage(message, 'Pelanggan'));
    }
}

/**
 * Mengirimkan file media (foto/video) ke chat WhatsApp.
 */
async function _sendMediaToChat(message, mediaAsset, caption, storeWaId, contactId, agent) {
    const { UPLOADS_DIR } = require('../config');
    let mediaPath = path.join(UPLOADS_DIR, mediaAsset.filename);
    
    // Retry 1x jika gagal kirim media (network/puppeteer glitch)
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            if (!fs.existsSync(mediaPath)) throw new Error(`File tidak ditemukan: ${mediaAsset.filename}`);
            if (_isVideoMediaAsset(mediaAsset)) {
                const { optimizeVideoForWhatsApp } = require('../services/media_service');
                mediaPath = await optimizeVideoForWhatsApp(mediaAsset, mediaPath);
            }

            // Berikan delay kecil untuk stabilitas pengiriman media di headless browser.
            await new Promise(r => setTimeout(r, MEDIA_STABILITY_DELAY_MS));

            const mediaMsg = MessageMedia.fromFilePath(mediaPath);
            const quotedMessageId = _getMessageId(message);
            const sendOptions = { caption: caption || "" };
            if (quotedMessageId) {
                sendOptions.quotedMessageId = quotedMessageId;
                sendOptions.ignoreQuoteErrors = true;
            }
            const sentMsg = await _sendActiveMessage(storeWaId, contactId, mediaMsg, sendOptions);
            const waMessageId = sentMsg?.id?._serialized || sentMsg?.id?.id || null;

            const fileExt = mediaPath.split('.').pop().toLowerCase();
            const tag = ['mp4', 'mov', 'avi'].includes(fileExt) ? '[VIDEO' : '[MEDIA';
            const logBody = `${tag}:/uploads/${path.basename(mediaPath)}] ${caption || `Katalog: ${mediaAsset.label}`}`;
            await _logBotReply(storeWaId, contactId, logBody, agent?.bot_name, waMessageId, _quoteContextFromMessage(message, 'Pelanggan'));
            
            logger.success(`[${storeWaId}] Media [${mediaAsset.label}] dikirim ke [${contactId}]`);
            return; // Berhasil, keluar dari retry loop
        } catch (mediaError) {
            if (attempt < 2) {
                logger.warn(`[${storeWaId}] Gagal kirim media (attempt ${attempt}), retry dalam 2 detik: ${mediaError.message}`);
                await new Promise(r => setTimeout(r, 2000));
            } else {
                logger.error(`[${storeWaId}] Gagal kirim media [${mediaAsset.label}] setelah 2x: ${mediaError.message}`);
                // Jangan kirim teks fallback yang membingungkan customer
                // Cukup log error, AI sudah kirim teks secara terpisah
            }
        }
    }
}

/**
 * Log balasan bot ke database & dashboard.
 * @param {string} waMessageId - ID pesan WA yang dikirim (dari sentMsg.id._serialized)
 *                               Digunakan sebagai dedup key agar message_create event tidak re-log.
 */
async function _logBotReply(storeWaId, contactId, body, botName, waMessageId = null, quotedContext = {}) {
    // Langsung daftarkan ID ke memory tracker agar message_create tidak menganggap ini pesan dari HP
    if (waMessageId) {
        try {
            const { trackBotSentMessage } = require('../whatsapp_service');
            trackBotSentMessage(waMessageId);
        } catch (_) { /* non-critical */ }
    }

    await dashboard.addToChatHistory(storeWaId, {
        id: waMessageId,         // Kunci dedup — message_create akan menemukan ini dan skip
        from: contactId,
        body: body,
        isMe: true,
        timestamp: new Date(),
        sender_name: botName || 'AI Assistant',
        ...quotedContext
    });
}

/**
 * Pembersihan file sementara (Anti-Leak Storage).
 */
function _cleanupTempFile(tempPath, storeWaId) {
    // DIBATALKAN: File media dari pelanggan JANGAN DIBERSIHKAN seketika.
    // Dashboard Web App butuh membaca file ini (/uploads) untuk menampilkan histori obrolan.
    // Pembersihan akan dilakukan oleh temp_cleanup_service.js (Cron job) secara background
    // setelah melewati batas retensi 7 hari.
}

/**
 * TAHAP 4: Background Summary Updater dengan Nama Real
 */
async function _updateConversationSummary(storeWaId, contactId, senderName) {
    try {
        const { ChatSummary } = require('../database/index');
        const { generateChatSummary } = require('../ai_service');
        
        const latestHistory = await ChatMessage.findAll({
            where: { contact_id: contactId, store_wa_id: storeWaId },
            limit: 50,
            order: [['timestamp', 'DESC']]
        });
        const history = latestHistory.map(h => h.get({ plain: true })).reverse();
        const summaryText = await generateChatSummary(history);
        const latestIdentity = [...history].reverse().find(item => item.contact_display_name || item.sender_name) || {};
        const stableName = [
            latestIdentity.contact_display_name,
            latestIdentity.sender_name,
            senderName
        ].map(v => String(v || '').trim()).find(v => v && !/^Kontak WA #\d+$/.test(v) && v !== 'Kontak WA Privat' && v !== 'Kontak WhatsApp');
        const name = stableName || buildContactIdentity(contactId, { phone: latestIdentity.contact_phone }).displayName || formatWaNumber(contactId);

        // Ambil nomor HP dari history terbaru yang punya contact_phone
        const phoneSource = [...history].reverse().find(h => h.contact_phone);
        const stablePhone = phoneSource?.contact_phone || null;
        // Deteksi apakah contact_id ini adalah LID format
        const stableLid = contactId.endsWith('@lid') ? contactId : null;

        const [summary, created] = await ChatSummary.findOrCreate({
            where: { store_wa_id: storeWaId, contact_id: contactId },
            defaults: { 
                summary: summaryText, 
                contact_name: name,
                contact_phone: stablePhone,
                contact_lid: stableLid,
                last_updated: new Date() 
            }
        });

        if (!created) {
            summary.summary = summaryText;
            summary.contact_name = name;
            if (stablePhone) summary.contact_phone = stablePhone;  // Update hanya jika ada
            if (stableLid)   summary.contact_lid   = stableLid;
            summary.last_updated = new Date();
            await summary.save();
        }
        
        logger.info(`[${storeWaId}] Rekap Chat [${name}${stablePhone ? ' | ' + stablePhone : ''}] Berhasil Diperbarui.`);

        // ── SMART LABEL ENGINE (Non-blocking) ──────────────────────────────
        // Deteksi STATUS dari rekap → terapkan label WA Business + simpan ke DB
        try {
            const { applyLabelsFromSummary } = require('../services/smart_label_service');
            // Ambil WA client aktif untuk apply label ke WA real
            let waClient = null;
            try {
                const { getActiveClient } = require('./whatsapp_service');
                waClient = getActiveClient(storeWaId);
            } catch (_) { /* client mungkin sedang restart — label tetap disimpan di DB */ }
            // Non-blocking: error di sini tidak boleh ganggu flow utama
            applyLabelsFromSummary(storeWaId, contactId, summaryText, waClient).catch(e =>
                logger.warn(`[${storeWaId}] Smart label non-critical error: ${e.message}`)
            );
        } catch (labelErr) {
            logger.warn(`[${storeWaId}] Smart label setup error: ${labelErr.message}`);
        }

        // TAHAP 5: Jadwalkan Follow-Up jika belum closing (setelah rekap terupdate)
        await _scheduleFollowUpIfNeeded(storeWaId, contactId, name, summaryText);
    } catch (e) {
        logger.error(`Gagal update summary: ${e.message}`);
    }
}

/**
 * TAHAP 5: Jadwalkan Follow-Up Otomatis jika customer belum closing.
 * Deteksi status dari ChatSummary terbaru.
 */
async function _scheduleFollowUpIfNeeded(storeWaId, contactId, contactName, currentSummary) {
    try {
        const { scheduleFollowUp } = require('../services/followup_service');

        // Jangan jadwalkan follow-up jika summary menunjukkan sudah closing/selesai
        // Catatan: status 'menunggu transfer' TETAP di-follow-up agar pelanggan segera membayar.
        const summaryLower = (currentSummary || '').toLowerCase();
        const isClosedConversation = /\bstatus:\s*(closing|selesai)\b/.test(summaryLower);

        if (isClosedConversation) {
            logger.info(`[FollowUp] Batal menjadwalkan untuk [${contactId}] karena status percakapan sudah closing/selesai.`);
            return;
        }

        await scheduleFollowUp(storeWaId, contactId, contactName, currentSummary);
    } catch (e) {
        logger.warn(`[FollowUp] Gagal menjadwalkan: ${e.message}`);
    }
}


// ══════════════════════════════════════════════════════════════════
// BACKGROUND SUMMARY DEBOUNCER
// Dipanggil setiap kali pesan customer masuk (bot ON maupun OFF).
// Debounced 60 detik per kontak agar tidak boros API OpenAI.
// ══════════════════════════════════════════════════════════════════
const _bgSummaryDebounce = new Map();

function _triggerBackgroundSummaryIfNeeded(storeWaId, contactId, senderName) {
    const key = `${storeWaId}_${contactId}`;

    // Reset timer jika customer masih mengetik (debounce)
    if (_bgSummaryDebounce.has(key)) {
        clearTimeout(_bgSummaryDebounce.get(key));
    }

    const timerId = setTimeout(async () => {
        _bgSummaryDebounce.delete(key);
        try {
            // Hitung pesan dulu — minimum 3 pesan agar summary bermakna
            const count = await ChatMessage.count({
                where: { contact_id: contactId, store_wa_id: storeWaId }
            });
            if (count < 3) return;

            // Gunakan fungsi _updateConversationSummary yang sudah ada
            // (sudah include follow-up scheduling jika summary bukan closing)
            await _updateConversationSummary(storeWaId, contactId, senderName);
        } catch (e) {
            // Non-critical: tidak perlu crash flow utama
            logger.warn(`[${storeWaId}] Background summary update gagal [${contactId}]: ${e.message}`);
        }
    }, 60 * 1000); // 60 detik debounce

    _bgSummaryDebounce.set(key, timerId);
}

module.exports = { 
    handleMessage,
    pauseBotForContact,
    resumeBotForContact,
    pausedContacts,
    getActiveAIRepliesCount: () => activeAIReplies.size
};
