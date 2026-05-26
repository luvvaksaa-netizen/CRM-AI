/**
 * @file smart_label_service.js
 * @description Smart Label Engine — Auto-label WA contacts berdasarkan STATUS rekap AI.
 *
 * KEY FEATURES:
 *  - Parse field STATUS & WA_LABELS dari teks rekap ChatSummary
 *  - Mapping STATUS → label WA yang semantik (Closing, Hot Lead, dll)
 *  - Auto-create label di WA Business jika belum ada (via ensureLabel)
 *  - Simpan label aktif ke kolom `wa_labels` di ChatSummary untuk visibilitas dashboard
 *  - Non-blocking: semua operasi WA wrapped dengan safe error handling
 *  - Cache client WA per store agar tidak re-lookup setiap kali
 *
 * DIPANGGIL OLEH: message_handler._updateConversationSummary()
 */

'use strict';

const logger = require('../utils/logger');

// ══════════════════════════════════════════════════════════════════
// MAPPING: STATUS dari rekap AI → Label WhatsApp Business
// Key: regex yang match teks STATUS (case-insensitive)
// Value: { label, color } — color adalah colorIndex WA (0-19)
// ══════════════════════════════════════════════════════════════════
const STATUS_LABEL_MAP = [
  // Prioritas tertinggi — closing/selesai
  { pattern: /\bstatus:\s*(closing|selesai)\b/i,           label: 'Closing',           color: 1  }, // Hijau
  // Menunggu pembayaran
  { pattern: /\bstatus:\s*menunggu\s*transfer\b/i,         label: 'Menunggu Transfer', color: 7  }, // Kuning
  // Menunggu data dari customer
  { pattern: /\bstatus:\s*menunggu\s*rekap\b/i,            label: 'Menunggu Rekap',    color: 6  }, // Orange
  { pattern: /\bstatus:\s*menunggu\s*alamat\b/i,           label: 'Menunggu Alamat',   color: 6  }, // Orange
  // Negosiasi / diskusi harga
  { pattern: /\bstatus:\s*negosiasi\b/i,                   label: 'Hot Lead',          color: 14 }, // Merah muda
  // Gali kebutuhan (lead aktif)
  { pattern: /\bstatus:\s*gali\s*kebutuhan\b/i,            label: 'AI Lead Aktif',     color: 2  }, // Biru muda
  // Opening (baru mulai)
  { pattern: /\bstatus:\s*opening\b/i,                     label: 'AI Lead Baru',      color: 4  }, // Abu-abu
];

// Label yang DIHAPUS saat status berubah ke closing (tidak relevan lagi)
const LABELS_TO_REMOVE_ON_CLOSING = [
  'Hot Lead', 'AI Lead Aktif', 'AI Lead Baru',
  'Menunggu Transfer', 'Menunggu Rekap', 'Menunggu Alamat',
];

// Field WA_LABELS di rekap — format: WA_LABELS: [label1, label2]
const WA_LABELS_FIELD_RE = /^WA_LABELS:\s*\[([^\]]*)\]/im;

// ══════════════════════════════════════════════════════════════════
// PARSER HELPERS
// ══════════════════════════════════════════════════════════════════

/**
 * Deteksi label yang harus diterapkan berdasarkan teks rekap.
 * Mengembalikan label pertama yang cocok (priority order).
 * @param {string} summaryText
 * @returns {{ label: string, color: number } | null}
 */
function detectLabelFromSummary(summaryText) {
  if (!summaryText) return null;
  for (const rule of STATUS_LABEL_MAP) {
    if (rule.pattern.test(summaryText)) {
      return { label: rule.label, color: rule.color };
    }
  }
  return null;
}

/**
 * Parse field WA_LABELS dari teks rekap (jika AI memasukkannya secara eksplisit).
 * Format rekap: WA_LABELS: [Closing, Hot Lead]
 * @param {string} summaryText
 * @returns {string[]}
 */
