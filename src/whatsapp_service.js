const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const logger = require('./utils/logger');
const dashboard = require('./services/dashboard_service');
const { handleMessage } = require('./events/message_handler');
const { assertWaChatId } = require('./utils/wa_id');
const { shouldIgnoreIncomingChat } = require('./utils/contact_identity');
const wajsBridge = require('./services/wajs_bridge');
const path = require('path');
const fs = require('fs');

// MULTI-CLIENT STORAGE
const clients = new Map();
const initializedClients = new Set(); // Mencegah double listener (Fixed Triple Reply Bug)
const readyClients = new Set();
const restartingClients = new Set();
const clientGenerations = new Map();
const WA_SEND_READY_TIMEOUT_MS = Number(process.env.WA_SEND_READY_TIMEOUT_MS || 45000);

// IN-MEMORY BOT MESSAGE TRACKER
// Menyimpan ID pesan yang dikirim oleh BOT (bukan dari HP manual).
// Ini mencegah race condition di message_create event yang mendeteksi pesan bot sebagai pesan dari HP.
// Entry otomatis dihapus setelah 10 detik untuk mencegah memory leak.
const botSentMessageIds = new Set();

function trackBotSentMessage(msgId) {
    if (!msgId) return;
    botSentMessageIds.add(msgId);
    setTimeout(() => botSentMessageIds.delete(msgId), 10000);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isDetachedFrameError(error) {
    return /detached Frame|Execution context was destroyed|Target closed|Session closed|Cannot find context|Protocol error/i
        .test(cleanErrorMessage(error));
}

/**
 * Mendapatkan semua Client yang aktif.
 */
function getClients() {
    return clients;
}

function getActiveClient(storeWaId) {
    const client = clients.get(storeWaId);
    if (!client) throw new Error(`Client [${storeWaId}] tidak aktif!`);
    return client;
}

function isCurrentClient(storeWaId, client) {
    return Boolean(client && clients.get(storeWaId) === client);
}

function isPuppeteerPageUsable(client) {
    try {
        return Boolean(client?.pupPage && !client.pupPage.isClosed?.());
    } catch (_) {
        return false;
    }
}

function cleanErrorMessage(error) {
    return String(error?.message || error || 'Unknown error').split('\n')[0];
}

async function getStateWithTimeout(client, timeoutMs = 3000) {
    return Promise.race([
        client.getState(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout menunggu state WhatsApp')), timeoutMs))
    ]);
}

async function waitForActiveClient(storeWaId, timeoutMs = WA_SEND_READY_TIMEOUT_MS) {
    const startedAt = Date.now();
    let lastError = null;

    while (Date.now() - startedAt < timeoutMs) {
        const client = clients.get(storeWaId);
        if (!client) {
            lastError = new Error(`Client [${storeWaId}] belum aktif`);
            await sleep(500);
            continue;
        }

        if (readyClients.has(storeWaId) && isPuppeteerPageUsable(client)) {
            return client;
        }

        if (isPuppeteerPageUsable(client)) {
            try {
                const state = await getStateWithTimeout(client, 3000);
                if (state === 'CONNECTED') {
                    readyClients.add(storeWaId);
                    return client;
                }
                lastError = new Error(`WhatsApp state belum siap: ${state || 'unknown'}`);
            } catch (error) {
                lastError = error;
                if (isDetachedFrameError(error)) readyClients.delete(storeWaId);
            }
        }

        await sleep(750);
    }

    throw new Error(`Client [${storeWaId}] belum siap kirim setelah ${Math.round(timeoutMs / 1000)} detik: ${cleanErrorMessage(lastError)}`);
}

function getMessageId(message) {
    return message?.id?._serialized || message?.id?.id || message?.quotedMsgId || '';
}

function clipQuoteBody(value, maxLength = 500) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function quoteContextFromMessage(message, fallbackSender = '') {
    return {
        quoted_message_id: getMessageId(message),
        quoted_body: clipQuoteBody(message?.body || message?.caption || ''),
        quoted_from_me: Boolean(message?.fromMe),
        quoted_sender_name: fallbackSender || (message?.fromMe ? 'CS/Admin' : 'Pelanggan')
    };
}

async function extractQuotedContext(message, storeWaId) {
    try {
        const directQuotedId = message?.quotedMsgId || message?._data?.quotedMsg?.id?._serialized || message?._data?.quotedMsgId?._serialized || message?._data?.quotedStanzaID;
        const directQuotedBody = message?.quotedBody || message?._data?.quotedMsg?.body || message?._data?.quotedMsg?.caption || '';

        if (message?.hasQuotedMsg && typeof message.getQuotedMessage === 'function') {
            const quoted = await message.getQuotedMessage();
            if (quoted) return quoteContextFromMessage(quoted, quoted.fromMe ? 'CS/Admin' : 'Pelanggan');
        }

        if (directQuotedId || directQuotedBody) {
            return {
                quoted_message_id: directQuotedId || null,
                quoted_body: clipQuoteBody(directQuotedBody),
                quoted_from_me: message?.quotedFromMe ?? null,
                quoted_sender_name: message?.quotedSenderName || null
            };
        }
    } catch (error) {
        logger.warn(`[${storeWaId}] Gagal membaca konteks quoted reply: ${error.message}`);
    }
    return {};
}

async function getChatsWithRetry(client, attempts = 3, delayMs = 5000) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            // Coba pakai WA-JS dulu yang lebih stabil dan cepat
            if (client.__wajsReady) {
                try {
                    return await wajsBridge.getChats(client, client.options?.authStrategy?.clientId || 'default');
                } catch (e) {
                    logger.warn(`WA-JS getChats gagal, fallback ke WWebJS: ${e.message}`);
                }
            }
            return await client.getChats();
        } catch (error) {
            lastError = error;
            if (attempt < attempts) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
    }
    throw lastError;
}

