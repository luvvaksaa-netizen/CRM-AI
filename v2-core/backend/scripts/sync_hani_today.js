const axios = require('axios');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const STORE_WA_ID = 'cs-hani-2741'; // ID dari WhatsApp CS Hani
const PORT = process.env.PORT || 3002;
let JWT_SECRET = process.env.JWT_SECRET || 'crm-ai-super-secret-key';
try {
    const ecoPath = path.join(__dirname, '../ecosystem.config.js');
    if (fs.existsSync(ecoPath)) {
        const eco = require(ecoPath);
        if (eco.apps && eco.apps[0] && eco.apps[0].env && eco.apps[0].env.JWT_SECRET) {
            JWT_SECRET = eco.apps[0].env.JWT_SECRET;
            console.log('🔑 Menggunakan JWT_SECRET dari ecosystem.config.js');
        }
    }
} catch (e) {}
const DB_PATH_OPTIONS = [
    process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'database.sqlite') : null,
    path.join(process.cwd(), 'data', 'database.sqlite'),
    'C:\\Users\\Lenovo\\Documents\\CRM-AI\\data\\database.sqlite',
    'D:\\CRM-AI\\data\\database.sqlite',
    path.join(__dirname, '../../data', 'database.sqlite')
].filter(Boolean);

let DB_PATH = DB_PATH_OPTIONS.find(p => fs.existsSync(p));
if (!DB_PATH) {
    console.error('❌ Database tidak ditemukan di lokasi manapun!');
    console.error('Pencarian dilakukan di:', DB_PATH_OPTIONS);
    process.exit(1);
}

async function main() {
    console.log(`\n🚀 Memulai Sinkronisasi Mendalam (Deep Sync) untuk [${STORE_WA_ID}]...`);
    console.log(`Batas tarikan: 100 pesan terakhir per kontak (Mencakup pesan hari ini dari jam 5 pagi)`);

    // 1. Generate Admin Token untuk bypass Auth API
    const token = jwt.sign({ id: 1, email: 'admin@system', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
    const axiosConfig = {
        headers: { Authorization: `Bearer ${token}` }
    };

    // 2. Hubungkan ke Database SQLite untuk mengambil daftar kontak CS Hani
    console.log(`\n📂 Membaca daftar kontak dari database: ${DB_PATH}`);
    if (!fs.existsSync(DB_PATH)) {
        console.error('❌ Database tidak ditemukan!');
        process.exit(1);
    }

    const db = new sqlite3.Database(DB_PATH);
    const contacts = await new Promise((resolve, reject) => {
        // Ambil kontak yang ada pesannya 7 hari terakhir untuk di-sync
        db.all(
            `SELECT DISTINCT contact_id, contact_display_name 
             FROM ChatMessages 
             WHERE store_wa_id = ? 
             ORDER BY timestamp DESC LIMIT 200`,
            [STORE_WA_ID],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            }
        );
    });
    db.close();

    console.log(`✅ Ditemukan ${contacts.length} kontak aktif. Memulai sinkronisasi via API internal...\n`);

    let successCount = 0;
    let failedCount = 0;

    // 3. Looping Sync per kontak via HTTP API ke PM2 instance
    for (let i = 0; i < contacts.length; i++) {
        const contact = contacts[i];
        const contactId = contact.contact_id;
        const name = contact.contact_display_name || contactId;

        process.stdout.write(`⏳ [${i+1}/${contacts.length}] Sinkronisasi chat dengan ${name}... `);

        try {
            // Minta PM2 untuk menarik 100 pesan (batas aman WA Web untuk 1 hari)
            const response = await axios.post(
                `http://localhost:${PORT}/api/chat/${STORE_WA_ID}/${encodeURIComponent(contactId)}/sync-wa`,
                { limit: 100 },
                axiosConfig
            );

            if (response.data && response.data.success) {
                const count = response.data.count || 0;
                console.log(`✅ Sukses (Terimpor ${count} pesan baru ke CRM)`);
                successCount++;
            } else {
                console.log(`⚠️ Gagal (API merespons tapi status false)`);
                failedCount++;
            }
        } catch (error) {
            // Error bisa terjadi jika WA Web sedang timeout atau nomor tidak valid
            const msg = error.response ? error.response.data.message : error.message;
            console.log(`❌ Error: ${msg}`);
            failedCount++;
        }

        // Delay 1.5 detik antar kontak agar WA Web di Chrome tidak nge-hang (Rate Limiting)
        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    console.log(`\n🎉 Proses Deep Sync Selesai!`);
    console.log(`✅ Berhasil di-sync: ${successCount} kontak`);
    console.log(`❌ Gagal/Timeout: ${failedCount} kontak`);
    console.log(`Jam dan tanggal pesan dijamin presisi mengikuti waktu asli WhatsApp.`);
}

main().catch(console.error);
