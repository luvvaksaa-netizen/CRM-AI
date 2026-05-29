/**
 * @file config.js
 * @description Loads and validates environment variables.
 *
 * DATA_DIR Strategy (VPS-Ready Architecture):
 *   - Local Dev      : DATA_DIR tidak di-set → defaults ke ./data/
 *   - Docker/Railway : DATA_DIR = /usr/src/app/.wwebjs_auth (set di Dockerfile)
 *   - VPS            : DATA_DIR = /var/data/crm (set di systemd/env)
 */

const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const logger = require('./utils/logger');

// Load .env (hanya relevan di local dev)
const result = dotenv.config();

// Hanya tampilkan warning di development agar log Railway tetap bersih
if (result.error && process.env.NODE_ENV !== 'production') {
    logger.warn('Peringatan: File .env tidak ditemukan (normal di production server).');
}

// ============================================================
// DATA DIRECTORY — Pusat semua data persisten
// ============================================================
const DATA_DIR = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(process.cwd(), 'data'); // Local default: ./data/

const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const TMP_DIR = path.join(DATA_DIR, 'tmp');

// Auto-create folders saat startup (aman dan idempotent)
[DATA_DIR, UPLOADS_DIR, TMP_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

const config = {
    // Session & Security
    SESSION_SECRET:     process.env.SESSION_SECRET || '',
    DASHBOARD_ALLOWED_ORIGINS: process.env.DASHBOARD_ALLOWED_ORIGINS
        ? process.env.DASHBOARD_ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
        : ['http://localhost:3001', 'http://127.0.0.1:3001'],

    // AI & Shipping
    OPENAI_API_KEY:     process.env.OPENAI_API_KEY,
    GROQ_API_KEYS:      process.env.GROQ_API_KEYS ? process.env.GROQ_API_KEYS.split(',').map(k => k.trim()).filter(k => k) : [],
    GROQ_MODEL_TEXT:    process.env.GROQ_MODEL_TEXT || 'llama-3.3-70b-versatile',
    GROQ_MODEL_AUDIO:   process.env.GROQ_MODEL_AUDIO || 'whisper-large-v3',
    RAJAONGKIR_API_KEY: process.env.RAJAONGKIR_API_KEY,
    KOMERCE_BASE_URL:   'https://rajaongkir.komerce.id/api/v1',
    CLIENT_NAME:        process.env.CLIENT_NAME || 'WA-AI-CS-Bot',
    MODEL_NAME:         process.env.MODEL_NAME  || 'gpt-4o-mini',
    ORIGIN_NAME:        process.env.ORIGIN_NAME || 'Kediri',

    // Paths (Terpusat)
    DATA_DIR,
    UPLOADS_DIR,
    TMP_DIR,

    // Admin Credentials
    ADMIN_USER: process.env.ADMIN_USER || 'admin',
    ADMIN_PASS: process.env.ADMIN_PASS || 'admin123'
};

const validateConfig = () => {
    // Validasi AI keys
    if (!config.OPENAI_API_KEY && config.GROQ_API_KEYS.length === 0) {
        logger.error('CRITICAL: Harus menyediakan setidaknya OPENAI_API_KEY atau GROQ_API_KEYS di .env!');
        return false;
    }

    // Validasi SESSION_SECRET di production
    const isProduction = process.env.NODE_ENV === 'production';
    const defaultSecret = 'rekapoin-crm-xyz-secret-2025';
    if (isProduction && (!config.SESSION_SECRET || config.SESSION_SECRET === defaultSecret)) {
        logger.error('CRITICAL: SESSION_SECRET wajib di-set di production! Jangan gunakan default. Server tidak akan start.');
        return false;
    }
    if (!isProduction && !config.SESSION_SECRET) {
        logger.warn('[Security] SESSION_SECRET tidak di-set. Menggunakan fallback development. JANGAN gunakan ini di production!');
    }

    return true;
};

module.exports = { ...config, validateConfig };