/**
 * Membersihkan semua Singleton Lock Files per-ClientId.
 * Mencegah error "profile already in use" saat container restart di Railway.
 */
function cleanupSessionLocks(clientId) {
    const { DATA_DIR } = require('./config');
    const baseWwebjsDir = path.join(process.cwd(), '.wwebjs_auth');
    const sessionDir = path.join(baseWwebjsDir, `session-${clientId}`);
    
    // Semua file lock yang perlu dihapus (Chronium stores this as symlinks)
    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];

    lockFiles.forEach(lockName => {
        const lockFile = path.join(sessionDir, lockName);
        try {
            fs.rmSync(lockFile, { force: true });
        } catch (e) { /* ignore */ }
    });

    // TAHAP 1 UPGRADE (Anti Memory-Thrashing): Hapus Cache Chromium yang membengkak
    const cacheDirs = [
        path.join(sessionDir, 'Default', 'Cache'),
        path.join(sessionDir, 'Default', 'Code Cache'),
        path.join(sessionDir, 'Default', 'Service Worker', 'CacheStorage')
    ];

    cacheDirs.forEach(dir => {
        try {
            if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
        } catch (e) { /* ignore */ }
    });
}

/**
 * Inisialisasi WhatsApp Client untuk Toko tertentu.
 * @param {string} storeWaId - Unik identifier dari tabel Store.
 */
function createWhatsAppClient(storeWaId) {
    // CEK DUPLIKAT: Jangan buat client baru jika ID sudah ada & aktif
    if (clients.has(storeWaId)) {
        logger.warn(`[${storeWaId}] Client sudah ada. Menggunakan yang lama.`);
        return clients.get(storeWaId);
    }

    cleanupSessionLocks(storeWaId);
    
    logger.info(`[${storeWaId}] Menyiapkan Browser & Sesi...`);
    dashboard.updateWAStatus(storeWaId, "Menyiapkan Browser...");

    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: storeWaId 
        }),
        puppeteer: {
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                // === MEMORY OPTIMIZATION (Production Grade) ===
                '--disable-extensions',
                '--disable-translate',
                '--disable-background-networking',
                '--disable-sync',
                '--disable-default-apps',
                '--disable-features=TranslateUI',
                '--no-first-run',
                '--disable-renderer-backgrounding',  // Hemat CPU saat tab tidak aktif
                '--disable-backgrounding-occluded-windows',
                '--js-flags=--max-old-space-size=256'  // Batasi JS heap per browser
            ],
            headless: true,
            handleSIGINT: false,
            timeout: 90000,           // 90 detik timeout launch
            protocolTimeout: 600000   // 10 menit
        }
    });

    const generation = (clientGenerations.get(storeWaId) || 0) + 1;
    clientGenerations.set(storeWaId, generation);
    client.__storeWaId = storeWaId;
    client.__waAiGeneration = generation;
    readyClients.delete(storeWaId);
    clients.set(storeWaId, client);
    return client;
}

