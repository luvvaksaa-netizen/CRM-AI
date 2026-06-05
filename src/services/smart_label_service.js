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
  // Prioritas tertinggi — closing/selesai atau batal
  { pattern: /\bstatus:\s*(closing|selesai)\b/i,           label: 'Closing',           color: 1  }, // Hijau
  { pattern: /\bstatus:\s*(batal|cancel|nggak jadi)\b/i,   label: 'Cancel',            color: 11 }, // Abu-abu tua/Merah pudar
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
// PENTING: 'COD', 'Transfer', 'Kontak LID' sengaja TIDAK dihapus
// — CS butuh info metode pembayaran setelah closing
const LABELS_TO_REMOVE_ON_CLOSING = [
  'Hot Lead', 'AI Lead Aktif', 'AI Lead Baru',
  'Menunggu Transfer', 'Menunggu Rekap', 'Menunggu Alamat', 'Cancel'
];

// Label yang DIHAPUS saat status berubah ke cancel
const LABELS_TO_REMOVE_ON_CANCEL = [
  'Hot Lead', 'AI Lead Aktif', 'AI Lead Baru',
  'Menunggu Transfer', 'Menunggu Rekap', 'Menunggu Alamat', 'Closing', 'COD', 'Transfer'
];

// Label-label yang TIDAK BOLEH pernah dihapus/ditimpa oleh update summary
// (saat bot follow-up, label Closing tidak boleh kembali ke "AI Lead Aktif")
const IMMUTABLE_LABELS = new Set(['Closing', 'Cancel']);

