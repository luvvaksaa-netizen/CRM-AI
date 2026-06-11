const fs = require('fs');
const path = require('path');

/**
 * PRODUCTION-GRADE LOGGER
 * Support colors in terminal and persistent file logging.
 */

const LOG_DIR = path.join(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, 'app.log');
const MAX_LOG_SIZE_BYTES = Number(process.env.LOG_MAX_SIZE_MB || 5) * 1024 * 1024;
const MAX_LOG_FILES = Number(process.env.LOG_MAX_FILES || 5);

const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
};

function rotateLogIfNeeded() {
    try {
        if (!fs.existsSync(LOG_FILE)) return;
        const stats = fs.statSync(LOG_FILE);
        if (stats.size < MAX_LOG_SIZE_BYTES) return;

        for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
            const src = `${LOG_FILE}.${i}`;
            const dest = `${LOG_FILE}.${i + 1}`;
            if (fs.existsSync(src)) {
                if (i + 1 > MAX_LOG_FILES) fs.rmSync(src, { force: true });
                else fs.renameSync(src, dest);
            }
        }

        fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
    } catch (_) {
        // Logging must never crash application flow.
    }
}

function writeLog(lvl, msg) {
    const time = new Date().toLocaleString('id-ID');
    rotateLogIfNeeded();
    fs.appendFileSync(LOG_FILE, `[${time}] [${lvl}] ${msg}\n`);
}

const logger = {
    info: (msg) => {
        console.log(`${colors.cyan}[INFO]${colors.reset} ${msg}`);
        writeLog('INFO', msg);
    },
    debug: (msg) => {
        // Debug: tampil di console saat development, tidak ditulis ke file di production
        if (process.env.NODE_ENV !== 'production') {
            console.log(`${colors.cyan}[DEBUG]${colors.reset} ${msg}`);
        }
    },
    success: (msg) => {
        console.log(`${colors.green}[SUCCESS]${colors.reset} ${msg}`);
        writeLog('SUCCESS', msg);
    },
    warn: (msg) => {
        console.log(`${colors.yellow}[WARN]${colors.reset} ${msg}`);
        writeLog('WARN', msg);
    },
    error: (msg) => {
        console.error(`${colors.red}[ERROR]${colors.reset} ${msg}`);
        writeLog('ERROR', msg);
    },
    bot: (msg) => {
        console.log(`${colors.magenta}🤖 [BOT]${colors.reset} ${msg}`);
        writeLog('BOT', msg);
    }
};

module.exports = logger;
