/**
 * patch_transfer_first_v2.js
 * Patch kedua: inject Vision TF validation + Transfer-First note ke semua agent
 * yang belum lengkap (Via ID:3, Riska ID:1, Fitri ID:4)
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database-production.sqlite');
console.log('Menghubungkan ke: ' + dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) { console.error('Gagal koneksi:', err.message); process.exit(1); }
});

const TRANSFER_FIRST_NOTE = [
  '',
  'ATURAN TRANSFER-FIRST (WAJIB):',
  'DEFAULT pengiriman di rekap adalah NON COD (Transfer) kecuali customer EKSPLISIT minta COD.',
  'JANGAN tulis COD di rekap jika customer belum bilang apapun soal metode bayar.',
  'COD hanya diaktifkan jika customer bilang: "COD", "bayar di tempat", "bayar pas datang".',
  'Jika rekap sudah COD tapi customer transfer -> UPDATE ke NON COD dan ikuti alur Transfer.',
  'Tanya metode bayar HANYA setelah ongkir disampaikan, bukan di awal percakapan.',
  '',
].join('\n');

const VISION_TF_NOTE = [
  'Kamu akan menerima konteks Vision AI: [AI-VISION: ...struk transfer / screenshot mutasi bank...] atau customer bilang "sudah transfer".',
  '',
  'VALIDASI BUKTI TRANSFER VIA VISION AI:',
  '-> VALID sebagai bukti TF: Vision AI menyebut nominal rupiah, nama bank, tanggal, atau nomor rekening tujuan.',
  '-> TIDAK VALID: foto produk, foto orang, screenshot chat tanpa angka nominal transfer.',
  '-> Jika ragu -> tanya: "Maaf bund, ini bukti transfernya ya? Bisa diperjelas nominalnya?"',
  '-> JIKA REKAP SEBELUMNYA COD tapi customer kirim TF -> UPDATE Pengiriman ke NON COD otomatis.',
  '',
].join('\n');

db.all('SELECT id, name, system_prompt FROM BotAgents', (err, rows) => {
  if (err) { console.error('Gagal ambil data:', err.message); process.exit(1); }

  let pending = rows.length;

  rows.forEach(row => {
    let sp = row.system_prompt || '';
    let modified = false;
    const changes = [];

    // --- PATCH A: Inject Transfer-First note jika belum ada ---
    const hasTFNote = sp.indexOf('TRANSFER-FIRST') !== -1 ||
                      sp.indexOf('Transfer adalah DEFAULT') !== -1 ||
                      sp.indexOf('DEFAULT pengiriman') !== -1;

    if (!hasTFNote) {
      // Cari titik inject: sebelum LANGKAH 8 atau LANGKAH 6 (Closing)
      const markers = [
        'LANGKAH 8 --- COD / TRANSFER',
        'LANGKAH 8 - COD / TRANSFER',
        'LANGKAH 8 \u2014 COD / TRANSFER',
        'LANGKAH 6 \u2014 CLOSING',
        'LANGKAH 6 - CLOSING',
        'LANGKAH 6 --- CLOSING',
      ];

      let injected = false;
      for (const marker of markers) {
        const idx = sp.indexOf(marker);
        if (idx !== -1) {
          sp = sp.substring(0, idx) + TRANSFER_FIRST_NOTE + '\n' + sp.substring(idx);
          modified = true;
          injected = true;
          changes.push('Inject Transfer-First note sebelum ' + marker);
          break;
        }
      }

      if (!injected) {
        // Fallback: append di akhir sebelum baris terakhir
        sp = sp + '\n\n' + TRANSFER_FIRST_NOTE;
        modified = true;
        changes.push('Inject Transfer-First note (fallback append)');
      }
    }

    // --- PATCH B: Inject Vision TF validation jika belum ada ---
    const hasVisionTF = sp.indexOf('VALIDASI BUKTI TRANSFER VIA VISION AI') !== -1;

    if (!hasVisionTF) {
      // Cari titik inject: setelah "TAHAP B" atau setelah "Saat customer mengirim bukti"
      const tahapBMarkers = [
        'TAHAP B \u2014 Saat customer kirim foto/bukti transfer:\nKamu akan menerima:',
        'TAHAP B - Saat customer kirim foto/bukti transfer:\nKamu akan menerima:',
        'customer mengirim bukti transfer/struk',
      ];

      let injected = false;
      for (const marker of tahapBMarkers) {
        const idx = sp.indexOf(marker);
        if (idx !== -1) {
          // Inject setelah newline pertama pada marker
          const afterMarkerEnd = idx + marker.length;
          const nextNewline = sp.indexOf('\n', afterMarkerEnd);
          const insertPos = nextNewline !== -1 ? nextNewline + 1 : afterMarkerEnd;
          sp = sp.substring(0, insertPos) + VISION_TF_NOTE + sp.substring(insertPos);
          modified = true;
          injected = true;
          changes.push('Inject Vision TF validation di TAHAP B');
          break;
        }
      }

      if (!injected) {
        // Cari sekitar kata "bukti transfer" untuk inject
        const btIdx = sp.indexOf('bukti transfer');
        if (btIdx !== -1) {
          // Inject sebelum paragraf yang berisi "bukti transfer"
          const paraStart = sp.lastIndexOf('\n', btIdx) + 1;
          sp = sp.substring(0, paraStart) + VISION_TF_NOTE + '\n' + sp.substring(paraStart);
          modified = true;
          changes.push('Inject Vision TF validation (fallback near bukti transfer)');
        }
      }
    }

    // --- Simpan jika ada perubahan ---
    if (modified) {
      db.run('UPDATE BotAgents SET system_prompt = ? WHERE id = ?', [sp, row.id], (err2) => {
        if (err2) {
          console.error('GAGAL update ID:' + row.id + ' ' + row.name + ': ' + err2.message);
        } else {
          console.log('UPDATED ID:' + row.id + ' ' + row.name);
          changes.forEach(c => console.log('  -> ' + c));
        }
        pending--;
        if (pending === 0) { finalize(); }
      });
    } else {
      console.log('SKIP ID:' + row.id + ' ' + row.name + ' (sudah lengkap)');
      pending--;
      if (pending === 0) { finalize(); }
    }
  });

  function finalize() {
    console.log('\nPatch v2 selesai!');
    db.close();
  }
});
