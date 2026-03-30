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
 * Membersihkan SingletonLock per-ClientId untuk stabilitas.
 */
function cleanupSessionLocks(clientId) {
    const sessionDir = path.join(process.cwd(), '.wwebjs_auth', `session-${clientId}`);
    const lockFile = path.join(sessionDir, 'SingletonLock');
    if (fs.existsSync(lockFile)) {
        try {
            fs.unlinkSync(lockFile);
            logger.info(`[${clientId}] Membersihkan SingletonLock.`);
        } catch (e) {
            // Abaikan jika gagal (biasanya karena file tidak ada)
        }
    }
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
            handleSIGINT: false
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

module.exports = {
    createWhatsAppClient,
    setupEventListeners,
    getClients,
    sendManualMessage
};