/**
 * Menyiapkan Event Listeners untuk Client tertentu.
 * Mencegah duplikasi listener yang menyebabkan bot membalas berkali-kali.
 */
function setupEventListeners(client, storeWaId) {
    // PROTEKSI: Jika client sudah pernah disetup (event on), jangan diulang!
    if (initializedClients.has(storeWaId)) {
        logger.warn(`[${storeWaId}] Event listeners sudah terpasang. Skip setup.`);
        return;
    }

    client.on('qr', (qr) => {
        logger.bot(`[${storeWaId}] Scan QR Code di Dashboard UI`);
        dashboard.emitQRSpec(storeWaId, qr);
        dashboard.updateWAStatus(storeWaId, "Menunggu Scan QR...");
    });

    client.on('authenticated', () => {
        logger.success(`[${storeWaId}] Sesi WhatsApp Terautentikasi.`);
        dashboard.updateWAStatus(storeWaId, "Terautentikasi...");
    });

    client.on('ready', async () => {
        logger.success(`[${storeWaId}] WhatsApp SIAP DIGUNAKAN! ✅`);
        readyClients.add(storeWaId);
        dashboard.updateWAStatus(storeWaId, "Dihubungkan (Online)");
        
        // Simpan nomor bot secara persisten agar muncul di UI
        if (client.info && client.info.wid && client.info.wid.user) {
            dashboard.updateStorePhone(storeWaId, client.info.wid.user).catch(()=>{});
        }

        await wajsBridge.injectWajs(client, storeWaId);
        
        // ══════════════════════════════════════════════════════════════════
        // SINKRONISASI PESAN SAAT STARTUP
        // Tarik 20 pesan terakhir dari 15 chat terbaru (bukan hanya unread).
        // Ini memastikan percakapan yang sudah dibaca di HP tetap tersimpan di CRM.
        // Pesan yang sudah ada di DB (berdasarkan wa_message_id) di-skip agar tidak duplikat.
        // ══════════════════════════════════════════════════════════════════
        try {
            logger.info(`[${storeWaId}] Memulai sinkronisasi chat terbaru (20 pesan × 15 chat)...`);
            const { ChatMessage } = require('./database/index');
            const chats = await getChatsWithRetry(client);
            // Ambil 15 chat terbaru (diurutkan dari yang paling aktif)
            const recentChats = chats
                .filter(c => !shouldIgnoreIncomingChat(c.id._serialized))
                .slice(0, 15);

            let totalSynced = 0;
            for (const chat of recentChats) {
                try {
                    let messages = [];
                    const chatId = chat.id._serialized || chat.id;

                    // 1. Coba pakai WA-JS API
                    if (client.__wajsReady) {
                        try {
                            messages = await wajsBridge.getMessages(client, chatId, 20, storeWaId);
                        } catch (wajsErr) {
                            // Fallback ke WWebJS adalah behavior normal — log sebagai info bukan warn
                            logger.info(`[${storeWaId}] WA-JS getMessages fallback untuk ${chatId}: ${cleanErrorMessage(wajsErr)}`);
                        }
                    }

                    // 2. Jika WA-JS kosong/gagal, fallback ke WWebJS fetchMessages
                    if (!messages || messages.length === 0) {
                        if (typeof chat.fetchMessages === 'function') {
                            messages = await chat.fetchMessages({ limit: 20 });
                        }
                    }

                    if (!messages || messages.length === 0) continue;

                    for (const msg of messages) {
                        const msgId = msg.id?._serialized || msg.id?.id;
                        if (!msgId) continue;

                        // Skip jika sudah ada di database (anti-duplikat)
                        const exists = await ChatMessage.findOne({ where: { wa_message_id: msgId } });
                        if (exists) continue;

                        // Proses tapi jangan trigger AI reply (shouldAIReply = false)
                        await handleMessage(msg, storeWaId, false);
                        totalSynced++;
                    }
                    // Tandai sebagai terbaca jika memang ada unread
                    if (chat.unreadCount > 0) await chat.sendSeen();
                } catch (chatErr) {
                    // Error sinkronisasi per-chat adalah normal (misal reply tidak tersedia) — log info
                    logger.info(`[${storeWaId}] Skip sync chat [${chat.id._serialized}]: ${cleanErrorMessage(chatErr)}`);
                }
            }
            if (totalSynced > 0) {
                logger.success(`[${storeWaId}] ✅ Sinkronisasi selesai: ${totalSynced} pesan baru berhasil diimpor.`);
            } else {
                logger.info(`[${storeWaId}] Database sudah up-to-date, tidak ada pesan baru.`);
            }
        } catch (e) {
            logger.warn(`[${storeWaId}] Sinkronisasi chat dilewati: ${cleanErrorMessage(e)}`);
        }
    });

    // Pesan MASUK dari customer
    client.on('message', async (message) => {
        if (message.isStatus || shouldIgnoreIncomingChat(message.from)) return;
        await handleMessage(message, storeWaId);
    });

    // ══════════════════════════════════════════════════════════════════
    // SINKRONISASI PESAN KELUAR DARI HP (message_create)
    // Menangkap pesan yang dikirim LANGSUNG dari HP (bukan dari bot/dashboard).
    // Penting agar riwayat percakapan di CRM selalu lengkap & konsisten dengan HP.
    // ══════════════════════════════════════════════════════════════════
    client.on('message_create', async (message) => {
        // Hanya proses pesan dari sisi kita (isMe = true) yang dikirim dari HP, bukan dari bot
        if (!message.fromMe) return;
        if (message.isStatus) return;
        if (shouldIgnoreIncomingChat(message.to)) return;

        const msgId = message.id?._serialized || message.id?.id;
        if (!msgId) return;

        // PALING CEPAT: Cek in-memory set dulu (menghindari race condition dengan DB write)
        if (botSentMessageIds.has(msgId)) return;

        // Cek apakah pesan ini sudah dicatat (mungkin sudah dicatat oleh bot sendiri via _logBotReply)
        try {
            const { ChatMessage } = require('./database/index');
            const exists = await ChatMessage.findOne({ where: { wa_message_id: msgId } });
            if (exists) return; // Sudah ada, skip

            const body = message.body || '';
            if (!body && !message.hasMedia) return;
            const quotedContext = await extractQuotedContext(message, storeWaId);

            // Log pesan keluar dari HP ke dashboard (bukan AI, tapi CS Manual dari HP)
            await dashboard.addToChatHistory(storeWaId, {
                id: msgId,
                from: message.to,
                body: body || '(Media dari HP)',
                isMe: true,
                timestamp: new Date(message.timestamp * 1000),
                sender_name: 'CS (dari HP)',
                ...quotedContext
            });
            // Ambil info kontak untuk log yang lebih terbaca
            let logDisplay = `[${message.to}]`;
            try {
                const contact = await message.getContact();
                const { buildContactIdentity } = require('./utils/contact_identity');
                const identity = buildContactIdentity(message.to, contact);
                logDisplay = `[${identity.displayName || ''}${identity.phone ? ' | +' + identity.phone : ''}] (${message.to})`;
            } catch (e) { /* ignore */ }

            logger.info(`[${storeWaId}] Pesan keluar dari HP tercatat: ke ${logDisplay}`);

            // ── CS MANUAL AWARENESS (background, non-blocking) ──────────────────
            // 1. Cancel follow-up pending: CS sudah handle manual, tidak perlu bot follow-up
            try {
                const { cancelPendingFollowUps } = require('./services/followup_service');
                cancelPendingFollowUps(storeWaId, message.to, 'CS membalas manual dari HP').catch(() => {});
            } catch (_) { /* non-critical */ }

            // 2. Trigger background summary update (debounced 30 detik)
            // Agar ketika bot ON kembali, AI tau CS sudah balas sampai mana
            try {
                const { triggerCsManualSummaryUpdate } = require('./services/bot_activation_service');
                triggerCsManualSummaryUpdate(storeWaId, message.to, 'CS (dari HP)');
            } catch (_) { /* non-critical */ }

        } catch (e) {
            // Non-critical
        }
    });


    client.on('disconnected', (reason) => {
        logger.error(`[${storeWaId}] WhatsApp Terputus: ${reason}`);
        dashboard.updateWAStatus(storeWaId, "Terputus");
        readyClients.delete(storeWaId);
        clients.delete(storeWaId);
        initializedClients.delete(storeWaId);
    });

    // ══════════════════════════════════════════════════════════════════
    // SINKRONISASI: PESAN DIHAPUS (message_revoke)
    // Ketika customer/CS menghapus pesan dari HP, database dan dashboard
    // kita ikut diperbarui secara real-time.
    // ══════════════════════════════════════════════════════════════════
    client.on('message_revoke_everyone', async (revokedMsg, oldMsg) => {
        const msgId = revokedMsg?.id?._serialized || revokedMsg?.id?.id;
        if (!msgId) return;
        try {
            const { ChatMessage } = require('./database/index');
            const deleted = await ChatMessage.destroy({ where: { wa_message_id: msgId } });
            if (deleted > 0) {
                // Beritahu frontend via Socket.IO agar UI langsung update
                dashboard.emitMessageRevoked(storeWaId, msgId, revokedMsg?.from || revokedMsg?.to);
                logger.info(`[${storeWaId}] Pesan [${msgId}] dihapus customer → dihapus dari CRM.`);
            }
        } catch (e) {
            // Non-critical: DB deletion failure
        }
    });

    // Tandai sebagai sudah diinisialisasi
    initializedClients.add(storeWaId);
}

