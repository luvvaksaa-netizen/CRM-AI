const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Pastikan file ini dijalankan di dalam folder utama project (sejajar dengan package.json)
// atau ubah path di bawah ini mengarah ke file database production.
const dbPath = path.join(__dirname, 'database.sqlite'); 

console.log(`Menghubungkan ke database: ${dbPath}`);
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Gagal terhubung ke database:', err.message);
    process.exit(1);
  }
});

db.all('SELECT id, name, product_knowledge FROM BotAgents', (err, rows) => {
  if (err) {
    console.error('Gagal mengambil data BotAgents:', err.message);
    process.exit(1);
  }
  
  let updatedCount = 0;
  
  rows.forEach(row => {
    if (!row.product_knowledge) return;
    
    let pk = row.product_knowledge;
    let modified = false;
    
    // Perbaikan nama label gambar bundling agar sesuai dengan isi MediaAssets
    if (pk.includes('Paket Bundling Back to School')) {
        pk = pk.replace(/"Paket Bundling Back to School"/g, '"bundling upsell"');
        modified = true;
    }
    
    // Pencegahan AI menawarkan promo saat customer hanya mengeluh ongkir
    if (pk.includes('Tawarkan HANYA SEKALI setelah customer konfirmasi pesan utama.')) {
        pk = pk.replace(
            /Tawarkan HANYA SEKALI setelah customer konfirmasi pesan utama\./g, 
            'Tawarkan HANYA SEKALI SETELAH customer MENGONFIRMASI/DEAL pesanan utama. JANGAN PERNAH tawarkan promo ini hanya karena customer bertanya/keberatan tentang ongkir! Promo ini murni UPSELL di akhir.'
        );
        modified = true;
    }
    
    if (modified) {
        db.run('UPDATE BotAgents SET product_knowledge = ? WHERE id = ?', [pk, row.id], (err2) => {
            if (err2) {
                console.error(`Gagal update agen ${row.name}:`, err2.message);
            } else {
                console.log(`[SUKSES] Diperbarui agen: ${row.name}`);
                updatedCount++;
            }
        });
    }
  });
  
  // Tunggu sebentar agar semua operasi UPDATE selesai
  setTimeout(() => {
    console.log(`\nSelesai! Total ${updatedCount} agen telah diperbarui.`);
    console.log('Silakan jalankan perintah `pm2 restart [nama_app_anda]` untuk menerapkan perubahan pada bot WhatsApp.');
    db.close();
  }, 2000);
});
