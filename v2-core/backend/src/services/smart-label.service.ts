/**
 * @file smart-label.service.ts
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

import * as logger from '../utils/logger';

// ══════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════

interface LabelRule {
  pattern: RegExp;
  label: string;
  color: number;
}

interface LabelToApply {
  label: string;
  color: number;
}

interface LabelOps {
  add?: string[];
  remove?: string[];
}

// ══════════════════════════════════════════════════════════════════
// MAPPING: STATUS dari rekap AI → Label WhatsApp Business
// Key: regex yang match teks STATUS (case-insensitive)
// Value: { label, color } — color adalah colorIndex WA (0-19)
// ══════════════════════════════════════════════════════════════════
const STATUS_LABEL_MAP: LabelRule[] = [
  // Hanya menggunakan 3 label utama sesuai permintaan user:
  { pattern: /\bstatus:\s*(closing|selesai)\b/i,           label: 'Closing',           color: 1  }, // Hijau
  { pattern: /\bstatus:\s*(batal|cancel|nggak jadi)\b/i,   label: 'Cancel',            color: 11 }, // Tetap pertahankan cancel untuk filter
  // Label metode pembayaran (diambil jika ditemukan keyword transfer/COD di summary)
  { pattern: /\bmetode\s+bayar:\s*(?:.*\b)?transfer\b/i,   label: 'Transfer',          color: 7  }, // Kuning
  { pattern: /\bmetode\s+pembayaran:\s*(?:.*\b)?transfer\b/i, label: 'Transfer',       color: 7  },
  { pattern: /\bmetode\s+bayar:\s*(?:.*\b)?cod\b/i,        label: 'COD',               color: 6  }, // Orange
  { pattern: /\bmetode\s+pembayaran:\s*(?:.*\b)?cod\b/i,   label: 'COD',               color: 6  }
];


// Label yang DIHAPUS saat status berubah ke closing
const LABELS_TO_REMOVE_ON_CLOSING: string[] = [
  'Cancel'
];

// Label yang DIHAPUS saat status berubah ke cancel
const LABELS_TO_REMOVE_ON_CANCEL: string[] = [
  'Closing', 'Transfer', 'COD'
];

// ══════════════════════════════════════════════════════════════════
// FIX #4 — LABEL LOCK (IMMUTABLE)
// Label-label ini TIDAK BOLEH pernah dihapus atau ditimpa oleh update
// summary berikutnya (misal: saat bot follow-up, label Closing tidak boleh
// berubah menjadi "AI Lead Aktif" hanya karena summary di-regenerate).
// ══════════════════════════════════════════════════════════════════
const IMMUTABLE_LABELS: Set<string> = new Set(['Closing', 'Cancel']);

// Label funnel (status perjalanan) yang BOLEH ditimpa saat status berubah
const FUNNEL_LABELS: Set<string> = new Set([]);

// Field WA_LABELS di rekap — format: WA_LABELS: [label1, label2]
const WA_LABELS_FIELD_RE: RegExp = /^WA_LABELS:\s*\[([^\]]*)\]/im;

// ══════════════════════════════════════════════════════════════════
// PARSER HELPERS
// ══════════════════════════════════════════════════════════════════

/**
 * Deteksi SEMUA label yang cocok berdasarkan teks rekap (Multiple Labels).
 * @param summaryText
 * @returns array of label yang cocok
 */
function detectLabelsFromSummary(summaryText: string): LabelToApply[] {
  if (!summaryText) return [];
  const results: LabelToApply[] = [];
  const seenLabels = new Set<string>();
  
  for (const rule of STATUS_LABEL_MAP) {
    if (rule.pattern.test(summaryText)) {
      if (!seenLabels.has(rule.label)) {
        results.push({ label: rule.label, color: rule.color });
        seenLabels.add(rule.label);
      }
    }
  }
  return results;
}

/**
 * Parse field WA_LABELS dari teks rekap (jika AI memasukkannya secara eksplisit).
 * Format rekap: WA_LABELS: [Closing, Hot Lead]
 * @param summaryText
 * @returns array of label strings
 */
