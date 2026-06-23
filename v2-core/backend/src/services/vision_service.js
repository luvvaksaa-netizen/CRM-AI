/**
 * @file vision_service.js
 * @description Vision AI Service: Analisis gambar secara otomatis menggunakan GPT-4o Vision.
 * Dijalankan saat foto produk diupload untuk menghasilkan deskripsi AI secara instan.
 */

const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config');

// Map ekstensi file ke MIME type
const MIME_MAP = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', gif: 'image/gif', webp: 'image/webp'
};

/**
 * Menganalisis konten gambar menggunakan GPT-4o Vision dengan Konteks Toko.
 * Mengembalikan deskripsi produk dalam Bahasa Indonesia yang akurat dengan brand.
 *
 * @param {string} filePath     - Path absolut ke file gambar
 * @param {string} storeContext - Konteks Toko (Nama & Knowledge) untuk panduan AI
 * @returns {Promise<string>} Deskripsi AI dari isi gambar
 */
async function analyzeImage(filePath, storeContext = "") {
  if (!config.OPENAI_API_KEY || config.OPENAI_API_KEY.includes('your_openai')) {
    return '';
  }

  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const mimeType = MIME_MAP[ext];
  if (!mimeType) {
    logger.warn(`[Vision] Format tidak didukung untuk analisis: ${ext}`);
    return '';
  }

  const imageBuffer = fs.readFileSync(filePath);
  const base64Image = imageBuffer.toString('base64');

  const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  const response = await openai.chat.completions.create({
    model: 'gpt-4o', // GPT-4o required for Vision
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Anda adalah spesialis katalog produk. Tolong analisis gambar ini berdasarkan KONTEKS TOKO berikut:
"""
${storeContext || 'Identifikasi gambar produk secara umum.'}
"""

TUGAS:
Deskripsikan gambar ini (2-4 kalimat) agar Customer Service AI memahami detail produk sesuai pengetahuan toko di atas.
Fokus pada variasi, warna, dan fitur yang terlihat. Gunakan Bahasa Indonesia yang natural dan profesional.`
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`,
              detail: 'auto'
            }
          }
        ]
      }
    ],
    max_tokens: 400,
    temperature: 0.5
  });

  if (response && response.usage) {
    const { logRequest } = require('./costTracker');
    logRequest({
      model: 'gpt-4o',
      promptTokens: response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
      endpoint: 'chat',
      functionName: 'analyzeImage'
    }).catch(() => {});
  }

  return response.choices[0].message.content?.trim() || '';
}

/**
 * Cek apakah file adalah gambar yang didukung Vision AI.
 * @param {string} filename
 * @returns {boolean}
 */
function isImageSupportedByVision(filename) {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  return Object.keys(MIME_MAP).includes(ext);
}

module.exports = {
  analyzeImage,
  isImageSupportedByVision
};
