/**
 * seed_app_configs.js
 * Seed konfigurasi aplikasi (Mengantar, Scalev, dll) dari .env ke AppConfigs tabel
 * Jalankan sekali untuk inisialisasi konfigurasi
 */
require('dotenv').config({ path: __dirname + '/v2-core/backend/.env' });
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.resolve(DATA_DIR, 'database.sqlite');

const db = new sqlite3.Database(DB_FILE, sqlite3.OPEN_READWRITE, (err) => {
  if (err) { console.error('DB Error:', err.message); process.exit(1); }
  console.log('Connected to:', DB_FILE);
});

function run(sql, params = []) {
  return new Promise((res, rej) => db.run(sql, params, function(err) { err ? rej(err) : res(this); }));
}

async function seed() {
  await run('PRAGMA journal_mode=WAL');
  await run('PRAGMA busy_timeout=15000');

  const configs = [
    // Mengantar
    { key: 'mengantar_api_key',    value: process.env.MENGANTAR_API_KEY || '' },
    { key: 'mengantar_address_id', value: process.env.MENGANTAR_ADDRESS_ID || '' },
    { key: 'mengantar_courier',    value: process.env.MENGANTAR_COURIER || 'JT' },
    // Scalev
    { key: 'scalev_api_key',       value: process.env.SCALEV_API_KEY || '' },
    { key: 'scalev_store_id',      value: process.env.SCALEV_STORE_UNIQUE_ID || '' },
    { key: 'scalev_webhook_secret',value: process.env.SCALEV_WEBHOOK_SECRET || '' },
    // OpenAI
    { key: 'openai_model',         value: process.env.MODEL_NAME || 'gpt-4o-mini' },
  ];

  for (const { key, value } of configs) {
    if (!value) { console.log(`  SKIP ${key} (empty)`); continue; }
    try {
      await run(
        `INSERT INTO AppConfigs (key, value, createdAt, updatedAt) VALUES (?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=datetime('now')`,
        [key, value]
      );
      const masked = value.length > 8 ? value.substring(0, 8) + '...' : '***';
      console.log(`  ✅ ${key} = ${masked}`);
    } catch (e) {
      console.log(`  ❌ ${key}: ${e.message}`);
    }
  }

  db.close();
  console.log('\n✅ Seed selesai!');
}

seed().catch(e => { console.error(e.message); process.exit(1); });
