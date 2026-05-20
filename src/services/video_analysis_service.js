/**
 * @file video_analysis_service.js
 * @description Layanan analisis video komprehensif:
 *  1. Whisper API → Transkripsi audio/narasi dari video
 *  2. ffmpeg (auto-install) → Ekstrak frame visual → Vision AI
 *  Menghasilkan pengetahuan ganda: apa yang DIUCAPKAN + apa yang DITAMPILKAN
 */

const OpenAI = require('openai');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config');

// Set path ffmpeg & ffprobe otomatis dari installer
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

// Format video yang didukung Whisper untuk transkripsi
const WHISPER_SUPPORTED = ['.mp4', '.mov', '.avi', '.mkv', '.m4a', '.mp3', '.wav', '.webm', '.3gp'];

// Format gambar untuk Vision AI
const VISION_MIME_MAP = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', webp: 'image/webp'
};

// ============================================================
// FUNGSI 1: Transkripsi Audio/Narasi via Whisper API
// ============================================================

/**
 * Transkripsi narasi/suara dari file video menggunakan OpenAI Whisper.
 * @param {string} videoPath - Path file video
 * @returns {Promise<string>} Teks transkrip atau '' jika gagal/tidak ada audio
 */
async function transcribeAudio(videoPath) {
  const ext = path.extname(videoPath).toLowerCase();
  if (!WHISPER_SUPPORTED.includes(ext)) {
    logger.warn(`[Whisper] Format tidak didukung: ${ext}`);
    return '';
  }

  try {
    logger.info(`[Whisper] Memulai transkripsi audio dari: ${path.basename(videoPath)}`);
    const fileStream = fs.createReadStream(videoPath);

    const transcription = await openai.audio.transcriptions.create({
      file: fileStream,
      model: 'whisper-1',
      language: 'id', // Bahasa Indonesia (auto-detect jika campuran)
      response_format: 'text'
    });

    const result = transcription?.trim() || '';
    if (result) {
      logger.success(`[Whisper] Transkripsi selesai: "${result.substring(0, 80)}..."`);
    } else {
      logger.warn(`[Whisper] Tidak ada audio yang terdeteksi dalam video.`);
    }
    return result;
  } catch (err) {
    // Jika tidak ada audio track, Whisper mengembalikan error — kita tangkap dengan grace
    if (err.message?.includes('audio') || err.status === 400) {
      logger.warn(`[Whisper] Video tidak memiliki audio yang bisa ditranskripsi.`);
    } else {
      logger.warn(`[Whisper] Gagal transkripsi (non-fatal): ${err.message}`);
    }
    return '';
  }
}

// ============================================================
// FUNGSI 2: Ekstrak Frame Video → Analisis Visual (Vision AI)
// ============================================================

/**
 * Ekstrak 3 frame dari video (awal, tengah, akhir) menggunakan ffmpeg.
 * @param {string} videoPath - Path file video
 * @param {string} outputDir - Direktori output untuk frame gambar
 * @returns {Promise<string[]>} Array path file gambar frame
 */
function extractFrames(videoPath, outputDir) {
  return new Promise((resolve, reject) => {
    const frames = [];
    let duration = 0;

    // Dapatkan durasi video terlebih dahulu
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        logger.warn(`[ffprobe] Gagal baca metadata video: ${err.message}`);
        return resolve([]); // Non-fatal, lanjutkan tanpa frame
      }

      duration = metadata.format?.duration || 0;
      if (duration < 1) {
        logger.warn(`[ffprobe] Durasi video terlalu pendek untuk ekstrak frame.`);
        return resolve([]);
      }

      // Tentukan timestamp untuk 3 frame: 10%, 50%, 85% dari durasi
      const timestamps = [
        Math.max(0.5, duration * 0.10),
        duration * 0.50,
        duration * 0.85
      ];

      let processed = 0;
      const targetFrameCount = timestamps.length;

      timestamps.forEach((ts, idx) => {
        const framePath = path.join(outputDir, `frame_${idx + 1}.jpg`);
        frames.push(framePath);

        ffmpeg(videoPath)
          .seekInput(ts)
          .frames(1)
          .output(framePath)
          .on('end', () => {
            processed++;
            if (processed === targetFrameCount) resolve(frames);
          })
          .on('error', (frameErr) => {
            logger.warn(`[ffmpeg] Gagal ekstrak frame ${idx + 1}: ${frameErr.message}`);
            processed++;
            if (processed === targetFrameCount) resolve(frames.filter(f => fs.existsSync(f)));
          })
          .run();
      });
    });
  });
}

