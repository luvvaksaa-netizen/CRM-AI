// Cek env DATA_DIR dan DB path yang dipakai
const path = require('path');
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const dbPath = path.resolve(DATA_DIR, 'database.sqlite');
console.log('DATA_DIR:', DATA_DIR);
console.log('DB path:', dbPath);
console.log('CWD:', process.cwd());
