import { Sequelize } from 'sequelize';
import { getDbPath } from './paths';
import path from 'path';

const dbPath = getDbPath();

export const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: false,
  dialectOptions: {
    // busyTimeout: tunggu hingga 30 detik saat DB busy (dalam milidetik)
    busyTimeout: 30000
  },
  // Pool 3: WAL mode mendukung concurrent reads + 1 writer.
  // max:1 menyebabkan reads antri di belakang writes (SQLITE_BUSY).
  pool: {
    max: 3,
    min: 0,
    acquire: 35000,
    idle: 10000
  }
});

export const initDB = async () => {
  try {
    await sequelize.authenticate();
    
    // Set WAL mode agar reads tidak block writes dan sebaliknya
    await sequelize.query('PRAGMA journal_mode=WAL;');
    await sequelize.query('PRAGMA busy_timeout=30000;');
    await sequelize.query('PRAGMA synchronous=NORMAL;');
    await sequelize.query('PRAGMA cache_size=-16000;'); // 16MB cache
    await sequelize.query('PRAGMA wal_autocheckpoint=100;'); // Checkpoint tiap 100 page
    
    console.log(`[Database] Terhubung ke legacy database di ${dbPath} (WAL mode aktif)`);

    // Explicit periodic WAL checkpoint to prevent file bloat (SQLITE_BUSY mitigation)
    setInterval(async () => {
      try {
        await sequelize.query('PRAGMA wal_checkpoint(TRUNCATE);');
      } catch (e: any) {
        console.error('[Database] Periodic WAL Checkpoint failed:', e.message);
      }
    }, 5 * 60 * 1000); // 5 minutes

    
    // JANGAN sync({ force: true }) — akan menghapus semua data produksi!
    // sync() tanpa force hanya membuat tabel baru jika belum ada, aman.
    await sequelize.sync();
  } catch (error) {
    console.error('[Database] Koneksi gagal:', error);
  }
};

