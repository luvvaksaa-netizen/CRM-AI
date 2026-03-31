const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const logger = require('./utils/logger');
const dashboard = require('./services/dashboard_service');
const { handleMessage } = require('./events/message_handler');
const path = require('path');
const fs = require('fs');

// MULTI-CLIENT STORAGE
const clients = new Map();

/**
 * Mendapatkan semua Client yang aktif.
 */
function getClients() {
    return clients;
}

/**
 * Membersihkan semua Singleton Lock Files per-ClientId.
 * Mencegah error "profile already in use" saat container restart di Railway.
 */
function cleanupSessionLocks(clientId) {
    // Gunakan DATA_DIR config agar selaras
    const { DATA_DIR } = require('./config');
    
    // WA-Web.js by default menyimpan di .wwebjs_auth relatif terhadap CURRENT DIR,
    // yang mana sudah diset sebagai DATA_DIR di production lewat Dockerfile ENV.
    // Tapi untuk memastikan, kita gunakan path absolut ke DATA_DIR
    const baseWwebjsDir = path.join(process.cwd(), '.wwebjs_auth');
    const sessionDir = path.join(baseWwebjsDir, `session-${clientId}`);
    
    // Semua file lock yang perlu dihapus (Chronium stores this as symlinks)
    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];

    lockFiles.forEach(lockName => {
        const lockFile = path.join(sessionDir, lockName);
        try {
            // PENTING: Gunakan rmSync force karena SingletonLock adalah dangling symlink
            // fs.existsSync() akan me-return FALSE pada dangling symlink!
            fs.rmSync(lockFile, { force: true });
        } catch (e) {
            // Abaikan error (fail silently if not exists)
        }
    });
}

/**
 * Inisialisasi WhatsApp Client untuk Toko tertentu.
 * @param {string} storeWaId - Unik identifier dari tabel Store.
 */
function createWhatsAppClient(storeWaId) {
    cleanupSessionLocks(storeWaId);
    
    logger.info(`[${storeWaId}] Menyiapkan Browser & Sesi...`);
    dashboard.updateWAStatus(storeWaId, "Menyiapkan Browser...");

    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: storeWaId // SETIAP TOKO PUNYA SESSION TERPISAH! 🎉
        }),
        puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
            headless: true,
            handleSIGINT: false,
            timeout: 60000,           // 60 detik timeout launch
            protocolTimeout: 600000   // 10 menit timeout pengiriman data base64 CDP
        }
    });

    clients.set(storeWaId, client);
    return client;
}

/**
 * Menyiapkan Event Listeners untuk Client tertentu.
 */
function setupEventListeners(client, storeWaId) {
    client.on('qr', (qr) => {
        logger.bot(`[${storeWaId}] Scan QR Code di Dashboard UI`);
        dashboard.emitQRSpec(storeWaId, qr);
        dashboard.updateWAStatus(storeWaId, "Menunggu Scan QR...");
    });

    client.on('authenticated', () => {
        logger.success(`[${storeWaId}] Sesi WhatsApp Terautentikasi.`);
        dashboard.updateWAStatus(storeWaId, "Terautentikasi...");
    });

    client.on('ready', () => {
        logger.success(`[${storeWaId}] WhatsApp SIAP DIGUNAKAN! ✅`);
        dashboard.updateWAStatus(storeWaId, "Dihubungkan (Online)");
    });

    client.on('message', async (message) => {
        if (message.isStatus || message.from.includes('@g.us')) return;

        // Message Handler sekarang menerima Store ID (Context Aware)
        await handleMessage(message, storeWaId);
    });

    client.on('disconnected', (reason) => {
        logger.error(`[${storeWaId}] WhatsApp Terputus: ${reason}`);
        dashboard.updateWAStatus(storeWaId, "Terputus");
        clients.delete(storeWaId);
    });
}

/**
 * Mengirim pesan manual dari Dashboard melalui Client yang spesifik.
 * @param {string} storeWaId - Nomor toko yang mengirim.
 */
async function sendManualMessage(storeWaId, to, body) {
    const client = clients.get(storeWaId);
    if (!client) throw new Error(`Client [${storeWaId}] tidak aktif!`);
    
    try {
        const msg = await client.sendMessage(to, body);
        
        // Log ke Dashboard UI & DB dengan Store ID yang benar
        await dashboard.addToChatHistory(storeWaId, {
            id: msg.id.id,
            from: to,
            body: body,
            isMe: true,
            sender_name: 'CS Manual'
        });

        logger.info(`[${storeWaId}] Pesan Manual dikirim ke [${to}]`);
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
    const client = clients.get(storeWaId);
    if (!client) throw new Error(`Client [${storeWaId}] tidak aktif!`);

    try {
        const { MessageMedia } = require('whatsapp-web.js');
        const { UPLOADS_DIR } = require('./config');
        const path = require('path');
        const fs = require('fs');

        const mediaPath = path.join(UPLOADS_DIR, mediaAsset.filename);
        if (!fs.existsSync(mediaPath)) throw new Error('File media fisik tidak ditemukan.');

        const mediaMsg = MessageMedia.fromFilePath(mediaPath);
        const caption = mediaAsset.description || mediaAsset.label || '';
        const msg = await client.sendMessage(to, mediaMsg, { caption });

        // Tampilkan sebagai HTML thumbnail di Dashboard
        const fileExt = mediaPath.split('.').pop().toLowerCase();
        const tag = ['mp4', 'mov', 'avi'].includes(fileExt) ? '[VIDEO' : '[MEDIA';
        const logBody = `${tag}:/uploads/${mediaAsset.filename}] ${caption}`;

        await dashboard.addToChatHistory(storeWaId, {
            id: msg.id.id,
            from: to,
            body: logBody,
            isMe: true,
            sender_name: 'CS Manual'
        });

        logger.info(`[${storeWaId}] Media Manual [${mediaAsset.label}] dikirim ke [${to}]`);
        return true;
    } catch (error) {
        logger.error(`[${storeWaId}] Gagal kirim media manual: ${error.message}`);
        throw error;
    }
}

module.exports = {
    createWhatsAppClient,
    setupEventListeners,
    getClients,
    sendManualMessage,
    sendManualMedia
};
