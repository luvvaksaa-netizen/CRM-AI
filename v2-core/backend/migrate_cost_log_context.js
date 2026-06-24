/**
 * @file migrate_cost_log_context.js
 * @description Migration: Tambah kolom context (store_wa_id, contact_id, contact_phone)
 * ke tabel OpenAICostLogs yang sudah ada di production.
 *
 * AMAN untuk dijalankan berulang — cek dulu apakah kolom sudah ada.
 *
 * Cara pakai:
 *   node migrate_cost_log_context.js
 */

const path = require('path');
const Database = require('sqlite3').verbose();

// ─── Resolve DB path (sama seperti production) ───
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../data');
const DB_PATH  = path.resolve(DATA_DIR, 'database.sqlite');

console.log(`[Migration] Database: ${DB_PATH}`);

const db = new Database.Database(DB_PATH, (err) => {
  if (err) {
    console.error('[Migration] Gagal buka database:', err.message);
    process.exit(1);
  }
  runMigration();
});

function runMigration() {
  // Cek kolom yang sudah ada
  db.all('PRAGMA table_info(OpenAICostLogs)', (err, cols) => {
    if (err) {
      console.error('[Migration] Gagal baca schema:', err.message);
      db.close();
      return;
    }

    const existingCols = new Set(cols.map(c => c.name));
    console.log('[Migration] Kolom saat ini:', [...existingCols].join(', '));

    const toAdd = [];

    if (!existingCols.has('store_wa_id')) {
      toAdd.push("ALTER TABLE OpenAICostLogs ADD COLUMN store_wa_id TEXT");
    }
    if (!existingCols.has('contact_id')) {
      toAdd.push("ALTER TABLE OpenAICostLogs ADD COLUMN contact_id TEXT");
    }
    if (!existingCols.has('contact_phone')) {
      toAdd.push("ALTER TABLE OpenAICostLogs ADD COLUMN contact_phone TEXT");
    }

    if (toAdd.length === 0) {
      console.log('[Migration] Semua kolom sudah ada. Tidak perlu migration.');
      db.close();
      return;
    }

    // Jalankan setiap ALTER satu per satu (SQLite tidak support multi-ALTER)
    let i = 0;
    function next() {
      if (i >= toAdd.length) {
        console.log('[Migration] ✅ Semua kolom berhasil ditambahkan!');
        db.close();
        return;
      }
      const sql = toAdd[i++];
      console.log(`[Migration] Menjalankan: ${sql}`);
      db.run(sql, (err2) => {
        if (err2) {
          console.error(`[Migration] Error: ${err2.message}`);
          db.close();
          process.exit(1);
        }
        next();
      });
    }
    next();
  });
}