/**
 * Mengirim pesan manual dari Dashboard melalui Client yang spesifik.
 * @param {string} storeWaId - Nomor toko yang mengirim.
 */
async function sendManualMessage(storeWaId, to, body, options = {}) {
    const client = await waitForActiveClient(storeWaId);
    const targetChatId = assertWaChatId(to);
    const quotedMessageId = String(options.quotedMessageId || options.quoted_message_id || '').trim();
    
    try {
        const sendOptions = quotedMessageId
            ? { quotedMessageId, ignoreQuoteErrors: true }
            : {};
        const msg = await client.sendMessage(targetChatId, body, sendOptions);
        const msgId = msg.id?._serialized || msg.id?.id;
        trackBotSentMessage(msgId);
        
        // Log ke Dashboard UI & DB dengan Store ID yang benar
        await dashboard.addToChatHistory(storeWaId, {
            id: msgId,
            from: targetChatId,
            body: body,
            isMe: true,
            sender_name: 'CS Manual',
            quoted_message_id: quotedMessageId || null,
            quoted_body: clipQuoteBody(options.quotedBody || options.quoted_body || ''),
            quoted_from_me: options.quotedFromMe ?? options.quoted_from_me ?? null,
            quoted_sender_name: options.quotedSenderName || options.quoted_sender_name || null
        });

        // TAHAP 3: Auto-Pause AI
        const { pauseBotForContact } = require('./events/message_handler');
        pauseBotForContact(storeWaId, targetChatId);

        logger.info(`[${storeWaId}] Pesan Manual dikirim ke [${targetChatId}]. AI otomatis ditidurkan untuk kontak ini.`);
        return true;
    } catch (error) {
        logger.error(`[${storeWaId}] Gagal kirim manual: ${error.message}`);
        throw error;
    }
}

