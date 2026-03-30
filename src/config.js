/**
 * @file config.js
 * @description Loads and validates environment variables.
 */

const dotenv = require('dotenv');
const logger = require('./utils/logger');

// Load environment variables from .env
const result = dotenv.config();

if (result.error) {
    logger.warn("Peringatan: File .env tidak ditemukan. Pastikan sudah ada.");
}

const config = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    RAJAONGKIR_API_KEY: process.env.RAJAONGKIR_API_KEY,
    KOMERCE_BASE_URL: 'https://rajaongkir.komerce.id/api/v1', 
    CLIENT_NAME: process.env.CLIENT_NAME || 'WA-AI-CS-Bot',
    MODEL_NAME: process.env.MODEL_NAME || 'gpt-4o-mini',
    ORIGIN_NAME: 'Kediri' // Asal pengiriman default
};

// Simple validation to ensure the bot can run
const validateConfig = () => {
    if (!config.OPENAI_API_KEY) {
        logger.error("OPENAI_API_KEY is missing in your .env file!");
        return false;
    }
    if (!config.RAJAONGKIR_API_KEY) {
        logger.warn("RAJAONGKIR_API_KEY is missing! Fitur cek ongkir tidak akan aktif.");
        logger.info("Silakan daftar di https://komerce.id/ untuk mendapatkan Collaborator API Key.");
    } else {
        logger.info(`Shipping Engine: Menggunakan Komerce Collaborator API [${config.KOMERCE_BASE_URL}]`);
    }
    return true;
};

module.exports = {
    ...config,
    validateConfig
};
