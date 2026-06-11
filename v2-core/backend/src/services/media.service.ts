/**
 * @file media.service.ts
 * @description Service manajemen media dengan analisis cerdas per-toko.
 * Mendukung:
 *  - Foto: Vision AI analisis otomatis
 *  - Video: Whisper (narasi) + Frame Vision (visual) analisis otomatis
 *  - Purpose control: 'both' | 'knowledge_only' | 'send_only'
 */

import { Op } from 'sequelize';
import { MediaAsset, BotAgent } from '../models/index';
import { analyzeImage, isImageSupportedByVision } from './vision_service';
import { analyzeVideo } from './video_analysis_service';
import logger from '../utils/logger';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import config from '../config';

const { UPLOADS_DIR } = config;

const VIDEO_OPTIMIZE_ENABLED = process.env.MEDIA_VIDEO_OPTIMIZE_ENABLED !== 'false';
const VIDEO_OPTIMIZE_THRESHOLD_BYTES = Number(process.env.MEDIA_VIDEO_OPTIMIZE_THRESHOLD_MB || 12) * 1024 * 1024;
const VIDEO_OPTIMIZE_TIMEOUT_MS = Number(process.env.MEDIA_VIDEO_OPTIMIZE_TIMEOUT_MS || 180000);

// ============================================================
// READ OPERATIONS
// ============================================================

/**
 * Ambil semua media milik Agen tertentu.
 * @param agentId
 */
async function getMediaByAgent(agentId: number): Promise<MediaAsset[]> {
  return MediaAsset.findAll({
    where: { agent_id: agentId },
    order: [['createdAt', 'DESC']]
  });
}

/**
 * Ambil media yang tersedia untuk DIKIRIM ke customer (purpose: both | send_only).
 * SEKARANG GLOBAL (semua agent) agar bisa cross-selling produk (DTF <-> UV) tanpa upload ulang.
 * @param agentId - Diabaikan, sekarang mengambil semua media.
 */
async function getSendableMedia(agentId: number): Promise<MediaAsset[]> {
  return MediaAsset.findAll({
    where: {
      purpose: { [Op.in]: ['both', 'send_only'] }
    },
    order: [['createdAt', 'DESC']]
  });
}

/**
 * Ambil media yang memberikan KNOWLEDGE ke AI (purpose: both | knowledge_only).
 * SEKARANG GLOBAL (semua agent) agar AI tahu semua produk.
 * @param agentId - Diabaikan, mengambil semua media.
 */
async function getKnowledgeMedia(agentId: number): Promise<MediaAsset[]> {
  return MediaAsset.findAll({
    where: {
      purpose: { [Op.in]: ['both', 'knowledge_only'] }
    },
    order: [['createdAt', 'DESC']]
  });
}

/**
 * Cari media yang bisa dikirim berdasarkan keyword (untuk tool calling AI).
 * @param agentId
 * @param keyword
 */
async function findSendableMediaByKeyword(agentId: number, keyword: string): Promise<MediaAsset | undefined> {
  const sendable = await getSendableMedia(agentId);
  return sendable.find(a => {
    const aAny = a as any;
    const searchTarget = `${aAny.label} ${aAny.description} ${aAny.ai_analysis} ${aAny.video_transcript}`.toLowerCase();
    return searchTarget.includes(keyword.toLowerCase());
  });
}

// ============================================================
// WRITE OPERATIONS
// ============================================================

interface RegisterMediaData {
  agent_id: number;
  filename: string;
  original_name: string;
  type: 'image' | 'video';
  label?: string;
  description?: string;
  purpose?: 'both' | 'knowledge_only' | 'send_only';
  filePath: string;
}

/**
 * Registrasi media baru + jalankan analisis AI di latar belakang.
 * @param data - Data media + filePath untuk analisis
 * @param onAnalysisDone - Callback saat analisis selesai (opsional)
 */
