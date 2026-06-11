const { createWhatsAppClient, setupEventListeners, getClients, cleanupFailedClient } = require('./src/whatsapp_service');
const { validateConfig } = require('./src/config');
const logger = require('./src/utils/logger');
const dashboard = require('./src/services/dashboard_service');
const { initDB, Store } = require('./src/database/index');
const { initBackupService, performBackup } = require('./src/services/backup_service');
const { runStartupTempCleanup } = require('./src/services/temp_cleanup_service');

const CLIENT_LAUNCH_TIMEOUT_MS = Number(process.env.CLIENT_LAUNCH_TIMEOUT_MS || 120000);

function withTimeout(promise, timeoutMs, message) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

/**
 * Start the Multi-Session WhatsApp AI & CRM Dashboard.
 * Mode: WWebJS (Chromium Browser) — setiap Store = 1 browser instance.
 */
async function startBot() {
    // 0. Validasi Konfigurasi
    if (!validateConfig()) {
        logger.error('Startup gagal karena konfigurasi tidak valid.');
        process.exit(1);
    }

    // 1. Inisialisasi Database & Backup
    runStartupTempCleanup();
    await initDB();
    initBackupService();
    performBackup(); // Snapshot saat startup

    // 2. Inisialisasi Web Dashboard
    const PORT = Number(process.env.PORT || 3001);
    dashboard.initDashboard(PORT);

    // 3. Inisialisasi Akun WA (Multi-Session Sequential Launch)
    try {
        let stores = await Store.findAll();
        
        // Auto-Create default store jika database kosong
        if (stores.length === 0) {
            logger.info("Database baru terdeteksi. Membuat profil [default]...");
            await Store.create({
                wa_id: 'default',
                name: 'Toko Utama',
                is_bot_active: true
            });
            stores = await Store.findAll();
        }

        const { initHealthCheck } = require('./src/whatsapp_service');
        const STAGGER_DELAY_MS = 15000; // 15 detik jeda antar-browser agar RAM tidak spike

        for (let i = 0; i < stores.length; i++) {
            const store = stores[i];
            const client = createWhatsAppClient(store.wa_id);
            setupEventListeners(client, store.wa_id);
            
            try {
                await withTimeout(
                    client.initialize(),
                    CLIENT_LAUNCH_TIMEOUT_MS,
                    `Timeout launch browser setelah ${CLIENT_LAUNCH_TIMEOUT_MS / 1000} detik`
                );
                logger.success(`[${store.wa_id}] Browser berhasil diluncurkan (${i + 1}/${stores.length}).`);
                // Health check hanya untuk client yang berhasil launch
                initHealthCheck(store.wa_id);
            } catch (err) {
                logger.error(`Gagal menghubungkan [${store.wa_id}]: ${err.message}`);
                try {
                    await client.destroy();
                } catch (_) {}
                cleanupFailedClient(store.wa_id);
            }

            // Jeda antar-browser (jika masih ada store berikutnya)
            if (i < stores.length - 1) {
                logger.info(`⏳ Menunggu ${STAGGER_DELAY_MS / 1000} detik sebelum meluncurkan browser berikutnya...`);
                await new Promise(r => setTimeout(r, STAGGER_DELAY_MS));
            }
        }
        
        logger.success(`🚀 Semua ${stores.length} sesi WA siap!`);

    } catch (err) {
        logger.error(`Gagal inisialisasi sesi: ${err.message}`);
    }

    // 4. Graceful Shutdown — handle SIGINT (Ctrl+C) dan SIGTERM (pm2 stop/reload)
    // Menutup HTTP server dulu sebelum exit agar port 3001 dilepas bersih
    // dan mencegah error EADDRINUSE pada pm2 reload berikutnya.
    async function gracefulShutdown(signal) {
        logger.warn(`[Shutdown] Menerima ${signal} — mematikan bot secara aman...`);

        // 1. Tutup HTTP server + Socket.IO (lepas port 3001)
        await dashboard.closeServer();

        // 2. Tutup semua sesi WhatsApp
        const clients = getClients();
        for (const [id, client] of clients) {
            try {
                logger.info(`[Shutdown] Menutup sesi WA [${id}]...`);
                await client.destroy();
            } catch (e) { /* ignore — sudah mati */ }
        }

        logger.success('[Shutdown] Semua sesi ditutup. Sampai jumpa! 👋');
        process.exit(0);
    }

    process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

// Jalankan bot
startBot();
