/**
 * merge_stores.js
 * Merge Stores dari database-production.sqlite ke data/database.sqlite
 * (Jalankan setelah migrate_production_data.js selesai)
 */
const sqlite3 = require('sqlite3').verbose();

const SRC = 'D:/CRM-AI/database-production.sqlite';
const DST = 'D:/CRM-AI/data/database.sqlite';

function run(db, sql, params = []) {
  return new Promise((res, rej) => db.run(sql, params, function(err) { err ? rej(err) : res(this); }));
}
function all(db, sql) {
  return new Promise((res, rej) => db.all(sql, (err, rows) => err ? rej(err) : res(rows)));
}

async function merge() {
  const src = new sqlite3.Database(SRC, sqlite3.OPEN_READONLY);
  const dst = new sqlite3.Database(DST, sqlite3.OPEN_READWRITE);

  await run(dst, 'PRAGMA journal_mode=WAL');
  await run(dst, 'PRAGMA busy_timeout=30000');

  // Get src stores
  const srcStores = await all(src, 'SELECT * FROM "Stores"');
  console.log(`Source stores: ${srcStores.length}`);

  const dstStores = await all(dst, 'SELECT wa_id FROM "Stores"');
  const existingWaIds = new Set(dstStores.map(s => s.wa_id));
  console.log(`Existing dst stores: ${dstStores.length}`);

  await run(dst, 'BEGIN TRANSACTION');
  let inserted = 0, skipped = 0;
  for (const store of srcStores) {
    if (existingWaIds.has(store.wa_id)) {
      // Update existing
      await run(dst, `UPDATE "Stores" SET name=?, agent_id=?, is_bot_active=?, last_active=?, bot_phone=?,
        followup_config=?, bot_name=?, system_prompt=?, product_knowledge=? WHERE wa_id=?`,
        [store.name, store.agent_id, store.is_bot_active, store.last_active, store.bot_phone,
         store.followup_config, store.bot_name, store.system_prompt, store.product_knowledge, store.wa_id]);
      skipped++;
    } else {
      const cols = Object.keys(store).filter(c => c !== 'id');
      const placeholders = cols.map(() => '?').join(',');
      await run(dst, `INSERT OR IGNORE INTO "Stores" (${cols.map(c=>`"${c}"`).join(',')}) VALUES (${placeholders})`,
        cols.map(c => store[c]));
      inserted++;
    }
  }
  await run(dst, 'COMMIT');
  console.log(`✅ Stores: ${inserted} inserted, ${skipped} updated`);

  // Verify
  const finalCount = await all(dst, 'SELECT wa_id, name FROM "Stores"');
  console.log('\nFinal stores:');
  finalCount.forEach(s => console.log(`  - ${s.wa_id} | ${s.name}`));

  src.close();
  dst.close();
  console.log('\n✅ Merge selesai!');
}

merge().catch(e => { console.error('Merge gagal:', e.message); process.exit(1); });
