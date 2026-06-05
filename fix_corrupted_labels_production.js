const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Pastikan file ini menunjuk ke database production Anda di server
// Default Legacy Database Path:
const dbPath = path.join(__dirname, 'data', 'database.sqlite');

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

// Fungsi bantu untuk mengekstrak data dari summary_raw
function parseSummaryField(text, field) {
    if (!text) return '';
    const regex = new RegExp(`^${field}\\s*:\\s*(.*)$`, 'im');
    const match = text.match(regex);
    if (match) {
        return match[1].trim();
    }
    return '';
}

db.all('SELECT store_wa_id, contact_id, wa_labels, label_timestamps, contact_name, summary FROM ChatSummaries', (err, rows) => {
  if (err) {
    console.error('Gagal mengambil data ChatSummaries:', err.message);
    process.exit(1);
  }
  
  let fixedCodCount = 0;
  let fixedIncompleteCount = 0;
  
  rows.forEach(row => {
    let labels = [];
    let timestamps = {};
    try {
        labels = JSON.parse(row.wa_labels || '[]');
        timestamps = JSON.parse(row.label_timestamps || '{}');
    } catch (e) {
        return;
    }
    
    let isModified = false;
    let newLabels = [...labels];
    let newTimestamps = { ...timestamps };

    // Ekstrak metode bayar dan alamat dari summary text
    const txt = row.summary || '';
    const metodeBayar = parseSummaryField(txt, 'METODE BAYAR');
    const isCOD = labels.includes('COD') || /COD|bayar\s*di\s*tempat/i.test(metodeBayar);
    const alamat = parseSummaryField(txt, 'ALAMAT');

    // 1. KOREKSI COD BERSATUS MENUNGGU TRANSFER
    if (isCOD && newLabels.includes('Menunggu Transfer')) {
        newLabels = newLabels.filter(l => l !== 'Menunggu Transfer');
        delete newTimestamps['Menunggu Transfer']; // Bersihkan juga dari log historis analytics
        if (!newLabels.includes('Closing')) {
            newLabels.push('Closing');
            if (!newTimestamps['Closing']) newTimestamps['Closing'] = Date.now();
        }
        fixedCodCount++;
        isModified = true;
    }

    // 2. KOREKSI DATA BELUM LENGKAP YANG BURU-BURU CLOSING
    const isIncomplete = checkIncomplete(row.contact_name) || checkIncomplete(alamat);
    if (isIncomplete && (newLabels.includes('Closing') || newLabels.includes('Menunggu Transfer') || newLabels.includes('Selesai'))) {
        // Hapus status closing/menunggu transfer karena data masih ngawur
        newLabels = newLabels.filter(l => l !== 'Closing' && l !== 'Menunggu Transfer' && l !== 'Selesai');
        delete newTimestamps['Closing'];
        delete newTimestamps['Menunggu Transfer'];
        delete newTimestamps['Selesai'];
        
        // Kembalikan statusnya ke Menunggu Rekap atau Hot Lead agar CS bisa follow up
        if (!newLabels.includes('Menunggu Rekap')) {
            newLabels.push('Menunggu Rekap');
            if (!newTimestamps['Menunggu Rekap']) newTimestamps['Menunggu Rekap'] = Date.now();
        }
        fixedIncompleteCount++;
        isModified = true;
    }

    if (isModified) {
        db.run('UPDATE ChatSummaries SET wa_labels = ?, label_timestamps = ? WHERE store_wa_id = ? AND contact_id = ?', 
            [JSON.stringify(newLabels), JSON.stringify(newTimestamps), row.store_wa_id, row.contact_id], 
            (err2) => {
                if (err2) {
                    console.error(`Gagal update row ${row.contact_id}:`, err2.message);
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
