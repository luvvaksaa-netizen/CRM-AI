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

function cleanErrorMessage(error) {
    return String(error?.message || error || 'Unknown error').split('\n')[0];
}

async function getChatsWithRetry(client, attempts = 3, delayMs = 5000) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
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
        dashboard.updateWAStatus(storeWaId, "Dihubungkan (Online)");
        
        // Simpan nomor bot secara persisten agar muncul di UI
        if (client.info && client.info.wid && client.info.wid.user) {
            dashboard.updateStorePhone(storeWaId, client.info.wid.user).catch(()=>{});
        }

        await wajsBridge.injectWajs(client, storeWaId);
        
        try {
            logger.info(`[${storeWaId}] Memulai sinkronisasi pesan tertunda...`);
            const chats = await getChatsWithRetry(client);
            const unreadChats = chats.filter(chat => chat.unreadCount > 0);
            
            for (const chat of unreadChats) {
                const messages = await chat.fetchMessages({ limit: chat.unreadCount });
                for (const msg of messages) {
                    await handleMessage(msg, storeWaId, false);
                }
                await chat.sendSeen();
            }
            if (unreadChats.length > 0) logger.success(`[${storeWaId}] Berhasil menarik ${unreadChats.length} chat tertunda.`);
        } catch (e) {
            logger.warn(`[${storeWaId}] Sinkronisasi pesan tertunda dilewati: ${cleanErrorMessage(e)}`);
        }
    });

    client.on('message', async (message) => {
        if (message.isStatus || shouldIgnoreIncomingChat(message.from)) return;
        await handleMessage(message, storeWaId);
    });

    client.on('disconnected', (reason) => {
        logger.error(`[${storeWaId}] WhatsApp Terputus: ${reason}`);
        dashboard.updateWAStatus(storeWaId, "Terputus");
        clients.delete(storeWaId);
        initializedClients.delete(storeWaId);
    });

    // Tandai sebagai sudah diinisialisasi
    initializedClients.add(storeWaId);
}

/**
 * Mengirim pesan manual dari Dashboard melalui Client yang spesifik.
 * @param {string} storeWaId - Nomor toko yang mengirim.
 */
async function sendManualMessage(storeWaId, to, body) {
    const client = getActiveClient(storeWaId);
    const targetChatId = assertWaChatId(to);
    
    try {
        const msg = await client.sendMessage(targetChatId, body);
        
        // Log ke Dashboard UI & DB dengan Store ID yang benar
        await dashboard.addToChatHistory(storeWaId, {
            id: msg.id?._serialized || msg.id?.id,
            from: targetChatId,
            body: body,
            isMe: true,
            sender_name: 'CS Manual'
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
    const client = getActiveClient(storeWaId);
    const targetChatId = assertWaChatId(to);

    try {
        const { MessageMedia } = require('whatsapp-web.js');
        const { UPLOADS_DIR } = require('./config');
        const path = require('path');
        const fs = require('fs');

        const mediaPath = path.join(UPLOADS_DIR, mediaAsset.filename);
        if (!fs.existsSync(mediaPath)) throw new Error('File media fisik tidak ditemukan.');

        const mediaMsg = MessageMedia.fromFilePath(mediaPath);
        const caption = mediaAsset.description || mediaAsset.label || '';
        const msg = await client.sendMessage(targetChatId, mediaMsg, { caption });

        // Tampilkan sebagai HTML thumbnail di Dashboard
        const fileExt = mediaPath.split('.').pop().toLowerCase();
        const tag = ['mp4', 'mov', 'avi'].includes(fileExt) ? '[VIDEO' : '[MEDIA';
        const logBody = `${tag}:/uploads/${mediaAsset.filename}] ${caption}`;

        await dashboard.addToChatHistory(storeWaId, {
            id: msg.id?._serialized || msg.id?.id,
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

/**
 * HEALTH CHECK & AUTO-RECOVERY (Production Grade)
 * Memastikan koneksi tidak 'Gantung' secara diam-diam.
 * Jika client tidak merespon/terdeteksi macet, bot akan restart otomatis.
 */
function initHealthCheck(storeWaId) {
    const CHECK_INTERVAL = 5 * 60 * 1000; // Cek tiap 5 menit
    
    const intervalId = setInterval(async () => {
        const client = clients.get(storeWaId);
        if (!client) {
            clearInterval(intervalId);
            return;
        }

        try {
            // Heartbeat check: Mintalah info baterai/status browser sederhana
            // Jika ini hang > 30 detik, berarti Puppeteer macet.
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout')), 30000)
            );
            
            await Promise.race([client.getState(), timeoutPromise]);
            // logger.info(`[${storeWaId}] Health Check: OK ✅`);
        } catch (e) {
            logger.error(`[${storeWaId}] Health Check GAGAL (Browser Hang/Macet). Restarting...`);
            await logoutClient(storeWaId);
            const newClient = createWhatsAppClient(storeWaId);
            setupEventListeners(newClient, storeWaId);
            newClient.initialize().catch(() => {});
        }
    }, CHECK_INTERVAL);

    return intervalId;
}

/**
 * Membersihkan state internal saat launch gagal.
 * Dipanggil dari index.js saat client.initialize() crash/timeout.
 */
function cleanupFailedClient(storeWaId) {
    clients.delete(storeWaId);
    initializedClients.delete(storeWaId);
}

module.exports = {
    createWhatsAppClient,
    setupEventListeners,
    getClients,
    sendManualMessage,
    sendManualMedia,
    requestPhoneNumber,
    resolveContactPhone,
    getLabels,
    createLabel,
    addOrRemoveLabels,
    sendReaction,
    forwardMessages,
    logoutClient,
    cleanupFailedClient,
    initHealthCheck,
    getClientWajsStatus: wajsBridge.getClientWajsStatus
};