/**
 * Mengirim gambar/video (katalog) secara manual dari Dashboard.
 */
async function sendManualMedia(storeWaId, to, mediaAsset) {
    const client = await waitForActiveClient(storeWaId);
    const targetChatId = assertWaChatId(to);

    try {
        const { MessageMedia } = require('whatsapp-web.js');
        const { UPLOADS_DIR } = require('./config');
        const path = require('path');
        const fs = require('fs');

        let mediaPath = path.join(UPLOADS_DIR, mediaAsset.filename);
        if (!fs.existsSync(mediaPath)) throw new Error('File media fisik tidak ditemukan.');
        if (String(mediaAsset.type || '').toLowerCase() === 'video') {
            const { optimizeVideoForWhatsApp } = require('./services/media_service');
            mediaPath = await optimizeVideoForWhatsApp(mediaAsset, mediaPath);
        }

        const mediaMsg = MessageMedia.fromFilePath(mediaPath);
        const caption = mediaAsset.description || mediaAsset.label || '';
        const msg = await client.sendMessage(targetChatId, mediaMsg, { caption });
        const msgId = msg.id?._serialized || msg.id?.id;
        trackBotSentMessage(msgId);

        // Tampilkan sebagai HTML thumbnail di Dashboard
        const fileExt = mediaPath.split('.').pop().toLowerCase();
        const tag = ['mp4', 'mov', 'avi'].includes(fileExt) ? '[VIDEO' : '[MEDIA';
        const logBody = `${tag}:/uploads/${path.basename(mediaPath)}] ${caption}`;

        await dashboard.addToChatHistory(storeWaId, {
            id: msgId,
            from: targetChatId,
            body: logBody,
            isMe: true,
            sender_name: 'CS Manual'
        });

        // TAHAP 3: Auto-Pause AI jika kirim media
        const { pauseBotForContact } = require('./events/message_handler');
        pauseBotForContact(storeWaId, targetChatId);

        logger.info(`[${storeWaId}] Media Manual [${mediaAsset.label}] dikirim ke [${targetChatId}]. AI dipause.`);
        return true;
    } catch (error) {
        logger.error(`[${storeWaId}] Gagal kirim media manual: ${error.message}`);
        throw error;
    }
}

