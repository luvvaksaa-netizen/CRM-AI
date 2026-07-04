import { Sequelize } from "sequelize";
import { getDbPath } from "./paths";
import path from "path";

const USE_PG = false; // Memaksa menggunakan SQLite (mengabaikan environment variable DATABASE_URL yang nyangkut di Windows/PM2)

export const sequelize = USE_PG
  ? new Sequelize(process.env.DATABASE_URL!, {
      dialect: "postgres",
      logging: false,
      pool: {
        max: 10,
        min: 2,
        acquire: 30000,
        idle: 10000,
      },
      dialectOptions: {
        ssl:
          process.env.DATABASE_SSL === "true"
            ? { require: true, rejectUnauthorized: false }
            : false,
      },
    })
  : new Sequelize({
      dialect: "sqlite",
      storage: getDbPath(),
      logging: false,
      dialectOptions: {
        busyTimeout: 120000, // 2 menit — diterapkan ke SEMUA koneksi baru oleh Sequelize
      },
      pool: {
        max: 1,
        min: 1, // 🔧 JANGAN 0 — koneksi harus tetap hidup, PRAGMA persist
        acquire: 60000,
        idle: 300000, // 5 menit idle sebelum disconnect (was 10s)
      },
    });

export const initDB = async () => {
  try {
    await sequelize.authenticate();

    if (!USE_PG) {
      // ─── SQLite PRAGMA — Production Optimized ───
      // Diurutkan dari yang paling kritis

      // 1. Write-Ahead Logging — better concurrent read/write
      await sequelize.query("PRAGMA journal_mode=WAL;");

      // 2. Busy timeout 30 detik — tunggu lock dilepas, jangan langsung error
      await sequelize.query("PRAGMA busy_timeout=120000;"); // 2 menit — tahan SQLITE_BUSY di traffic tinggi

      // 3. NORMAL sync — aman untuk WAL, lebih cepat dari FULL
      await sequelize.query("PRAGMA synchronous=NORMAL;");

      // 4. Cache 32MB — cukup besar untuk query besar, cukup kecil untuk RAM terbatas
      await sequelize.query("PRAGMA cache_size=-32000;");

      // 5. Memory-mapped I/O: 64MB max — cegah SQLite ambil semua RAM
      //    Windows bisa pakai mmap_size tanpa batas kalau tidak di-set
      await sequelize.query("PRAGMA mmap_size=67108864;");

      // 6. Temp storage di MEMORY bukan disk — lebih cepat, kurangi disk I/O
      await sequelize.query("PRAGMA temp_store=MEMORY;");

      // 7. WAL auto-checkpoint setiap 100 halaman — cegah WAL file membengkak
      await sequelize.query("PRAGMA wal_autocheckpoint=100;");

      // 8. Incremental vacuum — kurangi fragmentasi (tapi jangan auto)
      await sequelize.query("PRAGMA auto_vacuum=NONE;");

      // 9. Foreign keys ON — integrity
      await sequelize.query("PRAGMA foreign_keys=ON;");
    }

    const dbLabel = USE_PG
      ? `PostgreSQL (${new URL(process.env.DATABASE_URL!).hostname})`
      : `SQLite (${getDbPath()})`;
    console.log(`[Database] Connected to ${dbLabel}`);

    // JANGAN sync({ force: true }) — akan menghapus semua data produksi!
    await sequelize.sync();
  } catch (error: any) {
    console.error("[Database] Connection failed:", error?.message || error);
    // Jangan throw — biarkan app tetap jalan, error akan muncul di health check
  }
};
