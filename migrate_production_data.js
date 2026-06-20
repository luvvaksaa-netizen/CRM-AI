/**
 * migrate_production_data.js
 * Salin data dari database-production.sqlite ke data/database.sqlite
 * Jalankan sekali sebelum production launch.
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const SRC = 'D:/CRM-AI/database-production.sqlite';
const DST = 'D:/CRM-AI/data/database.sqlite';

const src = new sqlite3.Database(SRC, sqlite3.OPEN_READONLY);
const dst = new sqlite3.Database(DST, sqlite3.OPEN_READWRITE);

function run(db, sql, params = []) {
  return new Promise((res, rej) => db.run(sql, params, function(err) { err ? rej(err) : res(this); }));
}
function all(db, sql) {
  return new Promise((res, rej) => db.all(sql, (err, rows) => err ? rej(err) : res(rows)));
}
function get(db, sql) {
  return new Promise((res, rej) => db.get(sql, (err, row) => err ? rej(err) : res(row)));
}

async function migrate() {
  // Enable WAL on dst
  await run(dst, 'PRAGMA journal_mode=WAL');
  await run(dst, 'PRAGMA busy_timeout=30000');

  const tables = ['BotAgents','Stores','MediaAssets','ChatMessages','ChatSummaries',
                  'PausedContacts','FollowUps','ClosingPatterns','ClosingAnalytics',
                  'AdminConfigs','OpenAIUsageLogs','AppConfigs','XenditTransactions','OpenAICostLogs'];

  for (const tbl of tables) {
    try {
      const srcRows = await all(src, `SELECT * FROM "${tbl}"`);
      if (srcRows.length === 0) { console.log(`  ${tbl}: 0 rows, skip`); continue; }

      const dstCount = await get(dst, `SELECT COUNT(*) as c FROM "${tbl}"`);
      if (dstCount && dstCount.c > 0) {
        console.log(`  ${tbl}: already has ${dstCount.c} rows, skipping (use --force to overwrite)`);
        continue;
      }

      // Get columns from first row
      const cols = Object.keys(srcRows[0]);
      const placeholders = cols.map(() => '?').join(',');
      const colList = cols.map(c => `"${c}"`).join(',');
      const stmt = `INSERT OR IGNORE INTO "${tbl}" (${colList}) VALUES (${placeholders})`;

      await run(dst, 'BEGIN TRANSACTION');
      let inserted = 0;
      for (const row of srcRows) {
        try {
          await run(dst, stmt, cols.map(c => row[c]));
          inserted++;
        } catch(e) {
          // skip duplicate
        }
      }
      await run(dst, 'COMMIT');
      console.log(`  ✅ ${tbl}: ${inserted}/${srcRows.length} rows migrated`);
    } catch(e) {
      console.log(`  ❌ ${tbl}: ${e.message}`);
      try { await run(dst, 'ROLLBACK'); } catch(_) {}
    }
  }

  src.close();
  dst.close();
  console.log('\n✅ Migration selesai!');
}

migrate().catch(e => {
  console.error('Migration gagal:', e.message);
  process.exit(1);
});
