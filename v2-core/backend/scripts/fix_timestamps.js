const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const STORE_WA_ID = 'cs-hani-2741'; 
const DB_PATH_OPTIONS = [
    process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'database.sqlite') : null,
    path.join(process.cwd(), 'data', 'database.sqlite'),
    'C:\\Users\\Lenovo\\Documents\\CRM-AI\\data\\database.sqlite',
    'D:\\CRM-AI\\data\\database.sqlite',
    path.join(__dirname, '../../data', 'database.sqlite')
].filter(Boolean);

let DB_PATH = DB_PATH_OPTIONS.find(p => fs.existsSync(p));

if (!DB_PATH) {
    console.error('❌ Database tidak ditemukan!');
    process.exit(1);
}

const db = new sqlite3.Database(DB_PATH);

console.log(`\n🧹 Memulai Pembersihan Chat yang Jam-nya Berantakan (Salah Sinkronisasi)...`);

// Hapus pesan yang createdAt-nya hari ini dalam 1 jam terakhir (waktu saat salah sync)
// SQLite datetime('now', '-1 hours') menggunakan UTC
const query = `
    DELETE FROM ChatMessages 
    WHERE store_wa_id = ? 
    AND createdAt >= datetime('now', '-2 hours')
`;

db.run(query, [STORE_WA_ID], function(err) {
    if (err) {
        console.error('❌ Gagal membersihkan database:', err.message);
    } else {
        console.log(`✅ Berhasil menghapus ${this.changes} pesan yang jam-nya salah.`);
        console.log(`\nLangkah selanjutnya: Jalankan kembali node scripts/sync_hani_today.js`);
    }
    db.close();
});
