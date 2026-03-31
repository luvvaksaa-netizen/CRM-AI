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

// Auto-create folders saat startup (aman dan idempotent)
[DATA_DIR, UPLOADS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

const config = {
    // AI & Shipping
    OPENAI_API_KEY:     process.env.OPENAI_API_KEY,
    RAJAONGKIR_API_KEY: process.env.RAJAONGKIR_API_KEY,
    KOMERCE_BASE_URL:   'https://rajaongkir.komerce.id/api/v1',
    CLIENT_NAME:        process.env.CLIENT_NAME || 'WA-AI-CS-Bot',
    MODEL_NAME:         process.env.MODEL_NAME  || 'gpt-4o-mini',
    ORIGIN_NAME:        process.env.ORIGIN_NAME || 'Kediri',

    // Paths (Terpusat — gunakan di seluruh proyek, jangan hardcode lagi)
    DATA_DIR,
    UPLOADS_DIR,
};

const validateConfig = () => {
    if (!config.OPENAI_API_KEY) {
        logger.error('OPENAI_API_KEY tidak ditemukan! Bot AI tidak akan berfungsi.');
        return false;
    }
    if (!config.RAJAONGKIR_API_KEY) {
        logger.warn('RAJAONGKIR_API_KEY tidak ada. Fitur cek ongkir dinonaktifkan.');
    } else {
        logger.info(`Shipping Engine: Komerce API [${config.KOMERCE_BASE_URL}]`);
    }
    return true;
};

module.exports = { ...config, validateConfig };
