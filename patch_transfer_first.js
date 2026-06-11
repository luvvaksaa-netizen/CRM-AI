/**
 * patch_transfer_first.js
 * Update semua BotAgents di production DB dengan kebijakan Transfer-First:
 * - Default rekap = NON COD (Transfer)
 * - COD hanya jika customer EKSPLISIT minta
 * - Tanya metode bayar SETELAH ongkir diketahui, bukan di awal
 * - Validasi bukti transfer via Vision AI sebagai trigger closing
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database-production.sqlite');
console.log(`🔗 Menghubungkan ke: ${dbPath}`);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) { console.error('❌ Gagal koneksi:', err.message); process.exit(1); }
});

db.all('SELECT id, name, system_prompt, product_knowledge FROM BotAgents', (err, rows) => {
  if (err) { console.error('❌ Gagal ambil data:', err.message); process.exit(1); }

  console.log(`\n📊 Ditemukan ${rows.length} agent. Mulai patching...\n`);
  let updatedCount = 0;

  rows.forEach(row => {
    let sp = row.system_prompt || '';
    let pk = row.product_knowledge || '';
    let modified = false;
    const changes = [];

    // ─────────────────────────────────────────────────
    // PATCH 1: Urutan gali kebutuhan — hapus tanya metode bayar di tengah
    // ─────────────────────────────────────────────────

    // Pola lama: tanya COD/Transfer sebelum alamat (banyak varian)
    const oldOrderPatterns = [
      /f\) Cara pembayaran: COD atau Transfer\?[\s\S]*?⚠️ Jika pesanan.*?DP minimal 50%\./g,
      /f\) Cara pembayaran: COD atau Transfer\?[\s\S]*?DP minimal 50%\.\n/g,
      /⚠️ Jika customer memesan.*?WAJIB TRANSFER.*?\n/g,
    ];

    for (const pattern of oldOrderPatterns) {
      if (pattern.test(sp)) {
        sp = sp.replace(pattern, '⚠️ Tanyakan metode pembayaran (COD/Transfer) SETELAH ongkir disampaikan ke customer. COD hanya jika customer EKSPLISIT meminta.\n');
        modified = true;
        changes.push('Urutan gali kebutuhan (hapus tanya COD dini)');
        break;
      }
    }

    // ─────────────────────────────────────────────────
    // PATCH 2: Aturan rekap — tambahkan default NON COD
    // ─────────────────────────────────────────────────
    const TRANSFER_FIRST_NOTE = `
⚠️ ATURAN TRANSFER-FIRST (WAJIB):
• DEFAULT pengiriman di rekap adalah NON COD (Transfer) kecuali customer EKSPLISIT minta COD.
• JANGAN tulis COD di rekap jika customer belum bilang apapun soal metode bayar.
• COD hanya diaktifkan jika customer bilang: "COD", "bayar di tempat", "bayar pas datang".
• Jika rekap sudah COD tapi customer transfer → UPDATE ke NON COD dan ikuti alur Transfer.
• Tanya metode bayar HANYA setelah ongkir disampaikan, bukan di awal percakapan.`;

    // Cek apakah sudah ada aturan transfer-first
    if (!sp.includes('TRANSFER-FIRST') && !sp.includes('DEFAULT pengiriman') && !sp.includes('Transfer adalah DEFAULT')) {
      // Inject setelah bagian REKAP atau sebelum LANGKAH CLOSING
      if (sp.includes('LANGKAH 7 — REKAP') || sp.includes('LANGKAH 7 — UPSELLING')) {
        // Agent UV-style: rekap di langkah 7
        sp = sp.replace(
          /LANGKAH 7 — REKAP[\s\S]*?format persis berikut:/,
          (match) => match + TRANSFER_FIRST_NOTE
        );
        modified = true;
        changes.push('Inject Transfer-First note (UV style)');
      } else if (sp.includes('LANGKAH 5 — REKAP') || sp.includes('LANGKAH 6 — REKAP')) {
        // Inject sebelum format rekap
        const rekapMatch = sp.match(/LANGKAH \d — REKAP.*?format persis berikut:/s);
        if (rekapMatch) {
          sp = sp.replace(rekapMatch[0], rekapMatch[0] + TRANSFER_FIRST_NOTE);
          modified = true;
          changes.push('Inject Transfer-First note (DTF style)');
        }
      } else {
        // Fallback: inject sebelum bagian Closing
        if (sp.includes('LANGKAH 8 — CLOSING') || sp.includes('LANGKAH 6 — CLOSING')) {
          sp = sp.replace(
            /(LANGKAH \d — CLOSING)/,
            TRANSFER_FIRST_NOTE + '\n\n$1'
          );
          modified = true;
          changes.push('Inject Transfer-First note (before Closing)');
        }
      }
    }

    // ─────────────────────────────────────────────────
    // PATCH 3: Format field Pengiriman di rekap
    // ─────────────────────────────────────────────────
    // Ubah template rekap agar lebih jelas default NON COD
    if (sp.includes('Pengiriman : [COD / NON COD (Transfer)]')) {
      sp = sp.replace(
        /Pengiriman : \[COD \/ NON COD \(Transfer\)\]/g,
        'Pengiriman : [NON COD (Transfer) — DEFAULT, atau COD jika customer EKSPLISIT minta]'
      );
      modified = true;
      changes.push('Update template rekap: default NON COD');
    }

    // ─────────────────────────────────────────────────
    // PATCH 4: Validasi bukti transfer — penguatan Vision AI
    // ─────────────────────────────────────────────────
    const OLD_TAHAP_B_SIMPLE = 'TAHAP B — Saat customer kirim foto/bukti transfer:\nKamu akan menerima: [AI-VISION:';
    const NEW_TAHAP_B_VISION = `TAHAP B — Saat customer kirim foto/bukti transfer:
Kamu akan menerima konteks Vision AI: [AI-VISION: ...struk transfer / screenshot mutasi bank...] atau customer bilang "sudah transfer".

🚨 VALIDASI BUKTI TRANSFER VIA VISION AI:
→ VALID sebagai bukti TF: Vision AI menyebut nominal rupiah, nama bank, tanggal, atau nomor rekening tujuan.
→ TIDAK VALID: foto produk, foto orang, screenshot chat tanpa angka nominal transfer.
→ Jika ragu → tanya: "Maaf bund, ini bukti transfernya ya? Bisa diperjelas nominalnya? 😊"
→ JIKA REKAP SEBELUMNYA COD tapi customer kirim TF → UPDATE Pengiriman ke NON COD otomatis.`;

    if (sp.includes(OLD_TAHAP_B_SIMPLE) && !sp.includes('VALIDASI BUKTI TRANSFER VIA VISION AI')) {
      sp = sp.replace(
        /TAHAP B — Saat customer kirim foto\/bukti transfer:\nKamu akan menerima: \[AI-VISION:/,
        NEW_TAHAP_B_VISION + '\n[AI-VISION:'
      );
      modified = true;
      changes.push('Penguatan validasi bukti transfer via Vision AI');
    }

    // ─────────────────────────────────────────────────
    // PATCH 5: Label closing — Transfer vs COD
    // ─────────────────────────────────────────────────
    // Pastikan label saat bukti TF masuk adalah ["Transfer", "Closing"] bukan ["COD","Closing"]
    if (sp.includes('customer konfirmasi sudah transfer (ada bukti transfer) → "Closing"') ||
        sp.includes('customer konfirmasi sudah transfer') && sp.includes('"Closing"') && !sp.includes('"Transfer", "Closing"')) {
      sp = sp.replace(
        /customer konfirmasi sudah transfer \(ada bukti transfer\) → "Closing"/g,
        'customer kirim bukti transfer valid → ["Transfer", "Closing"] BUKAN ["COD", "Closing"]'
      );
      modified = true;
      changes.push('Fix label closing Transfer');
    }

    // ─────────────────────────────────────────────────
    // PATCH 6: Product Knowledge — aturan COD
    // ─────────────────────────────────────────────────
    if (pk.includes('Mendukung COD jika customer memintanya secara eksplisit.') && 
        !pk.includes('Transfer adalah metode DEFAULT')) {
      pk = pk.replace(
        'Mendukung COD jika customer memintanya secara eksplisit.',
        'Transfer adalah metode DEFAULT — COD hanya tersedia jika customer EKSPLISIT meminta (\"COD\", \"bayar di tempat\", dll).'
      );
      modified = true;
      changes.push('PK: Transfer default, COD eksplisit');
    }

    // ─────────────────────────────────────────────────
    // PATCH 7: Hapus aturan COD lama yang keliru di Langkah 8 (agent lama)
    // ─────────────────────────────────────────────────
    // Beberapa agent lama punya "Jika COD: ...STATUS CLEAR/SELESAI..." yang terlalu cepat close
    if (sp.includes('(JIKA METODE BAYAR ADALAH COD, MAKA STATUS ADALAH CLEAR/SELESAI') ||
        sp.includes('STATUS = SELESAI. JANGAN PERNAH MENYEBUT')) {
      // Tidak dihapus, tapi tambahkan catatan sebelumnya
      if (!sp.includes('COD hanya jika EKSPLISIT')) {
        const clarification = '\n⚠️ COD hanya berlaku jika customer EKSPLISIT memintanya. Default = Transfer.\n';
        sp = sp.replace(
          '(JIKA METODE BAYAR ADALAH COD, MAKA STATUS ADALAH CLEAR/SELESAI',
          clarification + '(JIKA METODE BAYAR ADALAH COD, MAKA STATUS ADALAH CLEAR/SELESAI'
        );
        modified = true;
        changes.push('Tambahkan catatan COD eksplisit di Langkah 8');
      }
    }

    // ─────────────────────────────────────────────────
    // Simpan perubahan ke DB
    // ─────────────────────────────────────────────────
    if (modified) {
      db.run(
        'UPDATE BotAgents SET system_prompt = ?, product_knowledge = ? WHERE id = ?',
        [sp, pk, row.id],
        (err2) => {
          if (err2) {
            console.error(`❌ Gagal update agent ${row.name} (ID:${row.id}):`, err2.message);
          } else {
            console.log(`✅ [ID:${row.id}] ${row.name}`);
            changes.forEach(c => console.log(`   └─ ${c}`));
            updatedCount++;
          }
        }
      );
    } else {
      console.log(`⏭️  [ID:${row.id}] ${row.name} — tidak ada perubahan diperlukan`);
    }
  });

  setTimeout(() => {
    console.log(`\n══════════════════════════════════`);
    console.log(`✅ Selesai! ${updatedCount}/${rows.length} agent diperbarui.`);
    console.log(`📌 Jalankan: pm2 restart <nama_app> untuk terapkan perubahan`);
    console.log(`══════════════════════════════════\n`);
    db.close();
  }, 3000);
});
