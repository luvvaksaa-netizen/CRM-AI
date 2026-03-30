/**
 * @file history_service.js
 * @description Manages chat history window for each session.
 * Uses lowdb for consistent file-based persistence (Best Practice).
 */

const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const logger = require('../utils/logger');

const adapter = new FileSync(path.join(process.cwd(), 'chat_history.json'));
const db = low(adapter);

// Setup default state
db.defaults({ sessions: {} }).write();

/**
 * Gets conversation history for a specific phone number.
 * Returns only the last N messages (default 10) to stay within token limits.
 * @param {string} phone 
 * @param {number} limit 
 * @returns {Array} Array of { role, content }
 */
function getHistory(phone, limit = 10) {
    try {
        const sessionPath = `sessions.${phone.replace(/\./g, '_')}`;
        const history = db.get(sessionPath).value() || [];
        return history.slice(-limit);
    } catch (e) {
        logger.error(`Gagal mendapatkan riwayat chat ${phone}: ${e.message}`);
        return [];
    }
}

/**
 * Adds a message to the history for a phone number.
 * @param {string} phone 
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content 
 */
function addMessage(phone, role, content) {
    try {
        const sessionId = phone.replace(/\./g, '_');
        const sessionPath = `sessions.${sessionId}`;
        
        let history = db.get(sessionPath).value() || [];
        
        // Push new message
        history.push({ role, content, timestamp: Date.now() });
        
        // Keep window limit (last 20 messages for internal buffer)
        if (history.length > 20) history = history.slice(-20);
        
        db.set(sessionPath, history).write();
    } catch (e) {
        logger.error(`Gagal menyimpan pesan ke riwayat chat ${phone}: ${e.message}`);
    }
}

/**
 * Resets history for a phone number.
 * @param {string} phone 
 */
function clearHistory(phone) {
    try {
        db.set(`sessions.${phone.replace(/\./g, '_')}`, []).write();
    } catch (e) {
        logger.error(`Gagal menghapus riwayat chat ${phone}`);
    }
}

module.exports = {
    getHistory,
    addMessage,
    clearHistory
};