/**
 * Mengirim follow-up otomatis ke customer TANPA pause AI.
 * Berbeda dengan sendManualMessage yang otomatis pause bot.
 */
async function sendFollowUpMessage(storeWaId, contactId, body, mediaAsset = null) {
    const client = await waitForActiveClient(storeWaId);
    const targetChatId = assertWaChatId(contactId);

    try {
        // Kirim media jika ada
        if (mediaAsset) {
            const { MessageMedia } = require('whatsapp-web.js');
            const { UPLOADS_DIR } = require('./config');
            let mediaPath = path.join(UPLOADS_DIR, mediaAsset.filename);

            if (fs.existsSync(mediaPath)) {
                if (String(mediaAsset.type || '').toLowerCase() === 'video') {
                    const { optimizeVideoForWhatsApp } = require('./services/media_service');
                    mediaPath = await optimizeVideoForWhatsApp(mediaAsset, mediaPath);
                }
                const mediaMsg = MessageMedia.fromFilePath(mediaPath);
                // Kirim media dengan caption (atau body sebagai caption)
                const msg = await client.sendMessage(targetChatId, mediaMsg, { caption: body || '' });
                const msgId = msg.id?._serialized || msg.id?.id;
                trackBotSentMessage(msgId);

                const fileExt = mediaPath.split('.').pop().toLowerCase();
                const tag = ['mp4', 'mov', 'avi'].includes(fileExt) ? '[VIDEO' : '[MEDIA';
                const logBody = `${tag}:/uploads/${path.basename(mediaPath)}] ${body || mediaAsset.label}`;

                await dashboard.addToChatHistory(storeWaId, {
                    id: msgId,
                    from: targetChatId,
                    body: logBody,
                    isMe: true,
                    sender_name: 'Follow-Up Bot'
                });
            } else {
                logger.warn(`[FollowUp] Media tidak ditemukan: ${mediaAsset.filename}. Kirim teks saja.`);
                // Fallback: kirim teks saja jika media tidak ada
                if (body) {
                    const msg = await client.sendMessage(targetChatId, body);
                    const msgId = msg.id?._serialized || msg.id?.id;
                    trackBotSentMessage(msgId);
                    await dashboard.addToChatHistory(storeWaId, {
                        id: msgId,
                        from: targetChatId,
                        body: body,
                        isMe: true,
                        sender_name: 'Follow-Up Bot'
                    });
                }
            }
        } else if (body) {
            // Kirim teks saja (tanpa media)
            const msg = await client.sendMessage(targetChatId, body);
            const msgId = msg.id?._serialized || msg.id?.id;
            trackBotSentMessage(msgId);
            await dashboard.addToChatHistory(storeWaId, {
                id: msgId,
                from: targetChatId,
                body: body,
                isMe: true,
                sender_name: 'Follow-Up Bot'
            });
        }

        // TIDAK pause AI — follow-up harus tetap bisa ditangani oleh AI
        logger.info(`[${storeWaId}] Follow-Up dikirim ke [${targetChatId}].`);
        return true;
    } catch (error) {
        logger.error(`[${storeWaId}] Gagal kirim follow-up: ${error.message}`);
        throw error;
    }
}

