#!/usr/bin/env node
/**
 * Migration Script: Backfill wa_labels & label_timestamps dari summary text.
 * 
 * Untuk data lama yang sudah punya summary text (misal STATUS: Closing)
 * tapi belum punya wa_labels (masih '[]'), script ini akan:
 * 1. Baca summary text → deteksi status via regex
 * 2. Isi wa_labels dengan label yang sesuai
 * 3. Isi label_timestamps dengan waktu last_updated sebagai fallback
 * 
 * USAGE: node scripts/migrate_labels.js
 * SAFE: Tidak menimpa data yang sudah ada di wa_labels
 */

'use strict';

const path = require('path');

// Ensure we load from project root
process.chdir(path.join(__dirname, '..'));

const STATUS_LABEL_MAP = [
  { pattern: /\bstatus:\s*(closing|selesai)\b/i,       label: 'Closing' },
  { pattern: /\bstatus:\s*menunggu\s*transfer\b/i,     label: 'Menunggu Transfer' },
  { pattern: /\bstatus:\s*menunggu\s*rekap\b/i,        label: 'Menunggu Rekap' },
  { pattern: /\bstatus:\s*menunggu\s*alamat\b/i,       label: 'Menunggu Alamat' },
  { pattern: /\bstatus:\s*negosiasi\b/i,               label: 'Hot Lead' },
  { pattern: /\bstatus:\s*gali\s*kebutuhan\b/i,        label: 'AI Lead Aktif' },
  { pattern: /\bstatus:\s*opening\b/i,                 label: 'AI Lead Baru' },
];

function detectLabelsFromText(summaryText) {
  if (!summaryText) return [];
  const labels = [];
  for (const rule of STATUS_LABEL_MAP) {
    if (rule.pattern.test(summaryText)) {
      labels.push(rule.label);
      break; // Hanya satu status utama per kontak
    }
  }
  return labels;
}

async function main() {
  const { initDB, ChatSummary } = require('../src/database/index');
  
  console.log('🔄 Menginisialisasi database...');
  await initDB();
  
  const allSummaries = await ChatSummary.findAll();
  console.log(`📊 Total records: ${allSummaries.length}`);
  
  let updated = 0;
  let skipped = 0;
  let noStatus = 0;
  
  for (const record of allSummaries) {
    // Skip jika sudah punya wa_labels yang terisi
    let existingLabels = [];
    try { existingLabels = JSON.parse(record.wa_labels || '[]'); } catch(_) {}
    
    if (existingLabels.length > 0) {
      skipped++;
      continue;
    }
    
    // Deteksi label dari summary text
    const labels = detectLabelsFromText(record.summary);
    
    if (labels.length === 0) {
      noStatus++;
      continue;
    }
    
    // Gunakan last_updated sebagai timestamp label (fallback terbaik untuk data lama)
    const labelTime = new Date(record.last_updated || record.createdAt).getTime();
    const timestamps = {};
    for (const lbl of labels) {
      timestamps[lbl] = labelTime;
    }
    
    record.wa_labels = JSON.stringify(labels);
    record.label_timestamps = JSON.stringify(timestamps);
    await record.save();
    
    updated++;
    console.log(`  ✅ [${record.contact_name || record.contact_id}] → ${labels.join(', ')}`);
  }
  
  console.log('\n════════════════════════════════════');
  console.log(`✅ Berhasil diupdate : ${updated}`);
  console.log(`⏭️  Sudah ada label   : ${skipped}`);
  console.log(`⚪ Tidak ada status  : ${noStatus}`);
  console.log(`📊 Total             : ${allSummaries.length}`);
  console.log('════════════════════════════════════');
  
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Migration gagal:', err.message);
  process.exit(1);
});
