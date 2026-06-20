const fs = require('fs');
let file = fs.readFileSync('docs/17_MASTER_AGENT_PROMPT_ARAHAN_OWNER.md', 'utf8');

file = file.replace(/label media "Paket Bundling Back to School"/g, 'label media "bundling upsell"');

file = file.replace(/Tawarkan HANYA SEKALI setelah customer konfirmasi pesan utama\./g, 
`Tawarkan promo ini HANYA dalam 2 kondisi:
      1. Sebagai SOLUSI jika customer keberatan/mengeluh ongkir mahal atau bertanya soal ongkir.
      2. Sebagai UPSELL di akhir setelah customer MENYETUJUI/DEAL rekap pesanan utama.
    Jika customer tidak bertanya ongkir, jangan tawarkan di tengah-tengah obrolan. Cukup tawarkan di akhir sebagai Upsell.`);

fs.writeFileSync('docs/17_MASTER_AGENT_PROMPT_ARAHAN_OWNER.md', file);
console.log('Update docs 17 OK');
