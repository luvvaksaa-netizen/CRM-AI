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
const sqlite3 = require('sqlite3').verbose();

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), 'data');

const DB_PATH = path.join(DATA_DIR, 'database.sqlite');

console.log(`[Migration] Target DB: ${DB_PATH}`);

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error(`[Migration] Gagal buka DB: ${err.message}`);
    process.exit(1);
  }
});

db.run('PRAGMA journal_mode=WAL');

// Helper: jalankan query dan return Promise
function run(sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => err ? reject(err) : resolve());
  });
}

// Helper: ambil semua baris
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

async function columnExists(table, column) {
  const rows = await all(`PRAGMA table_info(${table})`);
  return rows.some(col => col.name === column);
}

async function tableExists(table) {
  const rows = await all(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [table]);
  return rows.length > 0;
}

async function main() {
  const migrations = [
    {
      desc: 'Create / ensure PausedContacts table with paused_until',
      run: async () => {
        const exists = await tableExists('PausedContacts');
        if (!exists) {
          await run(`
            CREATE TABLE PausedContacts (
              store_wa_id  TEXT NOT NULL,
              contact_id   TEXT NOT NULL,
              paused_at    DATETIME DEFAULT (datetime('now')),
              paused_until DATETIME,
              paused_by    TEXT DEFAULT 'manual',
              PRIMARY KEY (store_wa_id, contact_id)
            )
          `);
          return 'Created PausedContacts table';
        }
        return 'SKIP — table already exists';
      }
    },
    {
      desc: 'Add paused_until column to PausedContacts',
      run: async () => {
        if (!(await tableExists('PausedContacts'))) return 'SKIP — table not found';
        if (await columnExists('PausedContacts', 'paused_until')) return 'SKIP — already exists';
        await run(`ALTER TABLE PausedContacts ADD COLUMN paused_until DATETIME`);
        return 'ADDED paused_until column ✅';
      }
    },
    {
      desc: 'Add paused_at column to PausedContacts',
      run: async () => {
        if (!(await tableExists('PausedContacts'))) return 'SKIP — table not found';
        if (await columnExists('PausedContacts', 'paused_at')) return 'SKIP — already exists';
        await run(`ALTER TABLE PausedContacts ADD COLUMN paused_at DATETIME DEFAULT (datetime('now'))`);
        return 'ADDED paused_at column ✅';
      }
    },
    {
      desc: 'Add paused_by column to PausedContacts',
      run: async () => {
        if (!(await tableExists('PausedContacts'))) return 'SKIP — table not found';
        if (await columnExists('PausedContacts', 'paused_by')) return 'SKIP — already exists';
        await run(`ALTER TABLE PausedContacts ADD COLUMN paused_by TEXT DEFAULT 'manual'`);
        return 'ADDED paused_by column ✅';
      }
    },
    {
      desc: 'Create / ensure OpenAICostLogs table',
      run: async () => {
        const exists = await tableExists('OpenAICostLogs');
        if (!exists) {
          await run(`
            CREATE TABLE OpenAICostLogs (
              id                INTEGER PRIMARY KEY AUTOINCREMENT,
              model             TEXT    NOT NULL,
              prompt_tokens     INTEGER DEFAULT 0,
              completion_tokens INTEGER DEFAULT 0,
              total_tokens      INTEGER DEFAULT 0,
              input_cost        TEXT    DEFAULT '0.00000000',
              output_cost       TEXT    DEFAULT '0.00000000',
              total_cost        TEXT    DEFAULT '0.00000000',
              endpoint          TEXT,
              function_name     TEXT,
              created_at        DATETIME DEFAULT (datetime('now'))
            )
          `);
          return 'Created OpenAICostLogs table ✅';
        }
        // Pastikan kolom created_at ada (mungkin tabel dibuat tanpa kolom ini)
        if (!(await columnExists('OpenAICostLogs', 'created_at'))) {
          await run(`ALTER TABLE OpenAICostLogs ADD COLUMN created_at DATETIME DEFAULT (datetime('now'))`);
          return 'ADDED created_at column to OpenAICostLogs ✅';
        }
        return 'SKIP — table already exists';
      }
    },
  ];

  console.log(`\n[Migration] Menjalankan ${migrations.length} migrasi...\n`);

  let allOk = true;
  for (const m of migrations) {
    try {
      const result = await m.run();
      console.log(`  ✅ ${m.desc}: ${result}`);
    } catch (e) {
      console.error(`  ❌ ${m.desc}: ${e.message}`);
      allOk = false;
    }
  }

  db.close();
  console.log(`\n[Migration] ${allOk ? '✅ SELESAI — restart wa-crm-v2 sekarang' : '⚠️  SELESAI dengan error'}\n`);
}

main().catch(e => {
  console.error('[Migration] Fatal:', e.message);
  db.close();
  process.exit(1);
});
