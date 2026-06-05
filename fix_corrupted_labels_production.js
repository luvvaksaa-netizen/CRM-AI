const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'database.sqlite');
console.log(`[PEMBERSIHAN DATA] Menghubungkan ke database: ${dbPath}`);
const db = new sqlite3.Database(dbPath);

function checkIncomplete(str) {
    if (!str) return true;
    const s = str.toLowerCase().trim();
    return s === '-' || s === '.' || s === 'belum' || s.includes('[') || s.includes(']');
}

function parseSummaryField(text, field) {
    if (!text) return '';
    const regex = new RegExp(`^${field}\\s*:\\s*(.*)$`, 'im');
    const match = text.match(regex);
    if (match) {
        return match[1].trim();
    }
    return '';
}

db.all('SELECT store_wa_id, contact_id, wa_labels, label_timestamps, contact_name, summary FROM ChatSummaries', async (err, rows) => {
  if (err) {
    console.error('Gagal mengambil data ChatSummaries:', err.message);
    process.exit(1);
  }
  
  let fixedCodCount = 0;
  let fixedIncompleteCount = 0;
  
  for (const row of rows) {
    let labels = [];
    let timestamps = {};
    try {
        labels = JSON.parse(row.wa_labels || '[]');
        timestamps = JSON.parse(row.label_timestamps || '{}');
    } catch (e) {
        continue;
    }
    
    let isModified = false;
    let newLabels = [...labels];
    let newTimestamps = { ...timestamps };

    const txt = row.summary || '';
    const metodeBayar = parseSummaryField(txt, 'METODE BAYAR');
    const isCOD = labels.includes('COD') || /COD|bayar\s*di\s*tempat/i.test(metodeBayar);
    const alamat = parseSummaryField(txt, 'ALAMAT');
    const isTransfer = labels.includes('Transfer') || /Transfer/i.test(metodeBayar);

    // KOREKSI 1: COD BERSATUS MENUNGGU TRANSFER
    if (isCOD && newLabels.includes('Menunggu Transfer')) {
        newLabels = newLabels.filter(l => l !== 'Menunggu Transfer');
        delete newTimestamps['Menunggu Transfer'];
        if (!newLabels.includes('Closing')) {
            newLabels.push('Closing');
            newTimestamps['Closing'] = Date.now();
        }
        fixedCodCount++;
        isModified = true;
    }

    // KOREKSI 2: DATA BELUM LENGKAP YANG BURU-BURU CLOSING ATAU MENUNGGU TRANSFER
    // Deteksi dengan cara yang persis sama dengan audit diagnostik
    const s_lower = (row.contact_name + ' ' + txt).toLowerCase();
    let corrupted = s_lower.includes('[nama]') || s_lower.includes('nama: -') || s_lower.includes('alamat: -') || s_lower.includes('belum');
    
    // Atau jika checkIncomplete menemukannya
    if (checkIncomplete(row.contact_name) || checkIncomplete(alamat)) {
        corrupted = true;
    }

    if (corrupted && (newLabels.includes('Closing') || newLabels.includes('Menunggu Transfer') || newLabels.includes('Selesai'))) {
        newLabels = newLabels.filter(l => l !== 'Closing' && l !== 'Menunggu Transfer' && l !== 'Selesai');
        delete newTimestamps['Closing'];
        delete newTimestamps['Menunggu Transfer'];
        delete newTimestamps['Selesai'];
        
        if (!newLabels.includes('Menunggu Rekap')) {
            newLabels.push('Menunggu Rekap');
            newTimestamps['Menunggu Rekap'] = Date.now();
        }
        fixedIncompleteCount++;
        isModified = true;
    }

    if (isModified) {
        await new Promise((resolve) => {
            db.run('UPDATE ChatSummaries SET wa_labels = ?, label_timestamps = ? WHERE store_wa_id = ? AND contact_id = ?', 
                [JSON.stringify(newLabels), JSON.stringify(newTimestamps), row.store_wa_id, row.contact_id], 
                (err2) => {
                    if (err2) console.error(`Gagal update row ${row.contact_id}:`, err2.message);
                    resolve();
            });
        });
    }
  }
  
  console.log(`\n✅ [SELESAI] Database berhasil dibersihkan!`);
  console.log(`- Total COD salah label (Menunggu TF) diperbaiki: ${fixedCodCount} chat`);
  console.log(`- Total data bodong (Buru-buru Closing) di-downgrade ke Menunggu Rekap: ${fixedIncompleteCount} chat`);
  db.close();
});
