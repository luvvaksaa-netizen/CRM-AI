const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite'); 
console.log(`Menghubungkan ke database: ${dbPath}`);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Gagal terhubung ke database:', err.message);
    process.exit(1);
  }
});

db.all('SELECT id, name, system_prompt, product_knowledge FROM BotAgents', (err, rows) => {
  if (err) {
    console.error('Gagal mengambil data BotAgents:', err.message);
    process.exit(1);
  }
  
  let updatedCount = 0;
  
  rows.forEach(row => {
    let sp = row.system_prompt || '';
    let pk = row.product_knowledge || '';
    let modified = false;

    // --- PATCH SYSTEM PROMPT ---
    
    // Draconian Rules COD Limit
    if (sp.includes('DILARANG KERAS menerima COD untuk pesanan 3 paket (150 pcs) atau lebih.')) {
        sp = sp.replace(
            /DILARANG KERAS menerima COD untuk pesanan 3 paket \(150 pcs\) atau lebih\./g, 
            'DILARANG KERAS menerima COD murni untuk pesanan > 2 paket ATAU pengiriman ke luar Pulau Jawa (>1 paket). Jika memenuhi kondisi ini, WAJIB Transfer Lunas atau DP minimal 50%.'
        );
        modified = true;
    }

    // Gali Kebutuhan (Langkah 2)
    if (sp.includes('⚠️ Jika customer memesan >= 3 PAKET → WAJIB TRANSFER, tidak bisa COD')) {
        sp = sp.replace(
            /⚠️ Jika customer memesan >= 3 PAKET → WAJIB TRANSFER, tidak bisa COD/g, 
            '⚠️ Jika pesanan > 2 paket ATAU alamat di luar Pulau Jawa (kecuali luar Jawa tapi cuma 1 paket), WAJIB Transfer Lunas atau DP minimal 50%.'
        );
        modified = true;
    }
    // Gali Kebutuhan (Langkah 4 UV)
    if (sp.includes('⚠️ Jika customer memesan >= 3 PAKET → WAJIB TRANSFER, tidak bisa COD.')) {
        sp = sp.replace(
            /⚠️ Jika customer memesan >= 3 PAKET → WAJIB TRANSFER, tidak bisa COD\./g, 
            '⚠️ Jika pesanan > 2 paket ATAU alamat di luar Pulau Jawa (kecuali luar Jawa tapi cuma 1 paket), WAJIB Transfer Lunas atau DP minimal 50%.'
        );
        modified = true;
    }

    // Format Rekap (Langkah 5)
    if (sp.includes('Total Harus Dibayar : Rp [Total]\nCatatan')) {
        sp = sp.replace(
            /Total Harus Dibayar : Rp \[Total\]\nCatatan/g, 
            'Total Harus Dibayar : Rp [Total]\nTotal Terbayar (DP) : Rp [Jumlah DP jika ada, atau 0]\nSisa Bayar (COD) : Rp [Sisa pembayaran]\nCatatan'
        );
        modified = true;
    }

    // Tahap B (Bukti Transfer DP)
    if (sp.includes('TAHAP B — Saat customer kirim foto/bukti transfer:\nKamu akan menerima: [AI-VISION: ...struk transfer...] atau customer bilang "sudah transfer".\n→ WAJIB VALIDASI')) {
        sp = sp.replace(
            /TAHAP B — Saat customer kirim foto\/bukti transfer:\nKamu akan menerima: \[AI-VISION: \.\.\.struk transfer\.\.\.\] atau customer bilang "sudah transfer"\.\n→ WAJIB VALIDASI/g, 
            'TAHAP B — Saat customer kirim foto/bukti transfer:\nKamu akan menerima: [AI-VISION: ...struk transfer...] atau customer bilang "sudah transfer".\n→ KHUSUS UNTUK DP: Ekstrak nominal yang dibayar dari struk transfer. JANGAN masukkan biaya admin bank. Catat di "Total Terbayar (DP)" dan hitung "Sisa Bayar (COD)". Pengiriman tetap dicatat sebagai COD.\n→ JIKA LUNAS: Pengiriman dicatat sebagai NON COD (Transfer).\n→ WAJIB VALIDASI'
        );
        modified = true;
    }
    // Tahap B UV
    if (sp.includes('TAHAP B — Saat customer kirim foto/bukti transfer:\n→ VALIDASI')) {
        sp = sp.replace(
            /TAHAP B — Saat customer kirim foto\/bukti transfer:\n→ VALIDASI/g, 
            'TAHAP B — Saat customer kirim foto/bukti transfer:\n→ KHUSUS UNTUK DP: Ekstrak nominal yang dibayar dari struk transfer. JANGAN masukkan biaya admin bank. Catat di "Total Terbayar (DP)" dan hitung "Sisa Bayar (COD)". Pengiriman tetap dicatat sebagai COD.\n→ JIKA LUNAS: Pengiriman dicatat sebagai NON COD (Transfer).\n→ VALIDASI'
        );
        modified = true;
    }


    // --- PATCH PRODUCT KNOWLEDGE ---

    // Batasan Huruf DTF
    if (pk.includes('• Batasan Huruf: Maksimal 8 huruf per nama.')) {
        pk = pk.replace(
            /• Batasan Huruf: Maksimal 8 huruf per nama\./g, 
            '• Batasan Huruf: Maksimal 8 huruf per nama. Jika customer ngeyel/memaksa, berikan toleransi maksimal 10 huruf. Berikan penjelasan: "Maksimal segitu biar hasilnya bagus ya bund, karena kalau semakin banyak hurufnya nanti semakin kecil dan jelek jadinya".'
        );
        modified = true;
    }
    // Batasan Huruf UV
    if (pk.includes('• Disarankan maksimal 8 huruf per nama.')) {
        pk = pk.replace(
            /• Disarankan maksimal 8 huruf per nama\./g, 
            '• Maksimal 8 huruf per nama. Jika customer ngeyel/memaksa, berikan toleransi maksimal 10 huruf. Berikan penjelasan: "Maksimal segitu biar hasilnya bagus ya bund, karena kalau semakin banyak hurufnya nanti semakin kecil dan jelek jadinya".'
        );
        modified = true;
    }

    // COD Transfer DTF
    if (pk.includes('• WAJIB TRANSFER jika pesanan >= 3 paket (150 pcs atau lebih).')) {
        pk = pk.replace(
            /• WAJIB TRANSFER jika pesanan >= 3 paket \(150 pcs atau lebih\)\./g, 
            '• WAJIB LUNAS atau DP 50% jika pesanan > 2 paket ATAU pengiriman ke luar Pulau Jawa (>1 paket). (Luar Jawa tapi cuma 1 paket tetap lolos COD murni). Jika DP, pengiriman tetap COD.'
        );
        modified = true;
    }
    // COD Transfer UV
    if (pk.includes('• WAJIB TRANSFER jika pesanan >= 3 paket (180 pcs atau lebih).')) {
        pk = pk.replace(
            /• WAJIB TRANSFER jika pesanan >= 3 paket \(180 pcs atau lebih\)\./g, 
            '• WAJIB LUNAS atau DP 50% jika pesanan > 2 paket ATAU pengiriman ke luar Pulau Jawa (>1 paket). (Luar Jawa tapi cuma 1 paket tetap lolos COD murni). Jika DP, pengiriman tetap COD.'
        );
        modified = true;
    }

    if (modified) {
        db.run('UPDATE BotAgents SET system_prompt = ?, product_knowledge = ? WHERE id = ?', [sp, pk, row.id], (err2) => {
            if (err2) {
                console.error(`Gagal update agen ${row.name}:`, err2.message);
            } else {
                console.log(`[SUKSES] Diperbarui agen: ${row.name}`);
                updatedCount++;
            }
        });
    }
  });
  
  setTimeout(() => {
    console.log(`\nSelesai! Total ${updatedCount} agen telah diperbarui dengan aturan DP & Huruf Nama yang baru.`);
    console.log('Silakan jalankan perintah `pm2 restart [nama_app_anda]` untuk menerapkan perubahan pada bot WhatsApp.');
    db.close();
  }, 2000);
});
