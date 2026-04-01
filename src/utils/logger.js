const fs = require('fs');
const path = require('path');

/**
 * PRODUCTION-GRADE LOGGER
 * Support colors in terminal and persistent file logging.
 */

const LOG_DIR = path.join(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
};

function writeLog(lvl, msg) {
    const time = new Date().toLocaleString('id-ID');
    fs.appendFileSync(path.join(LOG_DIR, 'app.log'), `[${time}] [${lvl}] ${msg}\n`);
}

const logger = {
    info: (msg) => {
        console.log(`${colors.cyan}[INFO]${colors.reset} ${msg}`);
        writeLog('INFO', msg);
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
