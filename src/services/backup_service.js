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

function performBackup(force = false) {
    try {
        if (!fs.existsSync(DB_FILE)) return;

        const dateStr = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
        const existingBackups = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith(`snapshot-${dateStr}`));

        // Jika hari ini sudah ada backup & tidak dipaksa (force), lewati.
        if (existingBackups.length > 0 && !force) {
            return;
        }

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

        rotateLogs(); // Tambahkan pembersihan LOG
        logger.success(`Database Snapshot dibuat: ${path.basename(backupPath)}`);
    } catch (e) {
        logger.error(`Gagal membuat backup database: ${e.message}`);
    }
}

/**
 * Mencegah file log membengkak (Log Rotation)
 */
function rotateLogs() {
    const logPath = path.join(process.cwd(), 'logs', 'app.log');
    if (!fs.existsSync(logPath)) return;

    try {
        const stats = fs.statSync(logPath);
        const maxSize = 8 * 1024 * 1024; // 8MB

        if (stats.size > maxSize) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            fs.copyFileSync(logPath, path.join(process.cwd(), 'logs', `app-${timestamp}.log`));
            fs.writeFileSync(logPath, `[Log Rotated ${timestamp}]\n`);
            
            // Hapus log lama (Hanya simpan 3 file log terakhir)
            const logFiles = fs.readdirSync(path.join(process.cwd(), 'logs'))
                .filter(f => f.startsWith('app-') && f.endsWith('.log'))
                .map(f => ({ name: f, time: fs.statSync(path.join(process.cwd(), 'logs', f)).mtime }))
                .sort((a,b) => b.time - a.time);

            if (logFiles.length > 3) {
                logFiles.slice(3).forEach(f => fs.unlinkSync(path.join(process.cwd(), 'logs', f.name)));
            }
        }
    } catch (e) {}
}

module.exports = { initBackupService, performBackup };
