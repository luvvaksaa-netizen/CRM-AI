import { Sequelize } from 'sequelize';
import { getDbPath } from './paths';
import path from 'path';

const USE_PG = false; // Memaksa menggunakan SQLite (mengabaikan environment variable DATABASE_URL yang nyangkut di Windows/PM2)

export const sequelize = USE_PG
  ? new Sequelize(process.env.DATABASE_URL!, {
      dialect: 'postgres',
      logging: false,
      pool: {
        max: 10,
        min: 2,
        acquire: 30000,
        idle: 10000,
      },
      dialectOptions: {
        ssl: process.env.DATABASE_SSL === 'true' ? { require: true, rejectUnauthorized: false } : false,
      },
    })
  : new Sequelize({
      dialect: 'sqlite',
      storage: getDbPath(),
      logging: false,
      dialectOptions: {
        busyTimeout: 30000,
      },
      pool: {
        max: 1,
        min: 0,
        acquire: 60000,
        idle: 10000,
      },
    });

export const initDB = async () => {
  try {
    await sequelize.authenticate();

    if (!USE_PG) {
      // SQLite-specific PRAGMA — only for SQLite
      await sequelize.query('PRAGMA journal_mode=WAL;');
      await sequelize.query('PRAGMA busy_timeout=30000;');
      await sequelize.query('PRAGMA synchronous=NORMAL;');
      await sequelize.query('PRAGMA cache_size=-16000;');
      await sequelize.query('PRAGMA wal_autocheckpoint=100;');
    }

    const dbLabel = USE_PG ? `PostgreSQL (${new URL(process.env.DATABASE_URL!).hostname})` : `SQLite (${getDbPath()})`;
    console.log(`[Database] Terhubung ke ${dbLabel}`);

    // JANGAN sync({ force: true }) — akan menghapus semua data produksi!
    await sequelize.sync();
  } catch (error) {
    console.error('[Database] Koneksi gagal:', error);
  }
};
