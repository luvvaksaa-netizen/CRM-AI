/**
 * migrate-to-pg.js — Migrasi SQLite → PostgreSQL (Docker local)
 * 
 * Usage:
 *   cd v2-core/backend
 *   set DATABASE_URL=postgresql://postgres:pass@localhost:5432/crm_db
 *   node scripts/migrate-to-pg.js
 *
 * Safety: SQLite read-only, PostgreSQL insert-only.
 * Kalau tabel sudah ada data, row duplicate di-skip.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { Sequelize } = require('sequelize');
const path = require('path');

const SQLITE_PATH = process.env.SQLITE_PATH
  || path.resolve(__dirname, '../../data/database.sqlite');
const PG_URL = process.env.DATABASE_URL;

if (!PG_URL) {
  console.error('ERROR: DATABASE_URL not set.');
  console.error('Usage: set DATABASE_URL=postgresql://user:pass@host:5432/db && node scripts/migrate-to-pg.js');
  process.exit(1);
}

const MODELS = [
  'BotAgent', 'Store', 'MediaAsset', 'ChatMessage', 'ChatSummary',
  'PausedContact', 'FollowUp', 'ClosingPattern', 'AdminConfig',
  'ClosingAnalytic', 'OpenAIUsageLog', 'AppConfig', 'XenditTransaction',
  'OpenAICostLog'
];

async function migrate() {
  // ─── Connect ──────────────────────────────────────────
  const sqlite = new Sequelize({ dialect: 'sqlite', storage: SQLITE_PATH, logging: false });
  const pg = new Sequelize(PG_URL, { dialect: 'postgres', logging: false,
    dialectOptions: { ssl: PG_URL.includes('supabase') ? { require: true, rejectUnauthorized: false } : false }
  });

  await sqlite.authenticate();
  await pg.authenticate();
  console.log('Connected to SQLite + PostgreSQL');

  // Import models bound to SQLite
  const models = require('../src/models/index');
  
  // Sync PG tables first
  for (const name of MODELS) {
    const Model = models[name];
    if (!Model) continue;
    const pgModel = pg.define(Model.name, Model.rawAttributes, {
      ...Model.options, sequelize: pg, timestamps: false
    });
    await pgModel.sync();
  }
  console.log('PostgreSQL tables synced');

  let total = 0, errors = 0;

  for (const name of MODELS) {
    const Model = models[name];
    if (!Model) continue;

    try {
      const rows = await Model.findAll({ raw: true });
      if (rows.length === 0) { console.log(`  - ${name}: empty`); continue; }

      const PgModel = pg.define(Model.name, Model.rawAttributes, {
        ...Model.options, sequelize: pg, timestamps: false
      });

      let ok = 0, err = 0;
      for (const row of rows) {
        try {
          await PgModel.create(row);
          ok++;
        } catch (e) {
          if (e.name === 'SequelizeUniqueConstraintError') { ok++; continue; }
          err++;
          if (err <= 2) console.warn(`    ${name} row error: ${e.message.substring(0, 100)}`);
        }
      }
      console.log(`  ${err === 0 ? 'OK' : 'WARN'} ${name}: ${ok}/${rows.length} rows${err ? ' (' + err + ' err)' : ''}`);
      total += ok;
      errors += err;
    } catch (e) {
      console.error(`  FAIL ${name}: ${e.message}`);
    }
  }

  console.log(`\nDone! ${total} rows, ${errors} errors`);
  console.log('SQLite NOT modified — data safe.');
  await sqlite.close();
  await pg.close();
}

migrate().catch(e => { console.error('FATAL:', e); process.exit(1); });
