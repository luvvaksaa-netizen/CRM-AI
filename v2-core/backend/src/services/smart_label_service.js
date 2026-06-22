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
  { pattern: /\bstatus:\s*(batal|cancel|nggak jadi)\b/i,   label: 'Cancel',            color: 11 }, // Abu-abu tua
  // Menunggu pembayaran atau sudah Transfer (Tanpa status closing)
  { pattern: /\bstatus:\s*transfer\b/i,                    label: 'Transfer',          color: 7  }, // Kuning
  // COD (deal awal COD)
  { pattern: /\bstatus:\s*cod\b/i,                         label: 'COD',               color: 8  }, // Biru/Ungu
];

// Label yang DIHAPUS saat status berubah ke cancel
const LABELS_TO_REMOVE_ON_CANCEL = [
  'Transfer', 'Closing', 'COD'
];

// ══════════════════════════════════════════════════════════════════
// FIX #4 — LABEL LOCK (IMMUTABLE)
// ══════════════════════════════════════════════════════════════════
const IMMUTABLE_LABELS = new Set(['Closing', 'Cancel']);

// Funnel labels dihapus karena tidak dipakai lagi, 
// tapi variabel dipertahankan kosong agar tidak memutus dependensi eksisting.
const FUNNEL_LABELS = new Set([]);

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
function isClosingDataComplete(summaryText, contactName, contactPhone) {
  if (!summaryText) return false;
  
  // ════════════════════════════════════════════════════════════
  // FIX SUK-59 #2: DB-LEVEL VALIDATION
  // ════════════════════════════════════════════════════════════
  if (contactName) {
    const trimmed = (contactName || '').trim();
    // Whitespace-only atau placeholder name
    if (trimmed.length === 0 || /^(Pelanggan|Customer|Unknown|User|\+?\d{8,})$/.test(trimmed)) {
      logger.warn(`[SmartLabel] ⚠️ Closing DIBLOKIR — contact_name tidak valid: "${trimmed || '(whitespace only)'}"`);
      return false;
    }
  }
  if (contactPhone && !(contactPhone || '').trim()) {
    logger.warn(`[SmartLabel] ⚠️ Closing DIBLOKIR — contact_phone kosong`);
    return false;
  }
  
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

/**
 * Cross-validate metode bayar dari rekap summary dengan label WA.
 * Mencegah inkonsistensi: METODE_BAYAR=COD tapi label=Transfer, dan sebaliknya.
 *
 * Rule:
 * - METODE_BAYAR=COD + label=[Transfer, Closing] → koreksi ke [COD, Closing]
 * - METODE_BAYAR=Transfer + label=[COD, Closing] → koreksi ke [Transfer, Closing]
 *
 * @param {string} summaryText - Teks rekap dari AI
 * @param {string[]} currentLabels - Array label yang akan diterapkan
 * @returns {{ needsCorrection: boolean, reason?: string, removeLabels?: string[], addLabels?: string[] }}
 */
function validateMetodeBayarConsistency(summaryText, currentLabels) {
  if (!summaryText || !currentLabels || currentLabels.length === 0) {
    return { needsCorrection: false };
  }

  const metodeMatch = (summaryText || '').match(/METODE BAYAR:\s*(COD|Transfer)/i);
  if (!metodeMatch) return { needsCorrection: false };

  const metodeBayar = metodeMatch[1].toUpperCase(); // Normalize: 'COD' or 'TRANSFER'
  const hasClosing = currentLabels.some(l => /closing/i.test(l));
  const hasCod = currentLabels.some(l => l === 'COD');
  const hasTransfer = currentLabels.some(l => l === 'Transfer');

  // Hanya validasi untuk label yang mengandung Closing
  if (!hasClosing) return { needsCorrection: false };

  // Rule 1: METODE_BAYAR=COD + label=Transfer → INVALID → koreksi ke COD
  if (metodeBayar === 'COD' && hasTransfer && !hasCod) {
    return {
      needsCorrection: true,
      reason: `[Cross-Validation] METODE_BAYAR=COD tapi label=Transfer → dikoreksi ke COD`,
      removeLabels: ['Transfer'],
      addLabels: ['COD']
    };
  }

  // Rule 2: METODE_BAYAR=Transfer + label=COD → INVALID → koreksi ke Transfer
  if (metodeBayar === 'TRANSFER' && hasCod && !hasTransfer) {
    return {
      needsCorrection: true,
      reason: `[Cross-Validation] METODE_BAYAR=Transfer tapi label=COD → dikoreksi ke Transfer`,
      removeLabels: ['COD'],
      addLabels: ['Transfer']
    };
  }

  return { needsCorrection: false };
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
    const { ChatSummary, ChatMessage } = require('../models/index');

    // FIX SUK-59 #2: Load existing summary for DB-level validation (before both if blocks)
    const existingSummary = await ChatSummary.findOne({ where: { store_wa_id: storeWaId, contact_id: contactId } });
    const contactName = existingSummary?.contact_name;
    const contactPhone = existingSummary?.contact_phone;

    // 0. Ekstrak Tanggal Lead Pertama
    let leadLabel = null;
    try {
      const firstMessage = await ChatMessage.findOne({
        where: { store_wa_id: storeWaId, contact_id: contactId },
        order: [['timestamp', 'ASC']]
      });
      if (firstMessage && firstMessage.timestamp) {
        const dateObj = new Date(firstMessage.timestamp);
        const dd = String(dateObj.getDate()).padStart(2, '0');
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const yyyy = dateObj.getFullYear();
        leadLabel = `Lead (${dd}/${mm}/${yyyy})`;
      } else {
        // Fallback hari ini jika DB kosong
        const dateObj = new Date();
        const dd = String(dateObj.getDate()).padStart(2, '0');
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const yyyy = dateObj.getFullYear();
        leadLabel = `Lead (${dd}/${mm}/${yyyy})`;
      }
    } catch (err) {
      logger.warn(`[SmartLabel] Gagal ekstrak Lead date untuk [${contactId}]: ${err.message}`);
    }

    // 1. Deteksi label dari STATUS field
    let detectedRule = detectLabelFromSummary(summaryText);

    // FIX #3: Jika label yang terdeteksi adalah Closing, validasi kelengkapan data dulu
    if (detectedRule && detectedRule.label === 'Closing') {
      if (!isClosingDataComplete(summaryText, contactName, contactPhone)) {
        // Data belum lengkap — downgrade ke Menunggu Rekap
        detectedRule = { label: 'Menunggu Rekap', color: 6 };
        logger.warn(`[SmartLabel] [${storeWaId}] Closing di-downgrade ke Menunggu Rekap untuk [${contactId}] karena data belum lengkap.`);
      }
    }

    // 2. Parse explicit WA_LABELS field dari rekap (jika AI mengisinya)
    let explicitLabels = parseWaLabelsField(summaryText);
    // FIX #3: Juga validasi Closing dari explicit labels
    if (explicitLabels.includes('Closing') && !isClosingDataComplete(summaryText, contactName, contactPhone)) {
      explicitLabels = explicitLabels.filter(l => l !== 'Closing');
      if (!explicitLabels.includes('Menunggu Rekap')) {
        explicitLabels.push('Menunggu Rekap');
      }
    }

    // Gabungkan: label dari STATUS + explicit labels dari AI + Lead Date
    const labelsToApply = [];
    if (detectedRule) labelsToApply.push(detectedRule);

    // Untuk explicit labels dari AI (tanpa color mapping yang diketahui → default 0)
    for (const lbl of explicitLabels) {
      if (!labelsToApply.find(r => r.label.toLowerCase() === lbl.toLowerCase())) {
        labelsToApply.push({ label: lbl, color: 0 });
      }
    }

    // Selalu sisipkan Lead Label jika belum terhapus oleh aturan Closing/Cancel
    if (leadLabel && !labelsToApply.find(r => r.label === leadLabel)) {
       labelsToApply.push({ label: leadLabel, color: 0 }); // Putih/Abu
    }

    if (labelsToApply.length === 0) {
      // Tidak ada label yang terdeteksi — tidak perlu aksi apapun
      return;
    }

    let labelNames = labelsToApply.map(r => r.label);

    // Hapus Lead label jika ada status Closing atau Cancel
    const hasClosingOrCancel = labelNames.some(l => /closing|cancel/i.test(l));
    if (hasClosingOrCancel) {
       labelNames = labelNames.filter(l => !l.startsWith('Lead ('));
       const idx = labelsToApply.findIndex(r => r.label.startsWith('Lead ('));
       if (idx !== -1) labelsToApply.splice(idx, 1);
    }
    logger.info(`[SmartLabel] [${storeWaId}] Kontak [${contactId}] → Label: ${labelNames.join(', ')}`);

    // 🔍 Fase 1 — Cross-Validation: validasi konsistensi METODE BAYAR vs label Closing
    const crossCheck = validateMetodeBayarConsistency(summaryText, labelNames);
    if (crossCheck.needsCorrection) {
      logger.warn(`[SmartLabel] [${storeWaId}] ${crossCheck.reason} untuk [${contactId}]`);

      // Koreksi labelNames array
      if (crossCheck.removeLabels) {
        for (const rl of crossCheck.removeLabels) {
          const idx = labelNames.indexOf(rl);
          if (idx !== -1) labelNames.splice(idx, 1);
        }
      }
      if (crossCheck.addLabels) {
        for (const al of crossCheck.addLabels) {
          if (!labelNames.includes(al)) labelNames.push(al);
        }
      }

      // Sinkronkan juga labelsToApply (array object {label, color})
      if (crossCheck.removeLabels) {
        for (const rl of crossCheck.removeLabels) {
          const idx = labelsToApply.findIndex(r => r.label === rl);
          if (idx !== -1) labelsToApply.splice(idx, 1);
        }
      }
      if (crossCheck.addLabels) {
        for (const al of crossCheck.addLabels) {
          if (!labelsToApply.find(r => r.label === al)) {
            labelsToApply.push({ label: al, color: 0 });
          }
        }
      }

      logger.info(`[SmartLabel] [${storeWaId}] Label dikoreksi menjadi: ${labelNames.join(', ')}`);
    }

    // 3. Simpan ke DB untuk visibilitas dashboard (selalu, meski WA client tidak ada)
    await _persistLabelsToDb(storeWaId, contactId, labelNames, ChatSummary);

    // 4. Terapkan ke WhatsApp Business (jika client tersedia)
    if (waClient) {
      await _applyLabelsToWA(storeWaId, contactId, labelsToApply, summaryText, waClient, crossCheck.removeLabels || []);
    } else {
      // Coba ambil client dari whatsapp_service
      try {
        const { getActiveClient } = require('../whatsapp_service');
        const client = getActiveClient(storeWaId);
        if (client) {
          await _applyLabelsToWA(storeWaId, contactId, labelsToApply, summaryText, client, crossCheck.removeLabels || []);
        }
      } catch (_) {
        // Client belum tersedia — label sudah tersimpan di DB, WA akan diupdate saat restart
        logger.info(`[SmartLabel] WA client tidak tersedia untuk [${storeWaId}], label disimpan di DB saja.`);
      }
    }

    // 5. Eksekusi Scalev Cancel jika Transfer Manual + Closing
    const hasClosingLabel = labelNames.some(l => l.toLowerCase() === 'closing');
    const hasTransferLabel = labelNames.some(l => l.toLowerCase() === 'transfer');
    
    if (hasClosingLabel && hasTransferLabel && contactPhone) {
       try {
          const scalevService = require('./scalev.service');
          scalevService.cancelOrderIfManualTransfer(storeWaId, contactPhone)
            .catch(e => logger.warn(`[Scalev] Background cancel error: ${e.message}`));

          // Kirim Invoice Manual Transfer
          try {
             const { generateInvoiceText } = require('./invoice.service');
             const invoiceText = await generateInvoiceText({
                customerPhone: contactPhone,
                method: 'Transfer Manual'
             }, storeWaId);

             if (invoiceText) {
                const { sendManualMessage } = require('../whatsapp_service');
                // Beri delay sedikit agar WA API tidak kena rate limit
                setTimeout(() => {
                   sendManualMessage(storeWaId, contactId, invoiceText)
                     .catch(e => logger.warn(`[Invoice] Gagal kirim struk manual transfer: ${e.message}`));
                }, 2000);
             }
          } catch (invErr) {
             logger.warn(`[Invoice] Error saat men-generate invoice manual: ${invErr.message}`);
          }
       } catch (err) {
          logger.warn(`[Scalev] Gagal trigger pembatalan manual transfer: ${err.message}`);
       }
    }

    // 6. 🧠 LEARNING BOT TRIGGER — Jika ada label Closing, analisis percakapan
    //    untuk ekstrak pola sukses. Non-blocking, berjalan di background.
    if (hasClosingLabel) {
      try {
        const { onClosingDetected } = require('./learning_service');
        // Ambil agent_id dari store jika tersedia
        let agentId = null;
        try {
          const { Store } = require('../models/index');
          const store = await Store.findOne({ where: { wa_id: storeWaId } });
          agentId = store?.agent_id || null;
        } catch (_) {}

        // Jalankan di background — tidak block response utama
        onClosingDetected(storeWaId, contactId, agentId)
          .catch(e => logger.warn(`[SmartLabel] Learning trigger error: ${e.message}`));

        logger.info(`[SmartLabel] 🧠 Learning trigger fired untuk [${contactId}]`);
      } catch (learningErr) {
        // Non-critical — jangan sampai crash flow label
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
      // ════════════════════════════════════════════════════════════
      // FIX #1 — IDEMPOTENCY GUARD FOR CLOSING (diperkuat)
      // Jika label Closing sudah pernah dicatat sebelumnya,
      // JANGAN timpa timestamp-nya. Ini menjaga konsistensi
      // tanggal closing di analitik.
      // ════════════════════════════════════════════════════════════
      let existingTimestamps = {};
      try {
        existingTimestamps = JSON.parse(record.label_timestamps || '{}');
      } catch (_) {}

      // FIX #4 — IMMUTABLE LABEL LOCK
      // Jika record sudah punya label immutable (Closing / Cancel),
      // label-label funnel (AI Lead Aktif, Menunggu Rekap, dst.) TIDAK BOLEH
      // menimpa atau menggantikannya. Ini mencegah label Closing turun kembali
      // ke "AI Lead Aktif" saat bot follow-up atau summary di-regenerate.
      let existingLabels = [];
      try {
        existingLabels = JSON.parse(record.wa_labels || '[]');
      } catch (_) {}

      const hasImmutableLabel = existingLabels.some(l => IMMUTABLE_LABELS.has(l));

      // Jika sudah locked: filter label baru — hanya izinkan label non-funnel
      // (misal: bisa tambah "COD" ke kontak yang sudah "Closing", tapi tidak
      //  boleh tambah "AI Lead Aktif" atau "Menunggu Rekap")
      let effectiveLabelNames = labelNames;
      if (hasImmutableLabel) {
        const incomingFunnelLabels = labelNames.filter(l => FUNNEL_LABELS.has(l));
        if (incomingFunnelLabels.length > 0) {
          logger.info(`[SmartLabel] 🔒 Label LOCK aktif untuk [${contactId}] — menolak downgrade funnel: ${incomingFunnelLabels.join(', ')}`);
          effectiveLabelNames = labelNames.filter(l => !FUNNEL_LABELS.has(l));
          // Jika tidak ada label tersisa yang valid, tidak perlu update sama sekali
          if (effectiveLabelNames.length === 0) return;
        }
      }

      // FIX #2 — FULL MERGE (tidak pernah hapus timestamp lama)
      // Gabungkan semua timestamp lama dengan yang baru.
      // Label baru mendapat timestamp sekarang,
      // label lama TETAP mempertahankan timestamp aslinya.
      const mergedTimestamps = { ...existingTimestamps };
      for (const lbl of effectiveLabelNames) {
        if (!mergedTimestamps[lbl]) {
          // Label baru: catat sekarang
          mergedTimestamps[lbl] = Date.now();
        }
        // Jika sudah ada: JANGAN UBAH (idempotent)
      }

      // Gabungkan wa_labels: pertahankan label lama yang masih relevan
      // (label baru di-append, tidak replace total)
      const mergedLabels = [...new Set([...existingLabels, ...effectiveLabelNames])];

      record.wa_labels = JSON.stringify(mergedLabels);
      record.label_timestamps = JSON.stringify(mergedTimestamps);
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
async function _applyLabelsToWA(storeWaId, contactId, labelsToApply, summaryText, waClient, crossCheckRemoveLabels = []) {
  const { safeAddLabelByName } = require('./wajs_bridge');

  // Jika status closing, hapus label yang tidak relevan dulu
  if (isClosingStatus(summaryText)) {
    await _removeStaleLabels(storeWaId, contactId, waClient, LABELS_TO_REMOVE_ON_CLOSING);
  } else if (isCancelStatus(summaryText)) {
    await _removeStaleLabels(storeWaId, contactId, waClient, LABELS_TO_REMOVE_ON_CANCEL);
  }

  // 🔍 Fase 1 — Cross-Validation: hapus label yang dikoreksi dari WA contact
  //    (misal: Transfer→COD setelah cross-check — label "Transfer" harus dihapus dari WA)
  if (crossCheckRemoveLabels && crossCheckRemoveLabels.length > 0) {
    try {
      const { getLabels, addOrRemoveLabels } = require('./wajs_bridge');
      const allLabels = await getLabels(waClient, storeWaId);

      const removeOps = allLabels
        .filter(l => crossCheckRemoveLabels.some(n => n.toLowerCase() === (l.name || '').toLowerCase()))
        .map(l => ({ labelId: l.id, type: 'remove' }));

      if (removeOps.length > 0) {
        await addOrRemoveLabels(waClient, contactId, removeOps, storeWaId);
        logger.info(`[SmartLabel] 🔄 Cross-validation: dihapus ${removeOps.length} label yang dikoreksi dari WA [${contactId}]: ${crossCheckRemoveLabels.join(', ')}`);
      }
    } catch (e) {
      logger.warn(`[SmartLabel] Gagal hapus label cross-validation dari WA: ${e.message}`);
    }
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
      const { ChatSummary } = require('../models/index');
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
    const { ChatSummary } = require('../models/index');
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

/**
 * Update label kontak di DB (tambah/hapus manual).
 */
async function updateContactLabelsInDb(storeWaId, contactId, { add = [], remove = [] } = {}) {
  const { ChatSummary } = require('../models/index');
  const [record] = await ChatSummary.findOrCreate({
    where: { store_wa_id: storeWaId, contact_id: contactId },
    defaults: { wa_labels: '[]', label_timestamps: '{}' },
  });

  let existing = [];
  let timestamps = {};
  try { existing = JSON.parse(record.wa_labels || '[]'); } catch (_) {}
  try { timestamps = JSON.parse(record.label_timestamps || '{}'); } catch (_) {}

  const removeLower = remove.map((r) => String(r).toLowerCase());
  let merged = existing.filter((l) => !removeLower.includes(String(l).toLowerCase()));

  for (const lbl of add) {
    const clean = String(lbl).trim();
    if (!clean) continue;
    if (!merged.find((l) => String(l).toLowerCase() === clean.toLowerCase())) {
      merged.push(clean);
      timestamps[clean] = Date.now();
    }
  }

  record.wa_labels = JSON.stringify(merged);
  record.label_timestamps = JSON.stringify(timestamps);
  await record.save();
  return merged;
}

/**
 * Terapkan label manual ke WA + DB (dua arah sinkron dari web app).
 */
async function applyManualLabelOps(storeWaId, contactId, { add = [], remove = [] } = {}, waClient = null) {
  const { getLabels, addOrRemoveLabels, ensureLabel } = require('./wajs_bridge');

  if (waClient) {
    const allLabels = await getLabels(waClient, storeWaId);
    const ops = [];

    for (const name of add) {
      const clean = String(name).trim();
      if (!clean) continue;
      let lbl = allLabels.find((l) => String(l.name || '').toLowerCase() === clean.toLowerCase());
      if (!lbl) {
        lbl = await ensureLabel(waClient, clean, 0, storeWaId);
        allLabels.push(lbl);
      }
      ops.push({ labelId: lbl.id, type: 'add' });
    }

    for (const name of remove) {
      const clean = String(name).trim();
      if (!clean) continue;
      const lbl = allLabels.find((l) => String(l.name || '').toLowerCase() === clean.toLowerCase());
      if (lbl) ops.push({ labelId: lbl.id, type: 'remove' });
    }

    if (ops.length > 0) {
      await addOrRemoveLabels(waClient, contactId, ops, storeWaId);
    }
  }

  return updateContactLabelsInDb(storeWaId, contactId, { add, remove });
}

/**
 * Tarik label dari WA real → simpan ke DB (sinkronisasi WA → web app).
 */
async function syncLabelsFromWa(storeWaId, contactId, waClient) {
  if (!waClient) throw new Error('WhatsApp client tidak aktif.');

  const { getChatLabels } = require('./wajs_bridge');
  const waLabels = await getChatLabels(waClient, contactId, storeWaId);
  const labelNames = waLabels.map((l) => l.name).filter(Boolean);

  const { ChatSummary } = require('../models/index');
  const [record] = await ChatSummary.findOrCreate({
    where: { store_wa_id: storeWaId, contact_id: contactId },
    defaults: { wa_labels: '[]', label_timestamps: '{}' },
  });

  let timestamps = {};
  try { timestamps = JSON.parse(record.label_timestamps || '{}'); } catch (_) {}
  for (const name of labelNames) {
    if (!timestamps[name]) timestamps[name] = Date.now();
  }

  record.wa_labels = JSON.stringify(labelNames);
  record.label_timestamps = JSON.stringify(timestamps);
  await record.save();

  return { labels: labelNames, waLabels };
}

module.exports = {
  applyLabelsFromSummary,
  detectLabelFromSummary,
  parseWaLabelsField,
  isClosingStatus,
  isCancelStatus,
  isClosingDataComplete,
  validateMetodeBayarConsistency,
  getLabelsFromDb,
  updateContactLabelsInDb,
  applyManualLabelOps,
  syncLabelsFromWa,
  STATUS_LABEL_MAP,
};
