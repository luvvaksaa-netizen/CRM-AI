const { createWhatsAppClient, setupEventListeners, getClients } = require('./src/whatsapp_service');
const { validateConfig } = require('./src/config');
const logger = require('./src/utils/logger');
const dashboard = require('./src/services/dashboard_service');
const { initDB, Store } = require('./src/database/index');

/**
 * Start the Multi-Session WhatsApp AI & CRM Dashboard.
 */
async function startBot() {
    logger.bot('Memulai Multi-Session WhatsApp AI & CRM Dashboard...');

    // 1. Inisialisasi Database
    await initDB();

    // 2. Inisialisasi Web Dashboard
    dashboard.initDashboard(3000);

    // 3. Inisialisasi Akun (Multi-Session Loop)
    try {
        let stores = await Store.findAll();
        
        // Auto-Create default store if empty
        if (stores.length === 0) {
            logger.info("Database baru terdeteksi. Membuat profil [default]...");
            await Store.create({
                wa_id: 'default',
                name: 'Toko Utama',
                bot_name: 'Dono',
                system_prompt: 'Kamu adalah admin CS yang ramah.',
                is_bot_active: true
            });
            stores = await Store.findAll();
        }

        // Jalankan semua Client
        for (const store of stores) {
            const client = createWhatsAppClient(store.wa_id);
            setupEventListeners(client, store.wa_id);
            
            // Connect secara async agar tidak memblock loop
            client.initialize().catch(err => {
                logger.error(`Gagal menghubungkan [${store.wa_id}]: ${err.message}`);
            });
        }

    } catch (err) {
        logger.error(`Gagal inisialisasi sesi: ${err.message}`);
    }

    // 4. Graceful Shutdown untuk SEMUA Sesi
    process.on('SIGINT', async () => {
        logger.warn('Mematikan bot secara aman...');
        const clients = getClients();
        
        for (const [id, client] of clients) {
            try {
                logger.info(`Menutup sesi [${id}]...`);
                await client.destroy();
            } catch (e) { /* ignore */ }
        }
        
        logger.success('Semua sesi ditutup. Sampai jumpa! 👋');
        process.exit(0);
    });
}

// Jalankan bot
startBot();