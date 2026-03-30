/**
 * @file settings_service.js
 * @description Manages dynamic AI prompt and product knowledge settings.
 * Persists data to settings.json.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { AI } = require('../constants');

const SETTINGS_FILE = path.join(process.cwd(), 'settings.json');

// Default initial settings
const DEFAULT_SETTINGS = {
    systemPrompt: AI.SYSTEM_PROMPT,
    productKnowledge: "Kami menyediakan layanan konsultasi dan produk custom berkualitas tinggi.",
    fileAssets: [] // List of { name: 'file.jpg', type: 'image', size: 1024, path: '/uploads/file.jpg' }
};

/**
 * Loads current settings from settings.json. Falls back to defaults.
 * @returns {object} Settings object.
 */
function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
            const parsed = JSON.parse(data);
            return { ...DEFAULT_SETTINGS, ...parsed };
        }
    } catch (e) {
        logger.error(`Gagal memuat settings.json: ${e.message}`);
    }
    return { ...DEFAULT_SETTINGS };
}

/**
 * Saves settings to settings.json.
 * @param {object} newSettings 
 * @returns {boolean} Success status.
 */
function saveSettings(newSettings) {
    try {
        const currentData = loadSettings();
        const updatedData = { ...currentData, ...newSettings };
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updatedData, null, 2), 'utf8');
        logger.success("Pengaturan berhasil disimpan.");
        return true;
    } catch (e) {
        logger.error(`Gagal menyimpan settings.json: ${e.message}`);
        return false;
    }
}

let activeSettings = loadSettings();

module.exports = {
    getSettings: () => activeSettings,
    updateSettings: (newSettings) => {
        const success = saveSettings(newSettings);
        if (success) activeSettings = { ...activeSettings, ...newSettings };
        return success;
    },
    addFileAsset: (fileInfo) => {
        activeSettings.fileAssets.push(fileInfo);
        saveSettings({ fileAssets: activeSettings.fileAssets });
    },
    removeFileAsset: (fileName) => {
        activeSettings.fileAssets = activeSettings.fileAssets.filter(f => f.name !== fileName);
        saveSettings({ fileAssets: activeSettings.fileAssets });
    }
};
