/**
 * Script sekali pakai untuk mengaktifkan mode RocketChat pada toko-sarung-9813
 */
const { Store, initDB } = require('./src/database/index');
const logger = require('./src/utils/logger');

async function run() {
    try {
        console.log("Menghubungkan ke database...");
        await initDB();

        const waId = 'sampel-1761';
        const store = await Store.findOne({ where: { wa_id: waId } });

        if (!store) {
            console.error(`❌ Store dengan ID ${waId} tidak ditemukan!`);
            process.exit(1);
        }

        console.log(`Mengupdate ${store.name} (${waId})...`);

        await store.update({
            connection_mode: 'roketchat',
            roketchat_token: 'mvuo5hinj5rfjccl7bvdfaqm.9b48b4c0-292f-4bcd-a5c9-c15cece18efc',
            roketchat_device_id: 'mvuo5hinj5rfjccl7bvdfaqm', // Diambil dari bagian depan token
            roketchat_phone: '6282245587996'
        });

        console.log("✅ UPDATE BERHASIL!");
        console.log("--------------------------------------------------");
        console.log("Mode           : RocketChat API");
        console.log("Nomor WA       : 6282245587996");
        console.log("Token          : mvuo5hinj5rfjccl7bvdfaqm.***");
        console.log("--------------------------------------------------");
        console.log("\nSilakan RESTART server Anda sekarang (node index.js)");

        process.exit(0);
    } catch (error) {
        console.error("❌ Terjadi kesalahan:", error.message);
        process.exit(1);
    }
}

run();
