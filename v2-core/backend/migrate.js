/**
 * migrate.js — One-time migration script untuk v2-core
 *
 * Jalankan sekali saja di server:
 *   node migrate.js
 *
 * Aman dijalankan berkali-kali (idempotent).
 */

require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), 'data');

const DB_PATH = path.join(DATA_DIR, 'database.sqlite');

console.log(`[Migration] Target DB: ${DB_PATH}`);

let db;
try {
  db = new Database(DB_PATH);
} catch (e) {
  console.error(`[Migration] Gagal buka DB: ${e.message}`);
  process.exit(1);
}

db.pragma('journal_mode = WAL');

// Helper: cek apakah kolom sudah ada
function columnExists(table, column) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all();
  return info.some(col => col.name === column);
}

// Helper: cek apakah tabel ada
function tableExists(table) {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  return Boolean(row);
}

const migrations = [
  // 1. Tambah paused_until ke PausedContacts
  {
    desc: 'Add paused_until to PausedContacts',
    run: () => {
      if (!tableExists('PausedContacts')) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS PausedContacts (
            store_wa_id TEXT NOT NULL,
            contact_id  TEXT NOT NULL,
            paused_at   DATETIME DEFAULT (datetime('now')),
            paused_until DATETIME,
            paused_by   TEXT DEFAULT 'manual',
            PRIMARY KEY (store_wa_id, contact_id)
          )
        `);
        return 'Created PausedContacts table with paused_until';
      }
      if (!columnExists('PausedContacts', 'paused_until')) {
        db.exec(`ALTER TABLE PausedContacts ADD COLUMN paused_until DATETIME`);
        return 'Added paused_until column';
      }
      return 'SKIP — already exists';
    }
  },

  // 2. Tambah paused_by ke PausedContacts jika belum ada
  {
    desc: 'Add paused_by to PausedContacts',
    run: () => {
      if (!tableExists('PausedContacts')) return 'SKIP — table not found';
      if (!columnExists('PausedContacts', 'paused_by')) {
        db.exec(`ALTER TABLE PausedContacts ADD COLUMN paused_by TEXT DEFAULT 'manual'`);
        return 'Added paused_by column';
      }
      return 'SKIP — already exists';
    }
  },

  // 3. Tambah paused_at ke PausedContacts jika belum ada
  {
    desc: 'Add paused_at to PausedContacts',
    run: () => {
      if (!tableExists('PausedContacts')) return 'SKIP — table not found';
      if (!columnExists('PausedContacts', 'paused_at')) {
        db.exec(`ALTER TABLE PausedContacts ADD COLUMN paused_at DATETIME DEFAULT (datetime('now'))`);
        return 'Added paused_at column';
      }
      return 'SKIP — already exists';
    }
  },
];

console.log(`\n[Migration] Menjalankan ${migrations.length} migrasi...\n`);

let allOk = true;
for (const m of migrations) {
  try {
    const result = m.run();
    console.log(`  ✅ ${m.desc}: ${result}`);
  } catch (e) {
    console.error(`  ❌ ${m.desc}: ${e.message}`);
    allOk = false;
  }
}

db.close();

console.log(`\n[Migration] ${allOk ? '✅ SELESAI — semua migrasi berhasil' : '⚠️  SELESAI dengan error'}`);
console.log('[Migration] Restart wa-crm-v2 sekarang.\n');
