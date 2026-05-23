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
const DEBOUNCE_MS = Number(process.env.AI_REPLY_DEBOUNCE_MS || 1400); // Responsif, tetap menahan chat beruntun singkat
const ACTIVE_REPLY_WAIT_MS = Number(process.env.AI_ACTIVE_REPLY_WAIT_MS || 600);
const THINKING_DELAY_MIN_MS = Number(process.env.AI_THINKING_DELAY_MIN_MS || 80);
const THINKING_DELAY_JITTER_MS = Number(process.env.AI_THINKING_DELAY_JITTER_MS || 220);
const BETWEEN_BUBBLE_DELAY_MS = Number(process.env.AI_BETWEEN_BUBBLE_DELAY_MS || 350);
const MEDIA_STABILITY_DELAY_MS = Number(process.env.WA_MEDIA_STABILITY_DELAY_MS || 450);
const debounceTimers = new Map();      // Key: 'storeWaId_contactId' → timeoutId
const pendingMessages = new Map();     // Key: 'storeWaId_contactId' → { messages: [], mediaContexts: [], tempPaths: [], senderName, message (last) }

/**
 * Handle incoming message event — Entry Point
 * Setiap pesan masuk TIDAK langsung diproses AI.
 * Ia akan ditampung dulu oleh Debouncer.
 */
const autoLabelCache = new Set();
const activeAIReplies = new Set();

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

