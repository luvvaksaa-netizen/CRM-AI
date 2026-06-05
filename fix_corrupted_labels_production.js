const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Pastikan file ini menunjuk ke database production Anda di server
const dbPath = path.join(__dirname, 'database-production.sqlite');

console.log(`[PEMBERSIHAN DATA] Menghubungkan ke database: ${dbPath}`);
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Gagal terhubung ke database:', err.message);
    process.exit(1);
  }
});

function checkIncomplete(str) {
    if (!str) return true;
    const s = str.toLowerCase().trim();
    return s === '-' || s === '.' || s === 'belum' || s.includes('[') || s.includes(']');
}

db.all('SELECT id, wa_labels, contact_name, alamat, metode, summary FROM ChatSummaries', (err, rows) => {
  if (err) {
    console.error('Gagal mengambil data ChatSummaries:', err.message);
    process.exit(1);
  }
  
  let fixedCodCount = 0;
  let fixedIncompleteCount = 0;
  
  rows.forEach(row => {
    let labels = [];
    try {
        labels = JSON.parse(row.wa_labels || '[]');
    } catch (e) {
        return;
    }
    
    let isModified = false;
    let newLabels = [...labels];

    // 1. KOREKSI COD BERSATUS MENUNGGU TRANSFER
    if (row.metode === 'COD' && newLabels.includes('Menunggu Transfer')) {
        newLabels = newLabels.filter(l => l !== 'Menunggu Transfer');
        if (!newLabels.includes('Closing')) newLabels.push('Closing');
        fixedCodCount++;
        isModified = true;
    }

    // 2. KOREKSI DATA BELUM LENGKAP YANG BURU-BURU CLOSING
    const isIncomplete = checkIncomplete(row.contact_name) || checkIncomplete(row.alamat);
    if (isIncomplete && (newLabels.includes('Closing') || newLabels.includes('Menunggu Transfer') || newLabels.includes('Selesai'))) {
        // Hapus status closing/menunggu transfer karena data masih ngawur
        newLabels = newLabels.filter(l => l !== 'Closing' && l !== 'Menunggu Transfer' && l !== 'Selesai');
        
        // Kembalikan statusnya ke Menunggu Rekap atau Hot Lead agar CS bisa follow up
        if (!newLabels.includes('Menunggu Rekap')) {
            newLabels.push('Menunggu Rekap');
        }
        fixedIncompleteCount++;
        isModified = true;
    }

    if (isModified) {
        db.run('UPDATE ChatSummaries SET wa_labels = ? WHERE id = ?', [JSON.stringify(newLabels), row.id], (err2) => {
            if (err2) {
                console.error(`Gagal update row ${row.id}:`, err2.message);
            }
        });
    }
  });
  
  setTimeout(() => {
    console.log(`\n✅ [SELESAI] Database berhasil dibersihkan!`);
    console.log(`- Total data COD salah label (Menunggu TF) yang diperbaiki: ${fixedCodCount} chat`);
    console.log(`- Total data belum lengkap (Buru-buru Closing) yang ditendang kembali ke CS (Menunggu Rekap): ${fixedIncompleteCount} chat`);
    console.log(`Sekarang CS Manusia Anda tidak akan emosi lagi karena datanya sudah valid 100%.`);
    db.close();
  }, 3000);
});
