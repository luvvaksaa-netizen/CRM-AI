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

  // ══════════════════════════════════════
  // 1. SCHEMA TABEL BotAgents
  // ══════════════════════════════════════
  console.log('\n=== SCHEMA TABEL KUNCI ===');
  for (const tbl of ['Stores', 'BotAgents', 'MediaAssets', 'ChatSummaries', 'ChatMessages', 'ClosingPatterns']) {
    try {
      const cols = await query(`PRAGMA table_info("${tbl}")`);
      console.log(`[${tbl}]: ${cols.map(c => c.name).join(', ')}`);
    } catch(e) { console.log(`[${tbl}]: ERROR - ${e.message}`); }
  }

  // ══════════════════════════════════════
  // 2. STORES
  // ══════════════════════════════════════
  console.log('\n\n=== STORES ===');
  const stores = await query('SELECT * FROM Stores ORDER BY id');
  stores.forEach(s => {
    console.log(`\n--- Store ID: ${s.id} ---`);
    Object.keys(s).forEach(k => {
      const v = s[k];
      if (v && k !== 'system_prompt' && k !== 'product_knowledge') {
        console.log(`  ${k}: ${String(v).substring(0, 120)}`);
      }
    });
    // system_prompt dan product_knowledge tampilkan terpisah
    if (s.system_prompt) {
      console.log('\n  SYSTEM_PROMPT:');
      console.log(s.system_prompt);
    }
    if (s.product_knowledge) {
      console.log('\n  PRODUCT_KNOWLEDGE:');
      console.log(s.product_knowledge);
    }
  });

  // ══════════════════════════════════════
  // 3. BOT AGENTS — FULL DETAIL
  // ══════════════════════════════════════
  console.log('\n\n=== BOT AGENTS (FULL DETAIL) ===');
  const agents = await query('SELECT * FROM BotAgents ORDER BY id');
  console.log(`Total: ${agents.length} agents`);
  agents.forEach(a => {
    console.log('\n' + '═'.repeat(80));
    // Print semua field kecuali konten panjang dulu
    Object.keys(a).forEach(k => {
      const v = a[k];
      const longFields = ['product_knowledge','personality','custom_instructions',
        'closing_script','additional_context','opening_script','upselling_script',
        'objection_handling','system_prompt','knowledge_base','behavior'];
      if (!longFields.includes(k)) {
        console.log(`${k}: ${v}`);
      }
    });
    // Lalu print konten panjang
    Object.keys(a).forEach(k => {
      const v = a[k];
      if (v && typeof v === 'string' && v.length > 50 &&
          ['product_knowledge','personality','custom_instructions',
           'closing_script','additional_context','opening_script','upselling_script',
           'objection_handling','system_prompt','knowledge_base','behavior'].includes(k)) {
        console.log(`\n--- ${k.toUpperCase()} ---`);
        console.log(v);
      }
    });
  });

  // ══════════════════════════════════════
  // 4. MEDIA ASSETS — FULL DETAIL
  // ══════════════════════════════════════
  console.log('\n\n=== MEDIA ASSETS (FULL DETAIL) ===');
  const media = await query('SELECT * FROM MediaAssets ORDER BY agent_id, id');
  console.log(`Total: ${media.length} media`);
  let lastAgent = null;
  media.forEach(m => {
    if (m.agent_id !== lastAgent) {
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`AGENT ID: ${m.agent_id}`);
      lastAgent = m.agent_id;
    }
    console.log(`\n  [Media ID: ${m.id}]`);
    Object.keys(m).forEach(k => {
      if (m[k] !== null && m[k] !== undefined) {
        console.log(`    ${k}: ${String(m[k]).substring(0, 200)}`);
      }
    });
  });

  // ══════════════════════════════════════
  // 5. DISTRIBUSI LABEL CHAT
  // ══════════════════════════════════════
  console.log('\n\n=== DISTRIBUSI LABEL CHAT ===');
  try {
    const dist = await query(`
      SELECT store_wa_id, wa_labels, COUNT(*) as count 
      FROM ChatSummaries
      WHERE wa_labels IS NOT NULL AND wa_labels != '[]'
      GROUP BY store_wa_id, wa_labels 
      ORDER BY store_wa_id, count DESC
      LIMIT 200
    `);
    dist.forEach(d => {
      console.log(`  Store: ${d.store_wa_id} | Labels: ${d.wa_labels} | Jumlah: ${d.count}`);
    });
  } catch(e) { console.log('[ERROR]', e.message); }

  // ══════════════════════════════════════
  // 6. SAMPLE REKAP (5 terbaru)
  // ══════════════════════════════════════
  console.log('\n\n=== SAMPLE REKAP TERBARU ===');
  try {
    const summaries = await query(`
      SELECT store_wa_id, contact_id, wa_labels, summary, updatedAt
      FROM ChatSummaries
      WHERE summary IS NOT NULL AND summary != ''
      ORDER BY updatedAt DESC
      LIMIT 15
    `);
    summaries.forEach(s => {
      console.log(`\n[Store: ${s.store_wa_id}] [Labels: ${s.wa_labels}] [Updated: ${s.updatedAt}]`);
      console.log(s.summary);
    });
  } catch(e) { console.log('[ERROR]', e.message); }

  // ══════════════════════════════════════
  // 7. CLOSING PATTERNS
  // ══════════════════════════════════════
  console.log('\n\n=== CLOSING PATTERNS ===');
  try {
    const patterns = await query('SELECT * FROM ClosingPatterns ORDER BY agent_id LIMIT 20');
    console.log(`Total: ${patterns.length} patterns`);
    patterns.forEach(p => {
      console.log(`\n[Pattern ID: ${p.id}] Agent: ${p.agent_id} | Type: ${p.pattern_type} | Success: ${p.success_rate}`);
      if (p.pattern_content) console.log(`  Content: ${String(p.pattern_content).substring(0, 300)}`);
    });
  } catch(e) { console.log('[ERROR / table not found]', e.message); }

  db.close();
  console.log('\n\n=== AUDIT SELESAI ===');
}

run().catch(e => { console.error('ERROR:', e); db.close(); process.exit(1); });
