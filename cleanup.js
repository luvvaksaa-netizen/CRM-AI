/**
 * @file cleanup.js
 * @description Forcefully kills any leftover Chrome/Chromium processes.
 * Useful for resolving the "The browser is already running" error.
 */

const { exec } = require('child_process');
const logger = require('./src/utils/logger');

function killChrome() {
    logger.warn('Mencoba mematikan proses Chrome/Chromium yang menggantung...');
    
    // Windows command to kill processes based on image name
    const cmd = 'taskkill /F /IM chrome.exe /T /FI "STATUS eq RUNNING"';
    
    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            logger.info('Pesan: Tidak ada proses Chrome yang ditemukan atau gagal dimatikan secara paksa.');
            return;
        }
        logger.success('Proses Chrome berhasil dibersihkan.');
        console.log(stdout);
    });
}

killChrome();