async function requestPhoneNumber(storeWaId, contactId) {
    return wajsBridge.requestPhoneNumber(getActiveClient(storeWaId), contactId, storeWaId);
}

async function resolveContactPhone(storeWaId, contactId) {
    const client = getActiveClient(storeWaId);
    return wajsBridge.resolvePhoneForChatId(client, contactId, storeWaId);
}

async function getLabels(storeWaId) {
    return wajsBridge.getLabels(getActiveClient(storeWaId), storeWaId);
}

async function createLabel(storeWaId, name, color) {
    return wajsBridge.createLabel(getActiveClient(storeWaId), name, color, storeWaId);
}

async function editLabel(storeWaId, labelId, updates) {
    return wajsBridge.editLabel(getActiveClient(storeWaId), labelId, updates, storeWaId);
}

async function deleteLabel(storeWaId, labelId) {
    return wajsBridge.deleteLabel(getActiveClient(storeWaId), labelId, storeWaId);
}

async function getLabelColorPalette(storeWaId) {
    return wajsBridge.getLabelColorPalette(getActiveClient(storeWaId), storeWaId);
}

async function addOrRemoveLabels(storeWaId, contactIds, labelOps) {
    return wajsBridge.addOrRemoveLabels(getActiveClient(storeWaId), contactIds, labelOps, storeWaId);
}

async function sendReaction(storeWaId, messageId, emoji) {
    return wajsBridge.sendReactionById(getActiveClient(storeWaId), messageId, emoji, storeWaId);
}

async function forwardMessages(storeWaId, to, messageIds, options = {}) {
    const targetChatId = assertWaChatId(to);
    return wajsBridge.forwardMessages(getActiveClient(storeWaId), targetChatId, messageIds, options, storeWaId);
}

/**
 * Logout Client, Putuskan Koneksi WA, dan Hapus Sesi Fisik
 * @param {string} storeWaId 
 */
async function logoutClient(storeWaId) {
    const client = clients.get(storeWaId);
    readyClients.delete(storeWaId);
    
    // 1. Matikan Client secara aman
    if (client) {
        try {
            await client.logout();
        } catch (e) {
            logger.warn(`[${storeWaId}] Logout API gagal (mungkin sudah terputus): ${e.message}`);
        }
        try {
            await client.destroy();
        } catch (e) {}
        clients.delete(storeWaId);
    }
    initializedClients.delete(storeWaId);
    
    // 2. Hapus total folder sesi fisik (Clean Slate)
    const baseWwebjsDir = path.join(process.cwd(), '.wwebjs_auth');
    const sessionDir = path.join(baseWwebjsDir, `session-${storeWaId}`);
    try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        logger.success(`[${storeWaId}] Sesi fisik berhasil dihapus secara paksa.`);
    } catch (e) {
        logger.warn(`[${storeWaId}] Folder sesi mungkin sudah hilang.`);
    }

    dashboard.updateWAStatus(storeWaId, "Terputus (Sesi Bersih)");
}