function parseWaLabelsField(summaryText) {
  if (!summaryText) return [];
  const match = WA_LABELS_FIELD_RE.exec(summaryText);
  if (!match) return [];
  return match[1]
    .split(',')
    .map(l => l.trim())
    .filter(Boolean);
}

/**
 * Cek apakah rekap menunjukkan status closing/selesai.
 * @param {string} summaryText
 * @returns {boolean}
 */
function isClosingStatus(summaryText) {
  return /\bstatus:\s*(closing|selesai)\b/i.test(summaryText || '');
}

// ══════════════════════════════════════════════════════════════════
// MAIN ENGINE
// ══════════════════════════════════════════════════════════════════

/**
 * Terapkan label WA berdasarkan rekap AI + simpan ke DB untuk visibilitas dashboard.
 * Operasi ini non-blocking — dipanggil dengan .catch() oleh message_handler.
 *
 * @param {string} storeWaId     - WA ID toko (untuk lookup client WA)
 * @param {string} contactId     - JID pelanggan
 * @param {string} summaryText   - Teks rekap dari generateChatSummary
 * @param {object} [waClient]    - WWebJS client (opsional, bisa null jika tidak tersedia)
 */
async function applyLabelsFromSummary(storeWaId, contactId, summaryText, waClient = null) {
  try {
    const { ChatSummary } = require('../database/index');

    // 1. Deteksi label dari STATUS field
    const detectedRule = detectLabelFromSummary(summaryText);

    // 2. Parse explicit WA_LABELS field dari rekap (jika AI mengisinya)
    const explicitLabels = parseWaLabelsField(summaryText);

    // Gabungkan: label dari STATUS + explicit labels dari AI
    const labelsToApply = [];
    if (detectedRule) labelsToApply.push(detectedRule);

    // Untuk explicit labels dari AI (tanpa color mapping yang diketahui → default 0)
    for (const lbl of explicitLabels) {
      if (!labelsToApply.find(r => r.label.toLowerCase() === lbl.toLowerCase())) {
        labelsToApply.push({ label: lbl, color: 0 });
      }
    }

    if (labelsToApply.length === 0) {
      // Tidak ada label yang terdeteksi — tidak perlu aksi apapun
      return;
    }

    const labelNames = labelsToApply.map(r => r.label);
    logger.info(`[SmartLabel] [${storeWaId}] Kontak [${contactId}] → Label: ${labelNames.join(', ')}`);

    // 3. Simpan ke DB untuk visibilitas dashboard (selalu, meski WA client tidak ada)
    await _persistLabelsToDb(storeWaId, contactId, labelNames, ChatSummary);

    // 4. Terapkan ke WhatsApp Business (jika client tersedia)
    if (waClient) {
      await _applyLabelsToWA(storeWaId, contactId, labelsToApply, summaryText, waClient);
    } else {
      // Coba ambil client dari whatsapp_service
      try {
        const { getActiveClient } = require('../whatsapp_service');
        const client = getActiveClient(storeWaId);
        if (client) {
          await _applyLabelsToWA(storeWaId, contactId, labelsToApply, summaryText, client);
        }
      } catch (_) {
        // Client belum tersedia — label sudah tersimpan di DB, WA akan diupdate saat restart
        logger.info(`[SmartLabel] WA client tidak tersedia untuk [${storeWaId}], label disimpan di DB saja.`);
      }
    }

  } catch (err) {
    // Non-critical — jangan crash flow utama
    logger.warn(`[SmartLabel] Gagal apply label untuk [${contactId}]: ${err.message}`);
  }
}

/**
 * Simpan label aktif ke kolom `wa_labels` di ChatSummary.
 * @param {string} storeWaId
 * @param {string} contactId
 * @param {string[]} labelNames
 * @param {object} ChatSummary - Sequelize model
 */
