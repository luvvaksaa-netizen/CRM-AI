const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * PRODUCTION-GRADE BACKUP SERVICE
 * Creates daily snapshots of the SQLite database.
 */

const BACKUP_DIR = path.join(process.cwd(), 'backups');
const DB_FILE = path.join(process.cwd(), 'data', 'database.sqlite'); // Sesuai path di DB index

function initBackupService() {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

    // Run backup every 24 hours
    setInterval(() => {
        performBackup();
    }, 24 * 60 * 60 * 1000);

    logger.info('Backup Service diaktifkan (Auto-snapshot setiap 24 jam).');
}

function performBackup() {
    try {
        if (!fs.existsSync(DB_FILE)) return;

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(BACKUP_DIR, `snapshot-${timestamp}.sqlite`);

        fs.copyFileSync(DB_FILE, backupPath);

        // Keep only last 7 backups to save disk space
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.endsWith('.sqlite'))
            .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtime }))
            .sort((a, b) => b.time - a.time);

        if (files.length > 7) {
            files.slice(7).forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f.name)));
        }

        logger.success(`Database Snapshot dibuat: ${path.basename(backupPath)}`);
    } catch (e) {
        logger.error(`Gagal membuat backup database: ${e.message}`);
    }
}

module.exports = { initBackupService, performBackup };