// Label STATUS PESANAN — bersifat MUTUALLY EXCLUSIVE (hanya boleh ada 1 aktif)
// Saat label funnel baru masuk, semua label funnel lama otomatis dihapus.
// TIDAK TERMASUK label informational seperti 'AI Lead Baru', 'Kontak LID' — mereka boleh tetap ada.
const FUNNEL_LABELS = new Set([
  'Menunggu Rekap', 'Menunggu Alamat', 'Menunggu Transfer',
  'Hot Lead', 'AI Lead Aktif', 'AI Lead Baru'
]);

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
  return match[1].split(',').map(l => l.replace(/['"]/g, '').trim()).filter(Boolean);
}

/**
 * Cek apakah rekap menunjukkan status closing/selesai.
 * @param {string} summaryText
 * @returns {boolean}
 */
function isClosingStatus(summaryText) {
  return /\bstatus:\s*(closing|selesai)\b/i.test(summaryText || '');
}

/**
 * Cek apakah rekap menunjukkan status batal/cancel.
 * @param {string} summaryText
 * @returns {boolean}
 */
function isCancelStatus(summaryText) {
  return /\bstatus:\s*(batal|cancel|nggak jadi)\b/i.test(summaryText || '');
}

/**
 * FIX #3 + #2 — PRE-CLOSING VALIDATION GATE (DIPERKUAT)
 * Validasi apakah data pesanan sudah cukup lengkap sebelum label Closing diizinkan.
 * Mencegah bot melabeli Closing padahal:
 *   - Nama customer / Varian / Jumlah / Alamat / Metode Bayar belum ada
 *   - TEKS LABEL (nama yang akan dicetak) belum diisi
 *   - ONGKIR belum dicek (nominal harus sudah ada, sesuai SOP tidak boleh kosong)
 *   - DETAIL PER NAMA belum jelas
 * @param {string} summaryText - Teks rekap dari AI
 * @returns {boolean} true jika closing boleh diterapkan
 */
function isClosingDataComplete(summaryText) {
  if (!summaryText) return false;
  const txt = summaryText;

  // Deteksi apakah produk ini UV (Stiker Keras) atau DTF (Label Baju)
  const isUvProduct = /PRODUK DIMINATI:.*?(UV|Stiker UV|stiker keras)/i.test(txt);

  // Field wajib SEMUA produk
  const commonChecks = [
    { regex: /NAMA CUSTOMER:\s*(?!belum\b)(.+)/i, label: 'Nama Customer' },
    { regex: /VARIAN:\s*(?!belum\b)(.+)/i, label: 'Varian' },
    { regex: /JUMLAH:\s*(?!belum\b)(.+)/i, label: 'Jumlah' },
    { regex: /ALAMAT:\s*(?!belum\b)(.+)/i, label: 'Alamat' },
    { regex: /METODE BAYAR:\s*(Transfer|COD)/i, label: 'Metode Bayar' },
    // FIX #2A: Nama yang dicetak wajib ada sebelum closing
    { regex: /TEKS LABEL:\s*(?!belum\b)(.+)/i, label: 'Teks Label (nama cetak)' },
    // FIX #2B: Ongkir wajib ada nominalnya (Rp ...) — sesuai SOP tidak boleh kosong
    // Cek: ada "Rp" di field ONGKIR, atau ada "gratis" / "0" yang eksplisit
    { regex: /ONGKIR:\s*(Rp\s?\d|[Gg]ratis|subsidi|0\s?rupiah|tidak ada ongkir)/i, label: 'Ongkir (harus ada nominal atau keterangan gratis)' },
    // FIX #2C: Detail per nama wajib ada (bukan hanya jumlah total)
    { regex: /DETAIL PER NAMA:\s*(?!belum\b)(.+)/i, label: 'Detail Per Nama' },
  ];

  // Field WARNA hanya wajib untuk DTF — UV tidak ada pilihan warna
  const dtfOnlyChecks = [
    { regex: /WARNA:\s*(?!belum\b)(?!N\/A)(.+)/i, label: 'Warna (DTF)' },
  ];

  const allChecks = isUvProduct ? commonChecks : [...commonChecks, ...dtfOnlyChecks];

  const missingFields = allChecks.filter(check => !check.regex.test(txt));
  if (missingFields.length > 0) {
    logger.warn(`[SmartLabel] ⚠️ Closing DIBLOKIR — data belum lengkap: ${missingFields.map(f => f.label).join(', ')}`);
    return false;
  }

  // FIX #2D: Cegah closing jika field kritis masih mengandung placeholder literal [...] 
  // (AI kadang menulis [Nomor WA dari chat] atau [belum diisi] alih-alih data asli)
  const kritisFields = ['TEKS LABEL', 'ALAMAT', 'NAMA CUSTOMER', 'DETAIL PER NAMA'];
  for (const fieldName of kritisFields) {
    const fieldMatch = txt.match(new RegExp(`${fieldName}:\\s*(.+)`, 'i'));
    if (fieldMatch) {
      const fieldValue = fieldMatch[1].trim();
      // Jika nilai field masih mengandung [ atau ] → belum terisi asli
      if (/[\[\]]/.test(fieldValue)) {
        logger.warn(`[SmartLabel] ⚠️ Closing DIBLOKIR — field "${fieldName}" masih berisi placeholder: "${fieldValue}"`);
        return false;
      }
    }
  }

  return true;
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
    let detectedRule = detectLabelFromSummary(summaryText);

    // FIX #3: Jika label yang terdeteksi adalah Closing, validasi kelengkapan data dulu
    if (detectedRule && detectedRule.label === 'Closing') {
      if (!isClosingDataComplete(summaryText)) {
        // Data belum lengkap — downgrade ke Menunggu Rekap
        detectedRule = { label: 'Menunggu Rekap', color: 6 };
        logger.warn(`[SmartLabel] [${storeWaId}] Closing di-downgrade ke Menunggu Rekap untuk [${contactId}] karena data belum lengkap.`);
      }
    }

    // 2. Parse explicit WA_LABELS field dari rekap (jika AI mengisinya)
    let explicitLabels = parseWaLabelsField(summaryText);
    // FIX #3: Juga validasi Closing dari explicit labels
    if (explicitLabels.includes('Closing') && !isClosingDataComplete(summaryText)) {
      explicitLabels = explicitLabels.filter(l => l !== 'Closing');
      if (!explicitLabels.includes('Menunggu Rekap')) {
        explicitLabels.push('Menunggu Rekap');
      }
    }

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

    // 5. Auto-cleanup: Jika baru closing (setelah Menunggu Transfer), hapus label lama dari DB
    //    Memastikan dashboard tidak lagi menampilkan "Menunggu Transfer" setelah TF terkonfirmasi.
    //    Lalu trigger Learning Bot untuk ekstrak pola sukses.
    const hasClosingLabel = labelNames.some(l => l.toLowerCase() === 'closing');
    if (hasClosingLabel) {
      // Cleanup "Menunggu Transfer" dari DB jika ada
      try {
        const { ChatSummary } = require('../database/index');
        const rec = await ChatSummary.findOne({ where: { store_wa_id: storeWaId, contact_id: contactId } });
        if (rec) {
          let existLbls = [];
          try { existLbls = JSON.parse(rec.wa_labels || '[]'); } catch (_) {}
          if (existLbls.includes('Menunggu Transfer')) {
            const cleaned = existLbls.filter(l => l !== 'Menunggu Transfer');
            if (!cleaned.includes('Closing')) cleaned.push('Closing');
            rec.wa_labels = JSON.stringify(cleaned);
            await rec.save();
            logger.info(`[SmartLabel] "Menunggu Transfer" dihapus -> "Closing" untuk [${contactId}] (bukti TF diterima).`);
          }
        }
      } catch (_) {}

      // Learning Bot trigger
      try {
        const { onClosingDetected } = require('./learning_service');
        let agentId = null;
        try {
          const { Store } = require('../database/index');
          const store = await Store.findOne({ where: { wa_id: storeWaId } });
          agentId = store?.agent_id || null;
        } catch (_) {}
        onClosingDetected(storeWaId, contactId, agentId)
          .catch(e => logger.warn(`[SmartLabel] Learning trigger error: ${e.message}`));
        logger.info(`[SmartLabel] Learning trigger fired untuk [${contactId}]`);
      } catch (learningErr) {
        logger.warn(`[SmartLabel] Gagal trigger learning: ${learningErr.message}`);
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
      let existingTimestamps = {};
      try { existingTimestamps = JSON.parse(record.label_timestamps || '{}'); } catch (_) {}

      let existingLabels = [];
      try { existingLabels = JSON.parse(record.wa_labels || '[]'); } catch (_) {}

      // ════════════════════════════════════════════════════════════
      // IMMUTABLE LABEL LOCK
      // Jika sudah ada Closing / Cancel, label FUNNEL tidak boleh masuk.
      // Tapi label non-funnel (COD, Kontak LID) tetap boleh.
      // ════════════════════════════════════════════════════════════
      const hasImmutableLabel = existingLabels.some(l => IMMUTABLE_LABELS.has(l));
      let effectiveLabelNames = labelNames;
      if (hasImmutableLabel) {
        const incomingFunnelLabels = labelNames.filter(l => FUNNEL_LABELS.has(l));
        if (incomingFunnelLabels.length > 0) {
          logger.info(`[SmartLabel] LOCK aktif untuk [${contactId}] — menolak downgrade funnel: ${incomingFunnelLabels.join(', ')}`);
          effectiveLabelNames = labelNames.filter(l => !FUNNEL_LABELS.has(l));
          if (effectiveLabelNames.length === 0) return;
        }
      }

      // ════════════════════════════════════════════════════════════
      // FUNNEL LABEL REPLACEMENT (bukan merge!)
      // Label funnel BERSIFAT EKSKLUSIF — hanya boleh ada 1 label funnel
      // aktif dalam satu waktu. Saat label funnel baru masuk, SEMUA label
      // funnel lama harus dihapus terlebih dahulu.
      //
      // Label NON-FUNNEL (Kontak LID, COD, AI Lead Baru yg informational)
      // tetap dipertahankan karena mereka bukan status — mereka adalah tag.
      //
      // Contoh benar:
      //   Menunggu Rekap → hapus "Menunggu Rekap", tambah "Menunggu Alamat"
      //   Menunggu Transfer → hapus semua funnel, tambah "Menunggu Transfer"
      //   Closing → hapus semua funnel, tambah "Closing"
      // ════════════════════════════════════════════════════════════
      const incomingHasFunnelLabel = effectiveLabelNames.some(l => FUNNEL_LABELS.has(l) || IMMUTABLE_LABELS.has(l));
      
      let baseLabels;
      if (incomingHasFunnelLabel) {
        // Hapus SEMUA label funnel lama dari existing — sisakan hanya label informational
        baseLabels = existingLabels.filter(l => !FUNNEL_LABELS.has(l) && !IMMUTABLE_LABELS.has(l));
        const removedFunnels = existingLabels.filter(l => FUNNEL_LABELS.has(l) || IMMUTABLE_LABELS.has(l));
        if (removedFunnels.length > 0) {
          logger.info(`[SmartLabel] Label funnel lama dihapus dari DB untuk [${contactId}]: ${removedFunnels.join(', ')}`);
        }
      } else {
        // Tidak ada funnel baru — pertahankan semua label lama dan tambah yang baru
        baseLabels = [...existingLabels];
      }

      // Gabungkan: label informational yang tersisa + label baru yang masuk
      const mergedLabels = [...new Set([...baseLabels, ...effectiveLabelNames])];

      // Timestamps: pertahankan timestamp lama, catat waktu untuk label baru
      const mergedTimestamps = { ...existingTimestamps };
      for (const lbl of effectiveLabelNames) {
        if (!mergedTimestamps[lbl]) {
          mergedTimestamps[lbl] = Date.now();
        }
        // Jika sudah ada (idempotent): jangan ubah timestamp closing
      }

      record.wa_labels = JSON.stringify(mergedLabels);
      record.label_timestamps = JSON.stringify(mergedTimestamps);
      await record.save();

      logger.info(`[SmartLabel] DB labels untuk [${contactId}]: [${mergedLabels.join(', ')}]`);
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
  const incomingLabels = labelsToApply.map(r => r.label);

  // ════════════════════════════════════════════════════════════
  // HAPUS LABEL FUNNEL LAMA DARI WA SEBELUM MENERAPKAN YANG BARU
  // Label funnel bersifat eksklusif — saat ada label funnel baru,
  // semua label funnel lama di WA harus dihapus agar tidak tumpuk.
  // ════════════════════════════════════════════════════════════
  const incomingHasFunnel = incomingLabels.some(l => FUNNEL_LABELS.has(l) || IMMUTABLE_LABELS.has(l));
  if (incomingHasFunnel) {
    // Buat daftar label funnel lama yang harus dihapus dari WA
    // (semua funnel kecuali yang baru mau diterapkan)
    const labelsToRemove = [...FUNNEL_LABELS, ...IMMUTABLE_LABELS].filter(l => !incomingLabels.includes(l));
    if (labelsToRemove.length > 0) {
      await _removeStaleLabels(storeWaId, contactId, waClient, labelsToRemove);
    }
  }

  // Jika status cancel, bersihkan semuanya
  if (isCancelStatus(summaryText)) {
    await _removeStaleLabels(storeWaId, contactId, waClient, LABELS_TO_REMOVE_ON_CANCEL);
  }

  // Terapkan setiap label yang terdeteksi
  for (const { label, color } of labelsToApply) {
    try {
      await safeAddLabelByName(waClient, contactId, label, color, storeWaId);
      logger.info(`[SmartLabel] Label WA "${label}" diterapkan ke [${contactId}] (${storeWaId})`);
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
    // Hapus dari WhatsApp Business
    const { getLabels, addOrRemoveLabels } = require('./wajs_bridge');
    const allLabels = await getLabels(waClient, storeWaId);

    const removeOps = allLabels
      .filter(l => labelNamesToRemove.some(n => n.toLowerCase() === (l.name || '').toLowerCase()))
      .map(l => ({ labelId: l.id, type: 'remove' }));

    if (removeOps.length > 0) {
      await addOrRemoveLabels(waClient, contactId, removeOps, storeWaId);
      logger.info(`[SmartLabel] Dihapus ${removeOps.length} label lama dari WA [${contactId}]`);
    }

    // Sinkronisasi ke DB: hapus label stale dari wa_labels di ChatSummary
    try {
      const { ChatSummary } = require('../database/index');
      const record = await ChatSummary.findOne({ where: { store_wa_id: storeWaId, contact_id: contactId } });
      if (record) {
        let currentLabels = [];
        try { currentLabels = JSON.parse(record.wa_labels || '[]'); } catch (_) {}
        const cleanedLabels = currentLabels.filter(
          lbl => !labelNamesToRemove.some(n => n.toLowerCase() === lbl.toLowerCase())
        );
        if (cleanedLabels.length !== currentLabels.length) {
          record.wa_labels = JSON.stringify(cleanedLabels);
          await record.save();
          logger.info(`[SmartLabel] DB wa_labels dibersihkan untuk [${contactId}]: ${labelNamesToRemove.join(', ')} dihapus.`);
        }
      }
    } catch (dbErr) {
      logger.warn(`[SmartLabel] Gagal sinkronisasi hapus label ke DB: ${dbErr.message}`);
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
  isCancelStatus,
  isClosingDataComplete,
  getLabelsFromDb,
  STATUS_LABEL_MAP,
};
