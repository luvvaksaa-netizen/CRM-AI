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
 * Model: Store / Akun WhatsApp (Multi-Session)
 */
const Store = sequelize.define('Store', {
  wa_id:            { type: DataTypes.STRING, unique: true },
  name:             { type: DataTypes.STRING,  defaultValue: 'Toko Saya' },
  bot_name:         { type: DataTypes.STRING,  defaultValue: 'CS Bot' },
  system_prompt:    { type: DataTypes.TEXT,    defaultValue: '' },
  product_knowledge:{ type: DataTypes.TEXT,    defaultValue: '' },
  is_bot_active:    { type: DataTypes.BOOLEAN, defaultValue: true },
  last_active:      { type: DataTypes.DATE,    defaultValue: Sequelize.NOW }
});

/**
 * Model: Media Asset — Per-Store dengan Vision AI + Whisper + Purpose Control
 * purpose:
 *   'both'          → AI pelajari + bisa dikirim ke customer
 *   'knowledge_only'→ AI pelajari SAJA, TIDAK dikirim ke customer
 *   'send_only'     → Hanya dikirim ke customer, tidak jadi knowledge AI
 */
const MediaAsset = sequelize.define('MediaAsset', {
  store_wa_id:      { type: DataTypes.STRING,  allowNull: false, defaultValue: 'default' },
  filename:         { type: DataTypes.STRING,  allowNull: false },
  original_name:    { type: DataTypes.STRING  },
  type:             { type: DataTypes.ENUM('image', 'video'), allowNull: false },
  label:            { type: DataTypes.STRING  },
  description:      { type: DataTypes.TEXT   },                    // Deskripsi manual dari user
  ai_analysis:      { type: DataTypes.TEXT,   defaultValue: '' }, // Hasil Vision AI (foto/frame video)
  video_transcript: { type: DataTypes.TEXT,   defaultValue: '' }, // Hasil Whisper (audio video)
  trigger_words:    { type: DataTypes.STRING, defaultValue: '' }, // Keyword otomatis kirim katalog (pisah dengan koma)
  purpose:          {                                              // Tujuan media
    type: DataTypes.ENUM('both', 'knowledge_only', 'send_only'),
    defaultValue: 'both'
  },
  analysis_status:  {                                              // Status analisis latar belakang
    type: DataTypes.ENUM('pending', 'processing', 'done', 'failed'),
    defaultValue: 'pending'
  },
  max_size_kb:      { type: DataTypes.INTEGER, defaultValue: 5120 },
  max_duration_sec: { type: DataTypes.INTEGER, defaultValue: 60  }
});

/**
 * Model: Chat Message (CRM History — Per-Store)
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
 * Initialize & Sync Database (alter: true = auto-migrate safely)
 */
async function initDB() {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true }); // Safe migration: adds new columns without dropping data
    logger.success('✅ Database SQLite & Sequelize Siap (Powerful & Scalable)!');
  } catch (error) {
    logger.error(`Gagal menghubungkan ke Database: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  sequelize,
  Store,
  MediaAsset,
  ChatMessage,
  initDB
};
