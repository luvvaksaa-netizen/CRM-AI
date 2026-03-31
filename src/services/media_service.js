/**
 * @file media_service.js
 * @description Service manajemen media dengan analisis cerdas per-toko.
 * Mendukung:
 *  - Foto: Vision AI analisis otomatis
 *  - Video: Whisper (narasi) + Frame Vision (visual) analisis otomatis
 *  - Purpose control: 'both' | 'knowledge_only' | 'send_only'
 */

const { MediaAsset } = require('../database/index');
const { analyzeImage, isImageSupportedByVision } = require('./vision_service');
const { analyzeVideo } = require('./video_analysis_service');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');

// ============================================================
// READ OPERATIONS
// ============================================================

/**
 * Ambil semua media milik toko tertentu.
 * @param {string} storeWaId
 */
async function getMediaByStore(storeWaId) {
  return MediaAsset.findAll({
    where: { store_wa_id: storeWaId },
    order: [['createdAt', 'DESC']]
  });
}

/**
 * Ambil media yang tersedia untuk DIKIRIM ke customer (purpose: both | send_only).
 * Digunakan oleh AI saat memilih media untuk dikirim.
 * @param {string} storeWaId
 */
async function getSendableMedia(storeWaId) {
  const { Op } = require('sequelize');
  return MediaAsset.findAll({
    where: {
      store_wa_id: storeWaId,
      purpose: { [Op.in]: ['both', 'send_only'] }
    },
    order: [['createdAt', 'DESC']]
  });
}

/**
 * Ambil media yang memberikan KNOWLEDGE ke AI (purpose: both | knowledge_only).
 * Digunakan oleh AI saat membangun system prompt.
 * @param {string} storeWaId
 */
async function getKnowledgeMedia(storeWaId) {
  const { Op } = require('sequelize');
  return MediaAsset.findAll({
    where: {
      store_wa_id: storeWaId,
      purpose: { [Op.in]: ['both', 'knowledge_only'] }
    },
    order: [['createdAt', 'DESC']]
  });
}

/**
 * Cari media yang bisa dikirim berdasarkan keyword (untuk tool calling AI).
 * @param {string} storeWaId
 * @param {string} keyword
 */
async function findSendableMediaByKeyword(storeWaId, keyword) {
  const sendable = await getSendableMedia(storeWaId);
  return sendable.find(a => {
    const searchTarget = `${a.label} ${a.description} ${a.ai_analysis} ${a.video_transcript}`.toLowerCase();
    return searchTarget.includes(keyword.toLowerCase());
  });
}

// ============================================================
// WRITE OPERATIONS
// ============================================================

/**
 * Registrasi media baru + jalankan analisis AI di latar belakang.
 * Foto   → Vision AI (analisis visual otomatis)
 * Video  → Whisper (transkripsi narasi) + Frame Vision (analisis visual)
 *
 * @param {object} data - Data media + filePath untuk analisis
 * @param {Function} onAnalysisDone - Callback saat analisis selesai (opsional)
 */
async function registerMedia(data, onAnalysisDone = null) {
  // Buat record terlebih dahulu dengan status 'pending'
  const asset = await MediaAsset.create({
    store_wa_id:   data.store_wa_id,
    filename:      data.filename,
    original_name: data.original_name,
    type:          data.type,
    label:         data.label || data.original_name,
    description:   data.description || '',
    purpose:       data.purpose || 'both',
    analysis_status: 'pending',
    ai_analysis:   '',
    video_transcript: '',
    max_size_kb:      data.type === 'image' ? 5120 : 16384,
    max_duration_sec: data.type === 'video' ? 60 : null
  });

  logger.success(`[Media] "${asset.label}" (${data.type}) terdaftar untuk toko [${data.store_wa_id}]. Analisis dimulai...`);

  // Jalankan analisis di latar belakang (non-blocking)
  _runAnalysisInBackground(asset, data.filePath, onAnalysisDone);

  return asset;
}

/**
 * Proses analisis AI di latar belakang (non-blocking) dengan Konteks Toko.
 * @private
 */
async function _runAnalysisInBackground(asset, filePath, onAnalysisDone) {
  try {
    await asset.update({ analysis_status: 'processing' });

    // AMBIL KONTEKS TOKO (Nama & Knowledge) dari Database
    const { Store } = require('../database/index');
    const store = await Store.findOne({ where: { wa_id: asset.store_wa_id } });
    
    // Bangun string konteks untuk memandu AI agar tidak "ngawur"
    const storeContext = store 
      ? `Nama Toko: ${store.name}\nPengetahuan Produk: ${store.product_knowledge}`
      : "Identifikasi gambar produk secara umum.";

    let aiAnalysis = '';
    let videoTranscript = '';

    if (asset.type === 'image') {
      // === FOTO: Vision AI (Context-Aware) ===
      if (isImageSupportedByVision(asset.filename)) {
        logger.info(`[Vision] Menganalisis foto dengan konteks: "${store?.name || 'Unknown'}"`);
        aiAnalysis = await analyzeImage(filePath, storeContext);
      }
    } else if (asset.type === 'video') {
      // === VIDEO: Whisper + Frame Vision (Context-Aware) ===
      logger.info(`[VideoAnalysis] Menganalisis video dengan konteks: "${store?.name || 'Unknown'}"`);
      const { transcript, visualAnalysis } = await analyzeVideo(filePath, asset.label, storeContext);
      videoTranscript = transcript;
      aiAnalysis = visualAnalysis;
    }

    await asset.update({
      ai_analysis:      aiAnalysis,
      video_transcript: videoTranscript,
      analysis_status:  'done'
    });

    logger.success(`[Media] Analisis kontekstual selesai: "${asset.label}"`);

    // Panggil callback jika ada (untuk emit socket event)
    if (onAnalysisDone) onAnalysisDone(asset);

  } catch (err) {
    logger.error(`[Media] Analisis gagal untuk "${asset.label}": ${err.message}`);
    await asset.update({ analysis_status: 'failed' });
  }
}

/**
 * Update tujuan (purpose) sebuah media.
 * @param {number} id
 * @param {string} storeWaId - Verifikasi kepemilikan
 * @param {string} purpose   - 'both' | 'knowledge_only' | 'send_only'
 */
async function updateMediaPurpose(id, storeWaId, purpose) {
  const asset = await MediaAsset.findOne({ where: { id, store_wa_id: storeWaId } });
  if (!asset) throw new Error('Media tidak ditemukan atau bukan milik toko ini.');
  await asset.update({ purpose });
  return asset;
}

/**
 * Hapus media dari database dan file sistem.
 * @param {number} id
 * @param {string} storeWaId - Verifikasi kepemilikan sebelum hapus
 */
async function deleteMedia(id, storeWaId) {
  const asset = await MediaAsset.findOne({ where: { id, store_wa_id: storeWaId } });
  if (!asset) throw new Error('Media tidak ditemukan atau bukan milik toko ini.');

  const { UPLOADS_DIR } = require('../config');
  const filePath = path.join(UPLOADS_DIR, asset.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    logger.info(`[Media] File fisik dihapus: ${asset.filename}`);
  }

  await asset.destroy();
  logger.info(`[Media] Record DB "${asset.label}" dihapus dari toko [${storeWaId}].`);
  return true;
}

module.exports = {
  getMediaByStore,
  getSendableMedia,
  getKnowledgeMedia,
  findSendableMediaByKeyword,
  registerMedia,
  updateMediaPurpose,
  deleteMedia
};