function parseWaLabelsField(summaryText: string): string[] {
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
 * @param summaryText
 * @returns true jika closing
 */
function isClosingStatus(summaryText: string): boolean {
  return /\bstatus:\s*(closing|selesai)\b/i.test(summaryText || '');
}

/**
 * Cek apakah rekap menunjukkan status batal/cancel.
 * @param summaryText
 * @returns true jika cancel
 */
function isCancelStatus(summaryText: string): boolean {
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
 * @param summaryText - Teks rekap dari AI
 * @returns true jika closing boleh diterapkan
 */
function isClosingDataComplete(summaryText: string, contactName?: string, contactPhone?: string): boolean {
  if (!summaryText) return false;
  
  // ════════════════════════════════════════════════════════════
  // FIX SUK-59 #2: DB-LEVEL VALIDATION — jangan izinkan closing
  // jika contact_name masih placeholder atau contact_phone kosong
  // ════════════════════════════════════════════════════════════
  if (contactName) {
    const trimmed = contactName.trim();
    // Whitespace-only atau placeholder name
    if (trimmed.length === 0 || /^(Pelanggan|Customer|Unknown|User|\+?\d{8,})$/.test(trimmed)) {
      logger.warn(`[SmartLabel] ⚠️ Closing DIBLOKIR — contact_name tidak valid: "${trimmed || '(whitespace only)'}"`);
      return false;
    }
  }
  if (contactPhone && !contactPhone.trim()) {
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

// ══════════════════════════════════════════════════════════════════
// MAIN ENGINE
// ══════════════════════════════════════════════════════════════════

/**
 * Terapkan label WA berdasarkan rekap AI + simpan ke DB untuk visibilitas dashboard.
 * Operasi ini non-blocking — dipanggil dengan .catch() oleh message_handler.
 *
 * @param storeWaId     - WA ID toko (untuk lookup client WA)
 * @param contactId     - JID pelanggan
 * @param summaryText   - Teks rekap dari generateChatSummary
 * @param waClient      - WWebJS client (opsional, bisa null jika tidak tersedia)
 */
async function applyLabelsFromSummary(
  storeWaId: string,
  contactId: string,
  summaryText: string,
  waClient: any = null
): Promise<void> {
  try {
    const { ChatSummary } = require('../models/index');

    // FIX SUK-59 #2: Load existing summary for DB-level validation
    const existingSummary = await ChatSummary.findOne({ where: { store_wa_id: storeWaId, contact_id: contactId } });
    const contactName: string | undefined = existingSummary?.contact_name;
    const contactPhone: string | undefined = existingSummary?.contact_phone;

    // 1. Deteksi label dari STATUS & METODE BAYAR field
    let detectedRules = detectLabelsFromSummary(summaryText);

    // FIX #3: Jika label yang terdeteksi ada Closing, validasi kelengkapan data dulu
    const hasClosingRule = detectedRules.find(r => r.label === 'Closing');
    if (hasClosingRule) {
      if (!isClosingDataComplete(summaryText, contactName, contactPhone)) {
        // Data belum lengkap — buang label Closing
        detectedRules = detectedRules.filter(r => r.label !== 'Closing');
        logger.warn(`[SmartLabel] [${storeWaId}] Label Closing dibatalkan untuk [${contactId}] karena data belum lengkap.`);
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

    // Gabungkan: label dari STATUS + explicit labels dari AI
    const labelsToApply: LabelToApply[] = [...detectedRules];

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

    // 5. 🧠 LEARNING BOT TRIGGER — Jika ada label Closing, analisis percakapan
    //    untuk ekstrak pola sukses. Non-blocking, berjalan di background.
    const hasClosingLabel = labelNames.some(l => l.toLowerCase() === 'closing');
    if (hasClosingLabel) {
      try {
        const { onClosingDetected } = require('./learning_service');
        // Ambil agent_id dari store jika tersedia
        let agentId: string | null = null;
        try {
          const { Store } = require('../models/index');
          const store = await Store.findOne({ where: { wa_id: storeWaId } });
          agentId = store?.agent_id || null;
        } catch (_) {}

        // Jalankan di background — tidak block response utama
        onClosingDetected(storeWaId, contactId, agentId)
          .catch((e: any) => logger.warn(`[SmartLabel] Learning trigger error: ${e.message}`));

        logger.info(`[SmartLabel] 🧠 Learning trigger fired untuk [${contactId}]`);
      } catch (learningErr: any) {
        // Non-critical — jangan sampai crash flow label
        logger.warn(`[SmartLabel] Gagal trigger learning: ${learningErr.message}`);
      }
    }

  } catch (err: any) {
    // Non-critical — jangan crash flow utama
    logger.warn(`[SmartLabel] Gagal apply label untuk [${contactId}]: ${err.message}`);
  }
}

/**
 * Simpan label aktif ke kolom `wa_labels` di ChatSummary.
 * @param storeWaId
 * @param contactId
 * @param labelNames
 * @param ChatSummary - Sequelize model
 */
async function _persistLabelsToDb(
  storeWaId: string,
  contactId: string,
  labelNames: string[],
  ChatSummary: any
): Promise<void> {
  try {
    const defaultTimestamps: Record<string, number> = labelNames.reduce((acc, lbl) => { acc[lbl] = Date.now(); return acc; }, {} as Record<string, number>);
    
    let record = null;
    try {
      const [found] = await ChatSummary.findOrCreate({
        where: { store_wa_id: storeWaId, contact_id: contactId },
        defaults: { 
          wa_labels: JSON.stringify(labelNames),
          label_timestamps: JSON.stringify(defaultTimestamps)
        }
      });
      record = found;
    } catch (err: any) {
      logger.warn(`[SmartLabel] Gagal findOrCreate ChatSummary untuk ${contactId}: ${err.message}. Mengabaikan SQLITE_BUSY.`);
    }

    if (record) {
      // ════════════════════════════════════════════════════════════
      // FIX #1 — IDEMPOTENCY GUARD FOR CLOSING (diperkuat)
      // Jika label Closing sudah pernah dicatat sebelumnya,
      // JANGAN timpa timestamp-nya. Ini menjaga konsistensi
      // tanggal closing di analitik.
      // ════════════════════════════════════════════════════════════
      let existingTimestamps: Record<string, number> = {};
      try {
        existingTimestamps = JSON.parse(record.label_timestamps || '{}');
      } catch (_) {}

      // FIX #4 — IMMUTABLE LABEL LOCK
      // Jika record sudah punya label immutable (Closing / Cancel),
      // label-label funnel (AI Lead Aktif, Menunggu Rekap, dst.) TIDAK BOLEH
      // menimpa atau menggantikannya. Ini mencegah label Closing turun kembali
      // ke "AI Lead Aktif" saat bot follow-up atau summary di-regenerate.
      let existingLabels: string[] = [];
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
      const mergedTimestamps: Record<string, number> = { ...existingTimestamps };
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
  } catch (e: any) {
    logger.warn(`[SmartLabel] Gagal simpan label ke DB: ${e.message}`);
  }
}

/**
 * Terapkan/update label ke WhatsApp Business via WA-JS bridge.
 * @param storeWaId
 * @param contactId
 * @param labelsToApply
 * @param summaryText
 * @param waClient
 */
async function _applyLabelsToWA(
  storeWaId: string,
  contactId: string,
  labelsToApply: LabelToApply[],
  summaryText: string,
  waClient: any
): Promise<void> {
  const { safeAddLabelByName } = require('./wajs_bridge');

  // Jika status closing, hapus label yang tidak relevan dulu
  if (isClosingStatus(summaryText)) {
    await _removeStaleLabels(storeWaId, contactId, waClient, LABELS_TO_REMOVE_ON_CLOSING);
  } else if (isCancelStatus(summaryText)) {
    await _removeStaleLabels(storeWaId, contactId, waClient, LABELS_TO_REMOVE_ON_CANCEL);
  }

  // Terapkan setiap label yang terdeteksi
  for (const { label, color } of labelsToApply) {
    try {
      await safeAddLabelByName(waClient, contactId, label, color, storeWaId);
      logger.info(`[SmartLabel] ✅ Label WA "${label}" diterapkan ke [${contactId}] (${storeWaId})`);
    } catch (e: any) {
      logger.warn(`[SmartLabel] Gagal terapkan label WA "${label}": ${e.message}`);
    }
  }
}

/**
 * Hapus label WA yang sudah tidak relevan dari kontak.
 * Dipanggil saat status berubah ke closing agar tidak ada label ganda yang membingungkan.
 * @param storeWaId
 * @param contactId
 * @param waClient
 * @param labelNamesToRemove
 */
async function _removeStaleLabels(
  storeWaId: string,
  contactId: string,
  waClient: any,
  labelNamesToRemove: string[]
): Promise<void> {
  try {
    // Hapus dari WhatsApp Business
    const { getLabels, addOrRemoveLabels } = require('./wajs_bridge');
    const allLabels = await getLabels(waClient, storeWaId);

    const removeOps = allLabels
      .filter((l: any) => labelNamesToRemove.some(n => n.toLowerCase() === (l.name || '').toLowerCase()))
      .map((l: any) => ({ labelId: l.id, type: 'remove' }));

    if (removeOps.length > 0) {
      await addOrRemoveLabels(waClient, contactId, removeOps, storeWaId);
      logger.info(`[SmartLabel] Dihapus ${removeOps.length} label lama dari WA [${contactId}]`);
    }

    // Sinkronisasi ke DB: hapus label stale dari wa_labels di ChatSummary
    try {
      const { ChatSummary } = require('../models/index');
      const record = await ChatSummary.findOne({ where: { store_wa_id: storeWaId, contact_id: contactId } });
      if (record) {
        let currentLabels: string[] = [];
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
    } catch (dbErr: any) {
      logger.warn(`[SmartLabel] Gagal sinkronisasi hapus label ke DB: ${dbErr.message}`);
    }
  } catch (e: any) {
    // Non-critical — label removal is best-effort
    logger.warn(`[SmartLabel] Gagal hapus label lama: ${e.message}`);
  }
}

/**
 * Ambil label aktif dari DB (untuk API dashboard tanpa hit WA-JS).
 * @param storeWaId
 * @param contactId
 * @returns array of label strings
 */
async function getLabelsFromDb(storeWaId: string, contactId: string): Promise<string[]> {
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
async function updateContactLabelsInDb(
  storeWaId: string,
  contactId: string,
  { add = [], remove = [] }: LabelOps = {}
): Promise<string[]> {
  const { ChatSummary } = require('../models/index');
  const [record] = await ChatSummary.findOrCreate({
    where: { store_wa_id: storeWaId, contact_id: contactId },
    defaults: { wa_labels: '[]', label_timestamps: '{}' },
  });

  let existing: string[] = [];
  let timestamps: Record<string, number> = {};
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
async function applyManualLabelOps(
  storeWaId: string,
  contactId: string,
  { add = [], remove = [] }: LabelOps = {},
  waClient: any = null
): Promise<string[]> {
  const { getLabels, addOrRemoveLabels, ensureLabel } = require('./wajs_bridge');

  if (waClient) {
    const allLabels = await getLabels(waClient, storeWaId);
    const ops: Array<{ labelId: any; type: string }> = [];

    for (const name of add) {
      const clean = String(name).trim();
      if (!clean) continue;
      let lbl = allLabels.find((l: any) => String(l.name || '').toLowerCase() === clean.toLowerCase());
      if (!lbl) {
        lbl = await ensureLabel(waClient, clean, 0, storeWaId);
        allLabels.push(lbl);
      }
      ops.push({ labelId: lbl.id, type: 'add' });
    }

    for (const name of remove) {
      const clean = String(name).trim();
      if (!clean) continue;
      const lbl = allLabels.find((l: any) => String(l.name || '').toLowerCase() === clean.toLowerCase());
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
async function syncLabelsFromWa(
  storeWaId: string,
  contactId: string,
  waClient: any
): Promise<{ labels: string[]; waLabels: any[] }> {
  if (!waClient) throw new Error('WhatsApp client tidak aktif.');

  const { getChatLabels } = require('./wajs_bridge');
  const waLabels = await getChatLabels(waClient, contactId, storeWaId);
  const labelNames = waLabels.map((l: any) => l.name).filter(Boolean);

  const { ChatSummary } = require('../models/index');
  let record = null;
  try {
    const [found] = await ChatSummary.findOrCreate({
      where: { store_wa_id: storeWaId, contact_id: contactId },
      defaults: { wa_labels: '[]', label_timestamps: '{}' },
    });
    record = found;
  } catch (err: any) {
    logger.warn(`[SmartLabel] Gagal findOrCreate ChatSummary untuk ${contactId}: ${err.message}. Mengabaikan SQLITE_BUSY.`);
  }

  if (record) {
    let timestamps: Record<string, number> = {};
    try { timestamps = JSON.parse(record.label_timestamps || '{}'); } catch (_) {}
    for (const name of labelNames) {
      if (!timestamps[name]) timestamps[name] = Date.now();
    }

    record.wa_labels = JSON.stringify(labelNames);
    record.label_timestamps = JSON.stringify(timestamps);
    await record.save();
  }

  return { labels: labelNames, waLabels };
}

export {
  applyLabelsFromSummary,
  detectLabelsFromSummary,
  parseWaLabelsField,
  isClosingStatus,
  isCancelStatus,
  isClosingDataComplete,
  getLabelsFromDb,
  updateContactLabelsInDb,
  applyManualLabelOps,
  syncLabelsFromWa,
  STATUS_LABEL_MAP,
};
