const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
const logger = require('../utils/logger');
const { DATA_DIR } = require('../config');

// SQLite disimpan di DATA_DIR agar persisten di Volume Railway/Docker
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(DATA_DIR, 'database.sqlite'),
  logging: false
});

/**
 * Model: Bot Agent (Otak AI - Multi Tenant)
 * Berisi konfigurasi prompt & knowledge. 1 Agent bisa dipakai banyak Store (Nomor WA).
 */
const BotAgent = sequelize.define('BotAgent', {
  id:               { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name:             { type: DataTypes.STRING,  allowNull: true }, // Lenient for sync
  bot_name:         { type: DataTypes.STRING,  defaultValue: 'CS Bot' },
  system_prompt:    { type: DataTypes.TEXT,    defaultValue: '' },
  product_knowledge:{ type: DataTypes.TEXT,    defaultValue: '' }
});

/**
 * Model: Store / Akun WhatsApp (Device/Perangkat)
 */
const Store = sequelize.define('Store', {
  wa_id:            { type: DataTypes.STRING, unique: true },
  name:             { type: DataTypes.STRING,  defaultValue: 'Perangkat Baru' },
  agent_id:         { type: DataTypes.INTEGER, allowNull: true },
  is_bot_active:    { type: DataTypes.BOOLEAN, defaultValue: true },
  last_active:      { type: DataTypes.DATE,    defaultValue: Sequelize.NOW },
  
  // Legacy columns 
  bot_name:         { type: DataTypes.STRING },
  system_prompt:    { type: DataTypes.TEXT },
  product_knowledge:{ type: DataTypes.TEXT }
});

// Relasi Agent -> Store (1 to Many)
BotAgent.hasMany(Store, { foreignKey: 'agent_id' });
Store.belongsTo(BotAgent, { foreignKey: 'agent_id' });

/**
 * Model: Media Asset
 */
const MediaAsset = sequelize.define('MediaAsset', {
  agent_id:         { type: DataTypes.INTEGER, allowNull: true },
  store_wa_id:      { type: DataTypes.STRING,  allowNull: true },
  filename:         { type: DataTypes.STRING,  allowNull: true }, // Lenient for sync
  original_name:    { type: DataTypes.STRING  },
  type:             { type: DataTypes.ENUM('image', 'video'), allowNull: true }, // Lenient
  label:            { type: DataTypes.STRING  },
  description:      { type: DataTypes.TEXT   },
  ai_analysis:      { type: DataTypes.TEXT,   defaultValue: '' },
  video_transcript: { type: DataTypes.TEXT,   defaultValue: '' },
  trigger_words:    { type: DataTypes.STRING, defaultValue: '' },
  purpose:          { type: DataTypes.ENUM('both', 'knowledge_only', 'send_only'), defaultValue: 'both' },
  analysis_status:  { type: DataTypes.ENUM('pending', 'processing', 'done', 'failed'), defaultValue: 'pending' },
});

// Relasi Agent -> Media (1 to Many)
BotAgent.hasMany(MediaAsset, { foreignKey: 'agent_id' });
MediaAsset.belongsTo(BotAgent, { foreignKey: 'agent_id' });

/**
 * Model: Chat Message (CRM History — Tetap Per-Store/Device untuk privasi nomor)
 */
const ChatMessage = sequelize.define('ChatMessage', {
  store_wa_id: { type: DataTypes.STRING, allowNull: false },
  contact_id:  { type: DataTypes.STRING, allowNull: false },
  sender_name: { type: DataTypes.STRING },
  body:        { type: DataTypes.TEXT },
  type:        { type: DataTypes.STRING,  defaultValue: 'chat' },
  is_from_me:  { type: DataTypes.BOOLEAN, defaultValue: false },
  timestamp:   { type: DataTypes.DATE,    defaultValue: Sequelize.NOW }
});

/**
 * Model: Chat Summary (Rekap Pembahasan per Customer)
 */
const ChatSummary = sequelize.define('ChatSummary', {
  store_wa_id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  contact_id:  { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  contact_name:{ type: DataTypes.STRING, defaultValue: '' },
  summary:     { type: DataTypes.TEXT,   defaultValue: 'Belum ada rekapan.' },
  last_updated:{ type: DataTypes.DATE,   defaultValue: Sequelize.NOW }
});


/**
 * Initialize & Sync Database (alter: true = auto-migrate safely)
 */
async function migrateLegacyData() {
  const stores = await Store.findAll();
  for (const store of stores) {
    if (store.bot_name && store.system_prompt && !store.agent_id) {
      try {
        // Buat Agent baru dari data toko lama
        const agent = await BotAgent.create({
          name: `Agen ${store.name || store.wa_id}`,
          bot_name: store.bot_name || 'AI Assistant',
          system_prompt: store.system_prompt,
          product_knowledge: store.product_knowledge || ''
        });
        console.log(`[DB] Migrated Legacy Store [${store.wa_id}] to New Agent [${agent.id}]`);
        
        // Update Store
        store.agent_id = agent.id;
        // Kosongkan legacy agar tidak termigrasi dua kali
        store.system_prompt = null; 
        store.product_knowledge = null;
        await store.save();

        // Pindahkan kepemilikan media
        await MediaAsset.update({ agent_id: agent.id }, { where: { store_wa_id: store.wa_id } });
      } catch (e) {
        logger.error(`[DB] Migration failed for ${store.wa_id}: ${e.message}`);
        if (e.errors) e.errors.forEach(err => console.log(` - ${err.path}: ${err.message}`));
      }
    }
  }
}

/**
 * Menambal nama kontak yang kosong pada rekap lama (Backfill)
 * Diambil dari sender_name terbaru di riwayat chat.
 */
async function backfillSummaryNames() {
  try {
    const list = await ChatSummary.findAll({ where: { contact_name: '' } });
    if (list.length === 0) return;

    logger.info(`[DB] Menambal ${list.length} nama kontak pada rekap lama...`);
    for (const record of list) {
        const latestMsg = await ChatMessage.findOne({
            where: { store_wa_id: record.store_wa_id, contact_id: record.contact_id },
            order: [['timestamp', 'DESC']]
        });
        if (latestMsg && latestMsg.sender_name) {
            record.contact_name = latestMsg.sender_name;
            await record.save();
        }
    }
  } catch (e) {
    logger.warn(`[DB] Gagal backfill summary names: ${e.message}`);
  }
}

async function initDB() {
  const queryInterface = sequelize.getQueryInterface();
  
  async function safeAddColumn(table, column, definition) {
    try {
      const info = await queryInterface.describeTable(table);
      if (!info[column]) {
        await queryInterface.addColumn(table, column, definition);
        logger.info(`[DB] Berhasil tambah kolom [${column}] ke [${table}]`);
      }
    } catch (e) {
      // Ignored if table doesn't exist yet (sync will create it)
    }
  }

  try {
    await sequelize.authenticate();
    
    // 1. Sync Standard (Hanya buat tabel jika belum ada)
    await sequelize.sync(); 

    // 2. Manual Alter (Untuk SQLite lebih aman daripada sync alter true)
    await safeAddColumn('Stores', 'agent_id', { type: DataTypes.INTEGER, allowNull: true });
    await safeAddColumn('MediaAssets', 'agent_id', { type: DataTypes.INTEGER, allowNull: true });
    await safeAddColumn('ChatSummaries', 'contact_name', { type: DataTypes.STRING, defaultValue: '' });

    // 3. Jalankan Migrasi Data
    await migrateLegacyData(); 
    await backfillSummaryNames();
    logger.success('✅ Database SQLite (Agent-Based Architecture) Siap!');
  } catch (error) {
    logger.error(`Gagal menghubungkan ke Database: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  sequelize,
  BotAgent,
  Store,
  MediaAsset,
  ChatMessage,
  ChatSummary,
  initDB
};