async function _persistLabelsToDb(storeWaId, contactId, labelNames, ChatSummary) {
  try {
    const defaultTimestamps = labelNames.reduce((acc, lbl) => { acc[lbl] = Date.now(); return acc; }, {});
    const [record] = await ChatSummary.findOrCreate({
      where: { store_wa_id: storeWaId, contact_id: contactId },
      defaults: { 
        wa_labels: JSON.stringify(labelNames),
        label_timestamps: JSON.stringify(defaultTimestamps)
      }
    });

    if (record) {
      let timestamps = {};
      try {
        timestamps = JSON.parse(record.label_timestamps || '{}');
      } catch (_) {}

      const newTimestamps = {};
      for (const lbl of labelNames) {
        newTimestamps[lbl] = timestamps[lbl] || Date.now();
      }

      record.wa_labels = JSON.stringify(labelNames);
      record.label_timestamps = JSON.stringify(newTimestamps);
      await record.save();
    }
  } catch (e) {
    logger.warn(`[SmartLabel] Gagal simpan label ke DB: ${e.message}`);
  }
}

/**
 * Terapkan/update label ke WhatsApp Business via WA-JS bridge.
 * @param {string} storeWaId
 * @param {string} contactId
 * @param {Array<{label: string, color: number}>} labelsToApply
 * @param {string} summaryText
 * @param {object} waClient
 */
async function _applyLabelsToWA(storeWaId, contactId, labelsToApply, summaryText, waClient) {
  const { safeAddLabelByName } = require('./wajs_bridge');

  // Jika status closing, hapus label yang tidak relevan dulu
  if (isClosingStatus(summaryText)) {
    await _removeStaleLabels(storeWaId, contactId, waClient, LABELS_TO_REMOVE_ON_CLOSING);
  }

  // Terapkan setiap label yang terdeteksi
  for (const { label, color } of labelsToApply) {
    try {
      await safeAddLabelByName(waClient, contactId, label, color, storeWaId);
      logger.info(`[SmartLabel] ✅ Label WA "${label}" diterapkan ke [${contactId}] (${storeWaId})`);
    } catch (e) {
      logger.warn(`[SmartLabel] Gagal terapkan label WA "${label}": ${e.message}`);
    }
  }
}

/**
 * Hapus label WA yang sudah tidak relevan dari kontak.
 * Dipanggil saat status berubah ke closing agar tidak ada label ganda yang membingungkan.
 * @param {string} storeWaId
 * @param {string} contactId
 * @param {object} waClient
 * @param {string[]} labelNamesToRemove
 */
async function _removeStaleLabels(storeWaId, contactId, waClient, labelNamesToRemove) {
  try {
    const { getLabels, addOrRemoveLabels } = require('./wajs_bridge');
    const allLabels = await getLabels(waClient, storeWaId);

    const removeOps = allLabels
      .filter(l => labelNamesToRemove.some(n => n.toLowerCase() === (l.name || '').toLowerCase()))
      .map(l => ({ labelId: l.id, type: 'remove' }));

    if (removeOps.length > 0) {
      await addOrRemoveLabels(waClient, contactId, removeOps, storeWaId);
      logger.info(`[SmartLabel] Dihapus ${removeOps.length} label lama dari [${contactId}]`);
    }
  } catch (e) {
    // Non-critical — label removal is best-effort
    logger.warn(`[SmartLabel] Gagal hapus label lama: ${e.message}`);
  }
}

/**
 * Ambil label aktif dari DB (untuk API dashboard tanpa hit WA-JS).
 * @param {string} storeWaId
 * @param {string} contactId
 * @returns {string[]}
 */
async function getLabelsFromDb(storeWaId, contactId) {
  try {
    const { ChatSummary } = require('../database/index');
    const record = await ChatSummary.findOne({
      where: { store_wa_id: storeWaId, contact_id: contactId },
      attributes: ['wa_labels']
    });
    if (!record?.wa_labels) return [];
    return JSON.parse(record.wa_labels || '[]');
  } catch (_) {
    return [];
  }
}

module.exports = {
  applyLabelsFromSummary,
  detectLabelFromSummary,
  parseWaLabelsField,
  isClosingStatus,
  getLabelsFromDb,
  STATUS_LABEL_MAP,
};
