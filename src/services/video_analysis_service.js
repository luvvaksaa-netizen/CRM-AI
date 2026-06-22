/**
 * @file video_analysis_service.js
 * @description Layanan analisis video komprehensif:
 *  1. Whisper API → Transkripsi audio/narasi dari video
 *  2. ffmpeg (auto-install) → Ekstrak frame visual → Vision AI
 *  Menghasilkan pengetahuan ganda: apa yang DIUCAPKAN + apa yang DITAMPILKAN
 */

const OpenAI = require('openai');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');

// Set path ffmpeg & ffprobe via env vars (paling reliable untuk fluent-ffmpeg)
process.env.FFMPEG_PATH = ffmpegInstaller.path;
process.env.FFPROBE_PATH = ffprobeInstaller.path;

const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const logger = require('../utils/logger');
const config = require('../config');

const TRANSCRIPTION_TIMEOUT_MS = Number(process.env.OPENAI_TRANSCRIPTION_TIMEOUT_MS || 120000);
const TRANSCRIPTION_RETRIES = Math.max(1, Number(process.env.OPENAI_TRANSCRIPTION_RETRIES || 3));
const FFMPEG_AUDIO_EXTRACT_TIMEOUT_MS = Number(process.env.FFMPEG_AUDIO_EXTRACT_TIMEOUT_MS || 120000);

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: TRANSCRIPTION_TIMEOUT_MS,
  maxRetries: 0
});

// Format video yang didukung Whisper untuk transkripsi
const WHISPER_SUPPORTED = ['.mp4', '.mov', '.avi', '.mkv', '.m4a', '.mp3', '.wav', '.webm', '.3gp'];
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.3gp'];

// Format gambar untuk Vision AI
const VISION_MIME_MAP = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', webp: 'image/webp'
};

// ============================================================
// FUNGSI 1: Transkripsi Audio/Narasi via Whisper API
// ============================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatFileSize(filePath) {
  try {
    const bytes = fs.statSync(filePath).size;
    return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  } catch (_) {
    return 'unknown size';
  }
}

function isRetryableTranscriptionError(err) {
  const message = String(err?.message || '').toLowerCase();
  return !err?.status || err.status >= 500 || message.includes('connection') || message.includes('timeout') || message.includes('econnreset');
}

function cleanupTempDir(tmpDir) {
  if (!tmpDir || !fs.existsSync(tmpDir)) return;
  try {
    for (const file of fs.readdirSync(tmpDir)) {
      fs.unlinkSync(path.join(tmpDir, file));
    }
    fs.rmdirSync(tmpDir);
  } catch (_) { /* ignore cleanup errors */ }
}

function extractAudioForWhisper(videoPath) {
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(config.TMP_DIR, 'wa-audio-'));
    const audioPath = path.join(tmpDir, `${path.basename(videoPath, path.extname(videoPath))}.mp3`);

    const args = [
      '-nostdin',
      '-i', videoPath,
      '-map', '0:a:0',
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-b:a', '48k',
      '-f', 'mp3',
      '-y',
      audioPath
    ];

    execFile(ffmpegInstaller.path, args, { timeout: FFMPEG_AUDIO_EXTRACT_TIMEOUT_MS }, (err) => {
      if (err || !fs.existsSync(audioPath) || fs.statSync(audioPath).size === 0) {
        cleanupTempDir(tmpDir);
        return reject(err || new Error('Audio hasil ekstraksi kosong.'));
      }

      resolve({ audioPath, tmpDir });
    });
  });
}

async function transcribeFileWithRetry(filePath) {
  let lastError = null;

  for (let attempt = 1; attempt <= TRANSCRIPTION_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        logger.info(`[Whisper] Retry transkripsi ${attempt}/${TRANSCRIPTION_RETRIES}: ${path.basename(filePath)}`);
      }

      const payload = {
        file: fs.createReadStream(filePath),
        model: 'whisper-1',
        language: 'id',
        response_format: 'text'
      };

      let transcription = await openai.audio.transcriptions.create(payload, { timeout: TRANSCRIPTION_TIMEOUT_MS });

      return typeof transcription === 'string'
        ? transcription.trim()
        : String(transcription?.text || '').trim();
    } catch (err) {
      lastError = err;
      if (attempt >= TRANSCRIPTION_RETRIES || !isRetryableTranscriptionError(err)) {
        throw err;
      }
      await sleep(800 * attempt);
    }
  }

  throw lastError || new Error('Transkripsi gagal tanpa detail error.');
}

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

  let extracted = null;
  try {
    logger.info(`[Whisper] Memulai transkripsi audio dari: ${path.basename(videoPath)} (${formatFileSize(videoPath)})`);

    let inputForWhisper = videoPath;
    if (VIDEO_EXTENSIONS.includes(ext)) {
      try {
        extracted = await extractAudioForWhisper(videoPath);
        inputForWhisper = extracted.audioPath;
        logger.info(`[Whisper] Audio video diekstrak untuk transkripsi: ${formatFileSize(inputForWhisper)}`);
      } catch (extractErr) {
        const msg = String(extractErr?.message || '').toLowerCase();
        if (msg.includes('matches no streams') || msg.includes('stream map') || msg.includes('audio')) {
          logger.warn(`[Whisper] Video tidak memiliki audio yang bisa ditranskripsi.`);
          return '';
        }
        throw extractErr;
      }
    }

    const result = await transcribeFileWithRetry(inputForWhisper);
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
  } finally {
    cleanupTempDir(extracted?.tmpDir);
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
  return new Promise((resolve) => {
    const frames = [];

    // Dapatkan durasi video terlebih dahulu
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        logger.warn(`[ffprobe] Gagal baca metadata video: ${err.message}`);
        return resolve([]); // Non-fatal, lanjutkan tanpa frame
      }

      const duration = metadata.format?.duration || 0;
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

      // Gunakan child_process.execFile LANGSUNG ke binary ffmpeg
      // Ini menghindari bug fluent-ffmpeg yang tidak pass ffmpegPath ke child instance
      const ffmpegBin = ffmpegInstaller.path;

      let processed = 0;
      const targetFrameCount = timestamps.length;

      timestamps.forEach((ts, idx) => {
        const framePath = path.join(outputDir, `frame_${idx + 1}.jpg`);

        const args = [
          '-nostdin',
          '-ss', String(ts),
          '-i', videoPath,
          '-frames:v', '1',
          '-q:v', '2',
          '-y',
          framePath
        ];

        execFile(ffmpegBin, args, { timeout: 30000 }, (execErr) => {
          if (!execErr && fs.existsSync(framePath)) {
            frames.push(framePath);
          } else {
            logger.warn(`[ffmpeg] Gagal ekstrak frame ${idx + 1}: ${execErr?.message || 'unknown'}`);
          }
          processed++;
          if (processed === targetFrameCount) {
            resolve(frames);
          }
        });
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
