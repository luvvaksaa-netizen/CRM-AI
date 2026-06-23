/**
 * dbRetry — Retry Sequelize operations on SQLITE_BUSY.
 * SQLite WAL mode mengurangi BUSY, tapi tidak 100% menghilangkan.
 * Helper ini memastikan operasi DB kritis tidak gagal diam-diam.
 *
 * Usage:
 *   const record = await dbRetry(() => ChatSummary.findOrCreate({...}));
 */

const logger = require('./logger');

async function dbRetry(fn, options = {}) {
    const {
        maxRetries = 3,
        baseDelay = 200,
        context = 'dbRetry',
    } = options;

    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            const isBusy = err?.message?.includes('SQLITE_BUSY') ||
                          err?.parent?.message?.includes('SQLITE_BUSY');

            if (isBusy && attempt < maxRetries) {
                const delay = baseDelay * Math.pow(2, attempt); // 200, 400, 800
                logger.warn(`[${context}] SQLITE_BUSY retry ${attempt + 1}/${maxRetries} (delay ${delay}ms)`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }

            // Non-BUSY error or max retries reached — throw/rethrow based on config
            if (attempt >= maxRetries) {
                logger.error(`[${context}] Gagal setelah ${maxRetries} retry: ${err.message}`);
            }
            throw err;
        }
    }
    throw lastError;
}

// Async wrapper for legacy callbacks: dbRetry(() => somePromise)
// Also works: dbRetry(async () => { ... })

module.exports = { dbRetry };
