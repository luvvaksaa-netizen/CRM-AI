/**
 * Migration: Tambah kolom closing_probability ke tabel ClosingAnalytics
 * Jalankan sekali: node migrate_closing_probability.cjs
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.resolve(__dirname, '../../data/database.sqlite');

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) { console.error('❌ Gagal buka DB:', err.message); process.exit(1); }
});

function columnExists(table, column, cb) {
    db.all(`PRAGMA table_info(${table})`, (err, rows) => {
        if (err) return cb(err, false);
        cb(null, rows.some(r => r.name === column));
    });
}

function addColumnIfMissing(table, column, definition, cb) {
    columnExists(table, column, (err, exists) => {
        if (err) return cb(err);
        if (exists) {
            console.log(`ℹ️  Kolom "${column}" sudah ada, skip.`);
            return cb(null);
        }
        db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, (err2) => {
            if (err2) return cb(err2);
            console.log(`✅ Kolom "${column}" berhasil ditambahkan ke "${table}"`);
            cb(null);
        });
    });
}

addColumnIfMissing('ClosingAnalytics', 'closing_probability', 'INTEGER NULL', (err) => {
    if (err) console.error('❌ Migration error:', err.message);
    else console.log('\n✅ Migration selesai.');
    db.close();
});