async function handleMessage(message, storeWaId, shouldAIReply = true) {
    if (message.isStatus || shouldIgnoreIncomingChat(message.from)) return;

    const contactId = message.from;
    const body = message.body || "";
    const debounceKey = `${storeWaId}_${contactId}`;
    let customerMediaContext = "";
    let tempPath = "";

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

        if (customerMediaContext) {
            safeSendReactionToMessage(message, '\uD83D\uDC4D', storeWaId);
        }

        // ═══════════════════════════════════════════════════════
        // STEP 2: LOG PESAN KE DATABASE & DASHBOARD (SELALU)
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
        const identity = buildContactIdentity(contactId, {
            name: contact.name,
            pushname: contact.pushname,
            shortName: contact.shortName,
            displayName: contact.displayName,
            number: resolvedPhone || contact.number
        });
        const senderName = identity.displayName;

        await dashboard.addToChatHistory(storeWaId, {
            id: message.id?._serialized || message.id?.id,
            from: contactId,
            body: logBody,
            isMe: false,
            timestamp: new Date(),
            sender_name: senderName,
            contactIdentity: identity
        });
        _scheduleAutoLabels(message, storeWaId, contactId, identity);

        // Cancel pending follow-ups ketika customer merespons
        try {
            const { cancelPendingFollowUps } = require('../services/followup_service');
            await cancelPendingFollowUps(storeWaId, contactId, 'Customer merespons');
        } catch (e) { /* Non-critical: follow-up cancel failure */ }

        logger.info(`[${storeWaId}] Pesan masuk terdaftar: ${contactId}`);

        // ═══════════════════════════════════════════════════════
        // FIREWALL 1: MODE SINKRONISASI (Tanpa AI Reply)
        // ═══════════════════════════════════════════════════════
        if (!shouldAIReply) {
            logger.info(`[${storeWaId}] Jalur Sinkronisasi: Pesan dicatat, AI Dilewati.`);
            _cleanupTempFile(tempPath, storeWaId);
            return;
        }

        // ═══════════════════════════════════════════════════════
        // FIREWALL 2: HUMAN OVERRIDE (Bot Dipause)
        // ═══════════════════════════════════════════════════════
        if (pausedContacts.has(debounceKey)) {
            logger.info(`[${storeWaId}] Bot sedang dipause (Human Override) untuk: ${contactId}`);
            _cleanupTempFile(tempPath, storeWaId);
            return;
        }

        // ═══════════════════════════════════════════════════════
        // STEP 3: DEBOUNCER — Tampung pesan, tunggu 3.5 detik
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

        // Set timer baru: Proses AI hanya jika 3.5 detik tidak ada pesan baru
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
    while (activeAIReplies.has(replyKey)) {
        logger.info(`[${storeWaId}] AI reply untuk [${contactId}] masih berjalan. Menahan batch baru agar tidak spam.`);
        await new Promise(resolve => setTimeout(resolve, ACTIVE_REPLY_WAIT_MS));
    }

    activeAIReplies.add(replyKey);
    try {
        return await _processAIReplyUnlocked(storeWaId, contactId, batch);
    } finally {
        activeAIReplies.delete(replyKey);
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
        logger.info(`[${storeWaId}] Bot NON-AKTIF untuk Toko ini.`);
        return;
    }

    // JIKA BELUM ADA AGEN TERPASANG: Berhenti
    if (!agent) {
        logger.warn(`[${storeWaId}] Perangkat ini belum terikat ke Agen AI manapun.`);
        return;
    }

    const chat = await lastMessage.getChat();
    const stopTyping = _startTypingHeartbeat(chat, storeWaId, contactId, lastMessage.client);

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
    await _markTyping(chat, storeWaId, contactId, lastMessage.client);

    // 6. PROSES AI (dengan pesan yang sudah digabung)
    const interactionCount = history.filter(h => !h.is_from_me).length + 1;
    const aiResult = await getAIResponse(finalBodyForAI, history, store, agent, combinedMedia, summary, interactionCount);
    
    // SAFETY NET: Pastikan selalu ada konten untuk membalas, mencegah error WWebJS "Message cannot be empty"
    const fallbackContent = aiResult.content || "Mohon maaf, saya sedang kesulitan memproses pesan Anda. Bisa diulangi pertanyaannya Kak?";

    const outboundBubbles = prepareOutboundBubbles(fallbackContent);
    const primaryTextForDelay = outboundBubbles[0] || fallbackContent;

    // 7. Jeda Mengetik (Natural Feel)
    const typingDelay = calculateTypingDelay(primaryTextForDelay);
    await new Promise(r => setTimeout(r, typingDelay));

    // 8. Eksekusi Tool Khusus Non-Pesan (misal: Auto-Label)
    if (aiResult.tool_calls && aiResult.tool_calls.length > 0) {
        for (const tc of aiResult.tool_calls) {
            if (tc.function.name === 'tambahkan_label_chat') {
                try {
                    const args = JSON.parse(tc.function.arguments);
                    const { safeAddLabelByName } = require('../services/wajs_bridge');
                    await safeAddLabelByName(lastMessage.client, contactId, args.label_name, undefined, storeWaId);
                    logger.success(`[${storeWaId}] AI otomatis melabeli '${args.label_name}' untuk [${contactId}]`);
                } catch (e) {
                    logger.warn(`[${storeWaId}] AI gagal menambah label: ${e.message}`);
                }
            }
        }
    }

    // 9. KIRIM RESPONS
    try {
        if (aiResult.type === RESPONSE_TYPE.MEDIA && aiResult.mediaList && aiResult.mediaList.length > 0) {
            for (let i = 0; i < aiResult.mediaList.length; i++) {
                const item = aiResult.mediaList[i];
                await _markTyping(chat, storeWaId, contactId, lastMessage.client);
                await _sendMediaToChat(lastMessage, item.media, item.caption || "", storeWaId, contactId, agent);
                
                if (i < aiResult.mediaList.length - 1) {
                    await new Promise(r => setTimeout(r, 1500));
                }
            }

            if (aiResult.content) {
                await _sendTextBubbles(lastMessage, chat, storeWaId, contactId, outboundBubbles, agent.bot_name);
            }
        } else {
            await _sendTextBubbles(lastMessage, chat, storeWaId, contactId, outboundBubbles, agent.bot_name);
        }
        logger.success(`[${storeWaId}] Sesi [${contactId}] — Dibalas via AI (${messages.length} pesan digabung).`);
    } catch (sendErr) {
        logger.error(`[${storeWaId}] Gagal mengirim balasan AI ke [${contactId}]: ${sendErr.message}`);
    }

    // TAHAP 4: Update Rekap Chat (Summary) & Jadwalkan Follow-Up secara background (Non-blocking)
    _updateConversationSummary(storeWaId, contactId, senderName);

    stopTyping();
}

// ══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ══════════════════════════════════════════════════════════════════

/**
 * Download media dengan timeout (Anti-Hang).
 * Jika pelanggan menghapus pesannya sebelum bot mengunduh, ini akan timeout dengan aman.
 */
async function _markTyping(chat, storeWaId, contactId, client) {
    try {
        const { safeMarkIsComposing } = require('../services/wajs_bridge');
        const markedByWajs = await safeMarkIsComposing(client, contactId, 6000, storeWaId);
        if (!markedByWajs && typeof chat?.sendStateTyping === 'function') {
            await chat.sendStateTyping();
        }
        dashboard.emitTypingStatus(storeWaId, contactId, true);
    } catch (e) {
        logger.warn(`[${storeWaId}] Gagal menampilkan typing untuk [${contactId}]: ${e.message}`);
    }
}

