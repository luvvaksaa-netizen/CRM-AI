const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database-production.sqlite');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, err => {
  if (err) { console.error('Gagal buka DB:', err.message); process.exit(1); }
});

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

async function run() {
  // SCHEMA BotAgents
  const agentCols = await query('PRAGMA table_info("BotAgents")');
  console.log('\n=== SCHEMA BotAgents ===');
  console.log(agentCols.map(c => c.name).join(', '));

  const mediaCols = await query('PRAGMA table_info("MediaAssets")');
  console.log('\n=== SCHEMA MediaAssets ===');
  console.log(mediaCols.map(c => c.name).join(', '));

  // Ambil semua agent
  const agents = await query('SELECT * FROM BotAgents ORDER BY id');
  console.log(`\n=== BOT AGENTS (${agents.length} total) ===`);

  agents.forEach(a => {
    console.log('\n' + '═'.repeat(80));
    // Print field non-teks pendek dulu
    Object.keys(a).forEach(k => {
      const v = a[k];
      if (v !== null && v !== undefined && typeof v === 'string' && v.length < 100) {
        console.log(`${k}: ${v}`);
      } else if (v !== null && v !== undefined && typeof v !== 'string') {
        console.log(`${k}: ${v}`);
      }
    });
    // Print semua field teks panjang
    Object.keys(a).forEach(k => {
      const v = a[k];
      if (v && typeof v === 'string' && v.length >= 100) {
        console.log(`\n--- ${k.toUpperCase()} ---`);
        console.log(v);
      }
    });
  });

  // Ambil semua media
  const media = await query('SELECT * FROM MediaAssets ORDER BY agent_id, id');
  console.log(`\n\n=== MEDIA ASSETS (${media.length} total) ===`);

  let lastAgent = null;
  media.forEach(m => {
    if (m.agent_id !== lastAgent) {
      console.log(`\n${'─'.repeat(70)}`);
      console.log(`>>> AGENT ID: ${m.agent_id} <<<`);
      lastAgent = m.agent_id;
    }
    console.log(`\n  [ID: ${m.id}]`);
    Object.keys(m).forEach(k => {
      const v = m[k];
      if (v !== null && v !== undefined && v !== '') {
        console.log(`    ${k}: ${String(v).substring(0, 300)}`);
      }
    });
  });

  db.close();
  console.log('\n=== SELESAI ===');
}

run().catch(e => { console.error('ERROR:', e); db.close(); process.exit(1); });
