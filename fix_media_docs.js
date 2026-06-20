const fs = require('fs');
let file = fs.readFileSync('docs/16_PANDUAN_UPLOAD_MEDIA.md', 'utf8');

file = file.replace(
    '2. 🌟 **UPDATE TERBARU (GLOBAL MEDIA):** Semua media sekarang saling berbagi lintas agen! Artinya, jika Anda mengupload "katalog uv" ke Agen 2, Agen 1 otomatis bisa mengirimkannya ke customer jika diminta. Anda TIDAK PERLU lagi mengupload media yang sama di dua agen berbeda.',
    '2. 🌟 **PENTING (ISOLASI MEDIA):** Media kini 100% dipisah per agen agar tidak ada salah kirim produk. Jika Anda punya 2 agen yang butuh media yang sama (misal gambar bundling), Anda WAJIB meng-upload gambar tersebut ke masing-masing agen.'
);

file = file.replace(
    '3. Gambar bundling **"bundling upsell"** cukup di-upload ke **SALAH SATU** agent saja, keduanya otomatis bisa menggunakannya.',
    '3. Gambar bundling **"bundling upsell"** WAJIB di-upload ke **KEDUA** agen agar agen DTF maupun UV bisa menawarkannya.'
);

file = file.replace(
    /Q: Gambar bundling upsell perlu di-upload ke kedua agent\?\*\*[\s\S]*?\*\*Q: Kalau customer di Agent DTF tiba-tiba minta katalog UV, apakah bot bisa ngirim\?\*\*[\s\S]*?cross-selling otomatis\./g,
    `Q: Gambar bundling upsell perlu di-upload ke kedua agent?**
A: YA! Karena media sekarang dipisah per agen secara ketat (isolasi media), Anda wajib meng-upload \`bundling upsell\` ke Agent DTF dan Agent UV jika ingin keduanya bisa menawarkan promo tersebut.`
);

fs.writeFileSync('docs/16_PANDUAN_UPLOAD_MEDIA.md', file);
console.log('Update docs 16 OK');
