/**
 * @file logger.js
 * @description Centralized logging utility for the application.
 */

const logger = {
    info: (message, ...args) => {
        console.log(`[INFO] [${new Date().toLocaleTimeString()}] ${message}`, ...args);
    },
    success: (message, ...args) => {
        console.log(`✅ [${new Date().toLocaleTimeString()}] ${message}`, ...args);
    },
    warn: (message, ...args) => {
        console.warn(`⚠️  [${new Date().toLocaleTimeString()}] ${message}`, ...args);
    },
    error: (message, ...args) => {
        console.error(`❌ [${new Date().toLocaleTimeString()}] ERROR: ${message}`, ...args);
    },
    bot: (message, ...args) => {
        console.log(`🤖 [${new Date().toLocaleTimeString()}] ${message}`, ...args);
    }
};

module.exports = logger;
