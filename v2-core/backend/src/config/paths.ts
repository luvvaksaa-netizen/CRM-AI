import path from 'path';

// ─── Base Directories ───
// __dirname di dev: backend/src/config/
// __dirname di prod: backend/dist/config/
// Maka ../../ = backend/

const ROOT = path.resolve(__dirname, '../..');

/**
 * DATA_DIR: Path ke folder data (database, uploads, tmp).
 *
 * Priority:
 * 1. ENV DATA_DIR — set ini di .env atau ecosystem.config.js untuk production
 *    agar bisa share database dengan legacy system.
 *    Contoh: DATA_DIR=C:/Users/Lenovo/Documents/CRM-AI/data
 * 2. Default — backend/data/ (untuk local dev)
 */
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(ROOT, 'data');

/**
 * Canonical path to SQLite database.
 * Lokasi: backend/data/database.sqlite
 */
export const getDbPath = (): string => {
  return path.resolve(DATA_DIR, 'database.sqlite');
};

/**
 * Canonical path to uploads directory.
 * Lokasi: backend/data/uploads
 */
export const getUploadsPath = (): string => {
  return path.resolve(DATA_DIR, 'uploads');
};

/**
 * Canonical path to database backups.
 * Lokasi: backend/backups
 */
export const getBackupPath = (): string => {
  return path.resolve(ROOT, 'backups');
};

/**
 * Canonical path to wwebjs auth session storage.
 * Lokasi: backend/.wwebjs_auth
 */
export const getWwebjsAuthPath = (): string => {
  return path.resolve(ROOT, '.wwebjs_auth');
};

/**
 * Canonical path to log files.
 * Lokasi: backend/logs
 */
export const getLogsPath = (): string => {
  return path.resolve(ROOT, 'logs');
};
