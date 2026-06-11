import path from 'path';

// ─── Base Directories ───
// __dirname di dev: backend/src/config/
// __dirname di prod: backend/dist/config/
// Maka ../../ = backend/

const ROOT = path.resolve(__dirname, '../..');
const DATA_DIR = path.resolve(ROOT, 'data');

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
