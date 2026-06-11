/**
 * find_db.js — Cari database yang benar dan jalankan patch Transfer-First
 * 
 * Jalankan: node find_db.js
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Cari semua file .sqlite di folder ini
const cwd = process.cwd();
const allFiles = fs.readdirSync(cwd);
const sqliteFiles = allFiles.filter(f => f.endsWith('.sqlite'));

console.log('=== INVESTIGASI DATABASE ===');
console.log('Folder:', cwd);
console.log('File .sqlite ditemukan:', sqliteFiles);
console.log('');

let checked = 0;

if (sqliteFiles.length === 0) {
  console.log('TIDAK ADA file .sqlite di folder ini!');
  console.log('Kemungkinan database ada di lokasi lain.');
  console.log('Coba cek: ls -la atau dir untuk lihat semua file');
  process.exit(0);
}

sqliteFiles.forEach(file => {
  const fullPath = path.join(cwd, file);
  const stat = fs.statSync(fullPath);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(2);

  const db = new sqlite3.Database(fullPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
      console.log(file + ' [' + sizeMB + ' MB] -> ERROR buka: ' + err.message);
      checked++;
      if (checked === sqliteFiles.length) finish();
      return;
    }

    db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", (err2, rows) => {
      const tables = rows ? rows.map(r => r.name) : [];
      const hasBotAgents = tables.includes('BotAgents');
      const hasStores = tables.includes('Stores') || tables.includes('stores');

      console.log('');
      console.log('FILE: ' + file + ' [' + sizeMB + ' MB]');
      console.log('  Tabel: ' + (tables.join(', ') || '(kosong)'));
      console.log('  Ada BotAgents? ' + (hasBotAgents ? 'YA <=== INI YANG BENAR!' : 'Tidak'));
      console.log('  Ada Stores?    ' + (hasStores ? 'YA' : 'Tidak'));

      if (hasBotAgents) {
        // Tampilkan preview agents
        db.all('SELECT id, name, bot_name FROM BotAgents', (e3, agents) => {
          if (agents && agents.length > 0) {
            console.log('  Agents:', agents.map(a => a.id + ':' + a.name).join(', '));
          }
          db.close();
          checked++;
          if (checked === sqliteFiles.length) finish();
        });
      } else {
        db.close();
        checked++;
        if (checked === sqliteFiles.length) finish();
      }
    });
  });
});

function finish() {
  console.log('');
  console.log('=== INSTRUKSI ===');
  console.log('Jika ada file yang punya BotAgents di atas:');
  console.log('  Edit patch_transfer_first.js dan patch_transfer_first_v2.js');
  console.log('  Ubah baris: const dbPath = path.join(__dirname, "database-production.sqlite");');
  console.log('  Ganti dengan nama file yang benar di atas.');
  console.log('');
  console.log('Jika tidak ada yang punya BotAgents:');
  console.log('  Database production mungkin ada di path berbeda (env variable DB_PATH)');
  console.log('  Coba: cat .env | grep DB atau grep -r "database" src/config.js');
}