/**
 * Analisis frame-frame visual dari video menggunakan GPT-4o Vision dengan Konteks Toko.
 * @param {string[]} framePaths - Array path file gambar frame
 * @param {string} storeContext - Konteks Toko (Nama & Knowledge)
 * @returns {Promise<string>} Deskripsi visual gabungan dari semua frame
 */
async function analyzeFrames(framePaths, storeContext = "") {
  const validFrames = framePaths.filter(f => fs.existsSync(f));
  if (validFrames.length === 0) return '';

  try {
    logger.info(`[Vision] Menganalisis ${validFrames.length} frame visual video dengan konteks toko...`);

    // Buat array content: text prompt + semua frame image
    const contentParts = [
      {
        type: 'text',
        text: `Anda adalah pakar katalog produk. Analisis ${validFrames.length} screenshot dari video produk toko berikut:
"""
${storeContext || 'Identifikasi konten video secara umum.'}
"""

TUGAS:
Deskripsikan isi visual video ini secara menyeluruh dalam Bahasa Indonesia (3-4 kalimat).
Fokus pada produk apa yang ditampilkan dan fitur pentingnya sesuai pengetahuan toko di atas.`
      }
    ];

    for (const framePath of validFrames) {
      const imageBuffer = fs.readFileSync(framePath);
      const base64Image = imageBuffer.toString('base64');
      contentParts.push({
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${base64Image}`,
          detail: 'low'
        }
      });
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: contentParts }],
      max_tokens: 500,
      temperature: 0.4
    });

    const result = response.choices[0].message.content?.trim() || '';
    logger.success(`[Vision] Analisis frame selesai.`);
    return result;
  } catch (err) {
    logger.warn(`[Vision Frame] Gagal analisis (non-fatal): ${err.message}`);
    return '';
  }
}

// ============================================================
// FUNGSI UTAMA: Analisis Video Komprehensif
// ============================================================

/**
 * Analisis video secara menyeluruh dengan Konteks Toko:
 *  - Transkripsi narasi via Whisper
 *  - Analisis visual via frame extraction + Vision AI (Context-Aware)
 * Menggabungkan keduanya menjadi satu knowledge yang kaya.
 *
 * @param {string} videoPath    - Path file video
 * @param {string} label        - Label/nama media
 * @param {string} storeContext - Nama Toko & Knowledge
 * @returns {Promise<{transcript: string, visualAnalysis: string, combined: string}>}
 */
async function analyzeVideo(videoPath, label = 'Video Produk', storeContext = "") {
  const tmpDir = fs.mkdtempSync(path.join(config.TMP_DIR, 'wa-frames-'));
  let transcript = '';
  let visualAnalysis = '';

  try {
    // Jalankan Whisper dan Frame Extraction secara paralel
    logger.info(`[VideoAnalysis] Memulai analisis komprehensif: "${label}"`);

    const [transcriptResult, framePaths] = await Promise.all([
      transcribeAudio(videoPath),
      extractFrames(videoPath, tmpDir)
    ]);

    transcript = transcriptResult;

    if (framePaths.length > 0) {
      // Analisis visual menggunakan Konteks Toko
      visualAnalysis = await analyzeFrames(framePaths, storeContext);
    }

    // Gabungkan analisis menjadi knowledge yang komprehensif
    let combined = '';
    if (transcript && visualAnalysis) {
      combined = `[ANALISIS VISUAL]: ${visualAnalysis}\n[ISI NARASI/PERCAKAPAN]: ${transcript}`;
    } else if (transcript) {
      combined = `[ISI NARASI]: ${transcript}`;
    } else if (visualAnalysis) {
      combined = `[ANALISIS VISUAL]: ${visualAnalysis}`;
    }

    logger.success(`[VideoAnalysis] Selesai untuk "${label}": narasi=${!!transcript}, visual=${!!visualAnalysis}`);
    return { transcript, visualAnalysis, combined };

  } catch (err) {
    logger.error(`[VideoAnalysis] Error: ${err.message}`);
    return { transcript: '', visualAnalysis: '', combined: '' };
  } finally {
    // Bersihkan file frame sementara
    try {
      const files = fs.readdirSync(tmpDir);
      files.forEach(f => fs.unlinkSync(path.join(tmpDir, f)));
      fs.rmdirSync(tmpDir);
    } catch (_) { /* ignore cleanup errors */ }
  }
}

module.exports = {
  analyzeVideo,
  transcribeAudio,
  analyzeFrames
};
