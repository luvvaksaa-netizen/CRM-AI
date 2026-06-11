import { Sequelize } from 'sequelize';
import { getDbPath } from './paths';
import path from 'path';

const dbPath = getDbPath();

export const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: false,
  // busyTimeout: v2-core akan menunggu hingga 30 detik sebelum menyerah saat DB busy
  dialectOptions: {
    busyTimeout: 30000
  },
  // Pool size 1: SQLite tidak mendukung concurrent write. 1 koneksi = aman.
  pool: {
    max: 1,
    min: 0,
    acquire: 35000,
    idle: 10000
  }
});

export const initDB = async () => {
  try {
    await sequelize.authenticate();
    
    // Set WAL mode agar v2-core tidak mengganggu write dari legacy wa-crm.
    // WAL = Write-Ahead Logging: reader tidak block writer, writer tidak block reader.
    await sequelize.query('PRAGMA journal_mode=WAL;');
    await sequelize.query('PRAGMA busy_timeout=30000;');
    await sequelize.query('PRAGMA synchronous=NORMAL;');
    
    console.log(`[Database] Terhubung ke legacy database di ${dbPath} (WAL mode aktif)`);
    
    // JANGAN sync({ force: true }) — akan menghapus semua data produksi!
    // sync() tanpa force hanya membuat tabel baru jika belum ada, aman.
    await sequelize.sync();
  } catch (error) {
    console.error('[Database] Koneksi gagal:', error);
  }
};