async function registerMedia(data: RegisterMediaData, onAnalysisDone: ((asset: MediaAsset) => void) | null = null): Promise<MediaAsset> {
  // Buat record terlebih dahulu dengan status 'pending'
  const asset = await MediaAsset.create({
    agent_id:      data.agent_id,
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

  logger.success(`[Media] "${(asset as any).label}" terdaftar untuk Agen ID [${data.agent_id}]. Analisis dimulai...`);

  // Jalankan analisis di latar belakang (non-blocking)
  _runAnalysisInBackground(asset, data.filePath, onAnalysisDone);

  return asset;
}

async function optimizeVideoForWhatsApp(asset: MediaAsset, filePath: string): Promise<string> {
  const optAsset = asset as any;
  if (!VIDEO_OPTIMIZE_ENABLED || optAsset.type !== 'video') return filePath;
  if (!fs.existsSync(filePath)) return filePath;

  const originalSize = fs.statSync(filePath).size;
  if (originalSize <= VIDEO_OPTIMIZE_THRESHOLD_BYTES) return filePath;

  const originalFilename = optAsset.filename;
  const ext = path.extname(optAsset.filename);
  const baseName = path.basename(optAsset.filename, ext);
  const optimizedName = `${baseName}-wa.mp4`;
  const optimizedPath = path.join(path.dirname(filePath), optimizedName);

  if (fs.existsSync(optimizedPath) && fs.statSync(optimizedPath).size > 0) {
    await asset.update({ filename: optimizedName });
    return optimizedPath;
  }

  logger.info(`[Media] Mengoptimalkan video besar untuk pengiriman WA: ${optAsset.filename}`);
  const args = [
    '-nostdin',
    '-i', filePath,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '30',
    '-maxrate', '900k',
    '-bufsize', '1800k',
    '-c:a', 'aac',
    '-b:a', '64k',
    '-movflags', '+faststart',
    '-y',
    optimizedPath
  ];

  await new Promise<void>((resolve, reject) => {
    execFile(ffmpegInstaller.path, args, { timeout: VIDEO_OPTIMIZE_TIMEOUT_MS }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  if (!fs.existsSync(optimizedPath) || fs.statSync(optimizedPath).size === 0) {
    throw new Error('Video hasil optimasi kosong.');
  }

  const optimizedSize = fs.statSync(optimizedPath).size;
  if (optimizedSize >= originalSize) {
    fs.unlinkSync(optimizedPath);
    logger.warn(`[Media] Optimasi video dilewati karena hasil tidak lebih kecil: ${optAsset.filename}`);
    return filePath;
  }

  await asset.update({ filename: optimizedName });
  try { fs.unlinkSync(filePath); } catch (_) {}

  logger.success(`[Media] Video dioptimalkan untuk WA: ${originalFilename} -> ${optimizedName} (${Math.round(originalSize / 1024 / 1024)}MB -> ${Math.round(optimizedSize / 1024 / 1024)}MB)`);
  return optimizedPath;
}

/**
 * Proses analisis AI di latar belakang (non-blocking) dengan Konteks Otak Agen.
 * @private
 */
async function _runAnalysisInBackground(
  asset: MediaAsset,
  filePath: string,
  onAnalysisDone: ((asset: MediaAsset) => void) | null
): Promise<void> {
  try {
    await asset.update({ analysis_status: 'processing' });

    // AMBIL KONTEKS AGEN (Nama & Knowledge) dari Database
    const agent = await BotAgent.findByPk((asset as any).agent_id) as any;

    // Bangun string konteks untuk memandu AI agar tidak "ngawur"
    const agentContext = agent
      ? `Nama Bot: ${(agent as any).bot_name}\nInternal Label: ${(agent as any).name}\nPengetahuan Produk: ${(agent as any).product_knowledge}`
      : "Identifikasi gambar produk secara umum.";

    let aiAnalysis = '';
    let videoTranscript = '';

    if ((asset as any).type === 'image') {
      // === FOTO: Vision AI (Context-Aware) ===
      if (isImageSupportedByVision((asset as any).filename)) {
        logger.info(`[Vision] Menganalisis foto dengan konteks Agen: "${agent?.name || 'Unknown'}"`);
        aiAnalysis = await analyzeImage(filePath, agentContext);
      }
    } else if ((asset as any).type === 'video') {
      // === VIDEO: Whisper + Frame Vision (Context-Aware) ===
      logger.info(`[VideoAnalysis] Menganalisis video dengan konteks Agen: "${agent?.name || 'Unknown'}"`);
      const { transcript, visualAnalysis } = await analyzeVideo(filePath, (asset as any).label, agentContext);
      videoTranscript = transcript;
      aiAnalysis = visualAnalysis;
      await optimizeVideoForWhatsApp(asset, filePath).catch(err => {
        logger.warn(`[Media] Optimasi video dilewati: ${err.message}`);
      });
    }

    await asset.update({
      ai_analysis:      aiAnalysis,
      video_transcript: videoTranscript,
      analysis_status:  'done'
    });

    logger.success(`[Media] Analisis kontekstual selesai: "${(asset as any).label}" untuk Agen [${(agent as any)?.name}]`);

    // Panggil callback jika ada (untuk emit socket event)
    if (onAnalysisDone) onAnalysisDone(asset);

  } catch (err: any) {
    logger.error(`[Media] Analisis gagal untuk "${(asset as any).label}": ${err.message}`);
    await asset.update({ analysis_status: 'failed' });
  }
}

interface UpdateMediaDetailsData {
  label?: string;
  description?: string;
  purpose?: string;
  ai_analysis?: string;
  trigger_words?: string;
}

/**
 * Update detail informasi sebuah media (Label, Tujuan, Deskripsi, AI Override, Trigger Words).
 * @param id
 * @param agentId   - Verifikasi kepemilikan
 * @param data      - Object berisi field yang mau diupdate
 */
async function updateMediaDetails(id: number, agentId: number, data: UpdateMediaDetailsData): Promise<MediaAsset> {
  const asset = await MediaAsset.findOne({ where: { id, agent_id: agentId } });
  if (!asset) throw new Error('Media tidak ditemukan atau bukan milik agen ini.');

  const updateData: Record<string, any> = {};
  if (data.label !== undefined) updateData.label = data.label;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.purpose !== undefined) updateData.purpose = data.purpose;
  if (data.ai_analysis !== undefined) updateData.ai_analysis = data.ai_analysis;
  if (data.trigger_words !== undefined) updateData.trigger_words = data.trigger_words;

  await asset.update(updateData);
  return asset;
}

/**
 * Hapus media dari database dan file sistem.
 * @param id
 * @param agentId - Verifikasi kepemilikan sebelum hapus
 */
async function deleteMedia(id: number, agentId: number): Promise<boolean> {
  const asset = await MediaAsset.findOne({ where: { id, agent_id: agentId } });
  if (!asset) throw new Error('Media tidak ditemukan atau bukan milik agen ini.');

  const delAsset = asset as any;
  const filePath = path.join(UPLOADS_DIR, path.basename(delAsset.filename));
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    logger.info(`[Media] File fisik dihapus: ${delAsset.filename}`);
  }

  await delAsset.destroy();
  logger.info(`[Media] Record DB "${delAsset.label}" dihapus dari Agen [${agentId}].`);
  return true;
}

export {
  getMediaByAgent,
  getSendableMedia,
  getKnowledgeMedia,
  findSendableMediaByKeyword,
  registerMedia,
  optimizeVideoForWhatsApp,
  updateMediaDetails,
  deleteMedia
};