async function restartClientRuntime(storeWaId, reason = 'health-check') {
    if (restartingClients.has(storeWaId)) {
        logger.warn(`[${storeWaId}] Restart runtime sudah berjalan, skip permintaan baru.`);
        return;
    }

    restartingClients.add(storeWaId);
    readyClients.delete(storeWaId);
    dashboard.updateWAStatus(storeWaId, "Memulihkan sesi WhatsApp...");

    const client = clients.get(storeWaId);
    if (client) {
        try {
            await client.destroy();
        } catch (error) {
            logger.warn(`[${storeWaId}] Destroy runtime lama gagal (${reason}): ${cleanErrorMessage(error)}`);
        }
        clients.delete(storeWaId);
    }
    initializedClients.delete(storeWaId);

    // Tunggu OS release Chromium profile lock (SingletonLock).
    // Tanpa jeda ini, Chromium baru crash: "browser is already running".
    await sleep(3000);
    cleanupSessionLocks(storeWaId);
    await sleep(2000); // Pastikan OS sync selesai sebelum launch baru

    const newClient = createWhatsAppClient(storeWaId);
    setupEventListeners(newClient, storeWaId);
    newClient.initialize()
        .catch(error => {
            logger.error(`[${storeWaId}] Restart runtime gagal: ${cleanErrorMessage(error)}`);
            cleanupFailedClient(storeWaId);
        })
        .finally(() => restartingClients.delete(storeWaId));
}

/**
 * HEALTH CHECK & AUTO-RECOVERY (Production Grade)
 * Memastikan koneksi tidak 'Gantung' secara diam-diam.
 * Jika client tidak merespon/terdeteksi macet, bot akan restart otomatis.
 */
function initHealthCheck(storeWaId) {
    const CHECK_INTERVAL = 10 * 60 * 1000; // Cek tiap 10 menit (cukup untuk deteksi hang tanpa over-restart)
    const HANG_TIMEOUT_MS = 10000; // 10 detik — jika browser tidak respon, anggap hang
    
    const intervalId = setInterval(async () => {
        const client = clients.get(storeWaId);
        if (!client) {
            clearInterval(intervalId);
            return;
        }

        // SAFETY: Jangan restart jika bot sedang aktif membalas pesan customer
        // Import late untuk menghindari circular dependency
        try {
            const { getActiveAIRepliesCount } = require('./events/message_handler');
            const activeCount = getActiveAIRepliesCount ? getActiveAIRepliesCount() : 0;
            if (activeCount > 0) {
                logger.info(`[${storeWaId}] Health Check: Ditunda — ${activeCount} AI reply sedang berjalan.`);
                return;
            }
        } catch (_) { /* non-critical */ }

        try {
            // Heartbeat check: timeout singkat agar tidak lama menunggu browser hang
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Health check timeout')), HANG_TIMEOUT_MS)
            );
            
            await Promise.race([client.getState(), timeoutPromise]);
            // logger.info(`[${storeWaId}] Health Check: OK ✅`);
        } catch (e) {
            logger.error(`[${storeWaId}] Health Check GAGAL (Browser Hang/Macet). Restarting...`);
            await restartClientRuntime(storeWaId, 'health-check');
        }
    }, CHECK_INTERVAL);

    return intervalId;
}

/**
 * Membersihkan state internal saat launch gagal.
 * Dipanggil dari index.js saat client.initialize() crash/timeout.
 */
function cleanupFailedClient(storeWaId) {
    readyClients.delete(storeWaId);
    clients.delete(storeWaId);
    initializedClients.delete(storeWaId);
}

module.exports = {
    createWhatsAppClient,
    trackBotSentMessage,
    setupEventListeners,
    getClients,
    sendManualMessage,
    sendManualMedia,
    sendFollowUpMessage,
    requestPhoneNumber,
    resolveContactPhone,
    getLabels,
    createLabel,
    editLabel,
    deleteLabel,
    getLabelColorPalette,
    addOrRemoveLabels,
    sendReaction,
    forwardMessages,
    logoutClient,
    restartClientRuntime,
    cleanupFailedClient,
    initHealthCheck,
    getClientWajsStatus: wajsBridge.getClientWajsStatus,
    trackBotSentMessage,
    waitForActiveClient,
    isCurrentClient,
    getActiveClient
};
