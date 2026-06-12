const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const sqlite3 = require('sqlite3').verbose();

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'database.sqlite');
console.log('DB:', DB_PATH);

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
  if (err) { console.error('Gagal buka DB:', err.message); process.exit(1); }
});

async function run() {
  // Cek semua tabel
  const tables = await query('SELECT name FROM sqlite_master WHERE type=\'table\' ORDER BY name');
  console.log('\n=== SEMUA TABEL ===');
  tables.forEach(r => process.stdout.write(' - ' + r.name + '\n'));

  // Fokus ke tabel cost/openai
  const targets = tables.filter(r =>
    r.name.toLowerCase().includes('cost') ||
    r.name.toLowerCase().includes('openai')
  );

  if (targets.length === 0) {
    console.log('\n❌ Tidak ada tabel Cost/OpenAI!');
    console.log('=> Tabel OpenAICostLogs BELUM dibuat. Ini penyebab Validation error!');
  }

  for (const t of targets) {
    const cols = await query('PRAGMA table_info(' + t.name + ')');
    console.log('\n=== SCHEMA: ' + t.name + ' ===');
    cols.forEach(c =>
      console.log('  ' + c.name.padEnd(22) + '| ' + (c.type||'').padEnd(12) + '| notnull:' + c.notnull + ' | default:' + c.dflt_value)
    );
    const cnt = await query('SELECT COUNT(*) as cnt FROM ' + t.name);
    console.log('  TOTAL ROWS:', cnt[0].cnt);
  }
}

function query(sql, params = []) {
  return new Promise((res, rej) => {
    db.all(sql, params, (err, rows) => err ? rej(err) : res(rows));
  });
}

run().then(() => {
  setTimeout(() => { db.close(); }, 500);
}).catch(e => {
  console.error('Error:', e.message);
  db.close();
});
