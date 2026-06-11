const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { UPLOADS_DIR, TMP_DIR } = require('../config');

const DEFAULT_MAX_AGE_MS = Number(process.env.TEMP_CLEANUP_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000); // 7 Hari
const TEMP_FILE_PREFIXES = ['customer_', 'voice_'];
const TEMP_DIR_PREFIXES = ['wa-frames-'];

function isOlderThan(stats, maxAgeMs) {
  return Date.now() - stats.mtimeMs > maxAgeMs;
}

function removeOldTempFiles(maxAgeMs = DEFAULT_MAX_AGE_MS) {
  let removed = 0;
  if (!fs.existsSync(UPLOADS_DIR)) return removed;

  for (const name of fs.readdirSync(UPLOADS_DIR)) {
    if (!TEMP_FILE_PREFIXES.some(prefix => name.startsWith(prefix))) continue;

    const filePath = path.join(UPLOADS_DIR, name);
    try {
      const stats = fs.statSync(filePath);
      if (stats.isFile() && isOlderThan(stats, maxAgeMs)) {
        fs.rmSync(filePath, { force: true });
        removed++;
      }
    } catch (_) {
      // Ignore files that disappear between readdir/stat/rm.
    }
  }

  return removed;
}

function removeOldTempDirs(maxAgeMs = DEFAULT_MAX_AGE_MS) {
  let removed = 0;
  if (!fs.existsSync(TMP_DIR)) return removed;

  for (const name of fs.readdirSync(TMP_DIR)) {
    if (!TEMP_DIR_PREFIXES.some(prefix => name.startsWith(prefix))) continue;

    const dirPath = path.join(TMP_DIR, name);
    try {
      const stats = fs.statSync(dirPath);
      if (stats.isDirectory() && isOlderThan(stats, maxAgeMs)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        removed++;
      }
    } catch (_) {
      // Ignore dirs that disappear between readdir/stat/rm.
    }
  }

  return removed;
}

function runStartupTempCleanup() {
  try {
    const files = removeOldTempFiles();
    const dirs = removeOldTempDirs();
    if (files || dirs) {
      logger.info(`[TempCleanup] Membersihkan ${files} file dan ${dirs} folder sementara lama.`);
    }
  } catch (error) {
    logger.warn(`[TempCleanup] Gagal cleanup startup: ${error.message}`);
  }
}

module.exports = {
  runStartupTempCleanup,
  removeOldTempFiles,
  removeOldTempDirs
};
