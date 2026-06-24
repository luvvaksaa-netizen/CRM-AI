/**
 * migrate_new_columns.js
 * One-time migration script:
 * 1. Tambah kolom `learned_prompt_addon` ke tabel BotAgents
 * 2. Buat tabel `PromptEvolutionLogs` jika belum ada
 */

'use strict';

require('dotenv/config');
const path = require('path');

// Resolve DB path sama seperti yang digunakan app
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'database.sqlite');

console.log('[Migration] Menggunakan database:', DB_PATH);

const { Sequelize, DataTypes } = require('sequelize');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: DB_PATH,
    logging: false
});

async function run() {
    try {
        await sequelize.authenticate();
        console.log('[Migration] ✅ Koneksi DB berhasil.');

        const qi = sequelize.getQueryInterface();

        // 1. Tambah kolom learned_prompt_addon ke BotAgents
        try {
            await qi.addColumn('BotAgents', 'learned_prompt_addon', {
                type: DataTypes.TEXT,
                allowNull: true,
                defaultValue: null
            });
            console.log('[Migration] ✅ Kolom `learned_prompt_addon` berhasil ditambahkan ke BotAgents.');
        } catch (e) {
            if (e.message && e.message.includes('duplicate column')) {
                console.log('[Migration] ℹ️  Kolom `learned_prompt_addon` sudah ada, skip.');
            } else {
                console.error('[Migration] ❌ Gagal tambah kolom learned_prompt_addon:', e.message);
            }
        }

        // 2. Buat tabel PromptEvolutionLogs jika belum ada
        try {
            await qi.createTable('PromptEvolutionLogs', {
                id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
                agent_id: { type: DataTypes.INTEGER, allowNull: true },
                prompt_before: { type: DataTypes.TEXT, allowNull: true },
                prompt_after: { type: DataTypes.TEXT, allowNull: true },
                summary_changes: { type: DataTypes.TEXT, allowNull: true },
                patterns_used: { type: DataTypes.INTEGER, defaultValue: 0 },
                avg_conversation_score: { type: DataTypes.FLOAT, defaultValue: 0 },
                tokens_used: { type: DataTypes.INTEGER, defaultValue: 0 },
                created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
            }, { ifNotExists: true });
            console.log('[Migration] ✅ Tabel `PromptEvolutionLogs` siap.');
        } catch (e) {
            console.error('[Migration] ❌ Gagal buat tabel PromptEvolutionLogs:', e.message);
        }

        console.log('[Migration] 🎉 Migration selesai!');
        process.exit(0);
    } catch (err) {
        console.error('[Migration] FATAL:', err.message);
        process.exit(1);
    }
}

run();