function _startTypingHeartbeat(chat, storeWaId, contactId, client) {
    let stopped = false;
    const pulse = () => {
        if (!stopped) _markTyping(chat, storeWaId, contactId, client);
    };

    pulse();
    const interval = setInterval(pulse, 4500);
    const hardStop = setTimeout(() => stop(), 90000);

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

    for (let i = 0; i < safeList.length; i++) {
        const bubble = safeList[i];
        await _markTyping(chat, storeWaId, contactId, message.client);
        if (i > 0) {
            await new Promise(r => setTimeout(r, BETWEEN_BUBBLE_DELAY_MS));
        }

        let sentMsg;
        if (i === 0 || typeof chat?.sendMessage !== 'function') {
            sentMsg = await message.reply(bubble);
        } else {
            sentMsg = await chat.sendMessage(bubble);
        }

        // Capture WA message ID to prevent message_create event from double-logging
        const waMessageId = sentMsg?.id?._serialized || sentMsg?.id?.id || null;
        await _logBotReply(storeWaId, contactId, bubble, botName, waMessageId);
    }
}

/**
 * Mengirimkan file media (foto/video) ke chat WhatsApp.
 */
async function _sendMediaToChat(message, mediaAsset, caption, storeWaId, contactId, agent) {
    const { UPLOADS_DIR } = require('../config');
    const mediaPath = path.join(UPLOADS_DIR, mediaAsset.filename);
    
    try {
        if (!fs.existsSync(mediaPath)) throw new Error(`File tidak ditemukan: ${mediaAsset.filename}`);

        // Berikan delay kecil untuk stabilitas pengiriman media di headless browser.
        await new Promise(r => setTimeout(r, MEDIA_STABILITY_DELAY_MS));

        const mediaMsg = MessageMedia.fromFilePath(mediaPath);
        const sentMsg = await message.reply(mediaMsg, undefined, { caption: caption || "" });
        const waMessageId = sentMsg?.id?._serialized || sentMsg?.id?.id || null;

        const fileExt = mediaPath.split('.').pop().toLowerCase();
        const tag = ['mp4', 'mov', 'avi'].includes(fileExt) ? '[VIDEO' : '[MEDIA';
        
        const logBody = `${tag}:/uploads/${mediaAsset.filename}] ${caption || `Katalog: ${mediaAsset.label}`}`;
        await _logBotReply(storeWaId, contactId, logBody, agent?.bot_name, waMessageId);
        
        logger.success(`[${storeWaId}] Media [${mediaAsset.label}] dikirim ke [${contactId}]`);
    } catch (mediaError) {
        logger.error(`[${storeWaId}] Gagal kirim media: ${mediaError.message}`);
        try {
            await message.reply(`Maaf kak, media gagal dikirim. Bisa saya bantu dengan cara lain?`);
        } catch (e) { /* ignore reply failure */ }
    }
}

/**
 * Log balasan bot ke database & dashboard.
 * @param {string} waMessageId - ID pesan WA yang dikirim (dari sentMsg.id._serialized)
 *                               Digunakan sebagai dedup key agar message_create event tidak re-log.
 */
async function _logBotReply(storeWaId, contactId, body, botName, waMessageId = null) {
    await dashboard.addToChatHistory(storeWaId, {
        id: waMessageId,         // Kunci dedup — message_create akan menemukan ini dan skip
        from: contactId,
        body: body,
        isMe: true,
        timestamp: new Date(),
        sender_name: botName || 'AI Assistant'
    });
}

/**
 * Pembersihan file sementara (Anti-Leak Storage).
 */
function _cleanupTempFile(tempPath, storeWaId) {
    if (tempPath && fs.existsSync(tempPath)) {
        try {
            fs.unlinkSync(tempPath);
            logger.info(`[${storeWaId}] File sementara pelanggan dibersihkan dari disk (Storage Aman).`);
        } catch (e) { /* ignore */ }
    }
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

        const [summary, created] = await ChatSummary.findOrCreate({
            where: { store_wa_id: storeWaId, contact_id: contactId },
            defaults: { 
                summary: summaryText, 
                contact_name: name,
                last_updated: new Date() 
            }
        });

        if (!created) {
            summary.summary = summaryText;
            summary.contact_name = name;
            summary.last_updated = new Date();
            await summary.save();
        }
        
        logger.info(`[${storeWaId}] Rekap Chat [${name}] Berhasil Diperbarui.`);

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


module.exports = { 
    handleMessage,
    pauseBotForContact,
    resumeBotForContact,
    pausedContacts
};
