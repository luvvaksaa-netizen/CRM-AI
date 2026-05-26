const fs = require('fs');
let content = fs.readFileSync('docs/17_MASTER_AGENT_PROMPT_ARAHAN_OWNER.md', 'utf8');

// Update Name Rule
content = content.replace(/Maksimal 2 nama per paket ya 😊/g, 'Maksimal 2 nama per paket ya 😊 (Untuk DTF maksimal 8 huruf, minimal 8 huruf. Khusus UV disarankan maksimal 8 huruf)');

// Update ALAMAT
content = content.replace(/Boleh minta alamat lengkapnya bun\? \(Kecamatan \+ Kota\/Kabupaten\) untuk cek ongkir 😊/g, 'Boleh minta alamat lengkapnya bun? (Jalan, RT/RW, Kelurahan, Kecamatan, Kota/Kabupaten, dan Kode Pos jika ada) untuk cek ongkir 😊');

// Update Form Rekap DTF
content = content.replace(/Rekap pesanan Bunda \[Nama Pelanggan\]:[\s\S]*?Atau mau bayar COD di tempat Bund\? 😊\"/g, `Rekap pesanan Bunda [Nama Pelanggan]:

Pengiriman : [COD / NON COD (Transfer)]
Nama Penerima : [Nama Pelanggan]
No WA : [Nomor Pelanggan]
Alamat Lengkap : [Jalan, RT/RW, Kelurahan, Kecamatan, Kota/Kabupaten, Provinsi]
Kode Pos : [Kode Pos jika ada, atau -]
Produk : Label DTF / UV DTF
Nama Cetak : [Nama 1] | [Nama 2]
Varian : [Varian yang dipilih]
Jumlah : [Z] Paket
Harga Produk : Rp 39.000
Ongkir JNE ke [Kota] : Rp [Ongkir]
Total Yang Harus Dibayar : Rp [Total]
Catatan : [Kosong / Catatan khusus]

Pembayaran ke:
🏦 Bank Mandiri
No. Rek: 1710016814843
A/N: PARE DIGITAL CUSTOM

Atau mau bayar COD di tempat bund? 😊"`);

content = content.replace(/Rekap pesanan Bunda \[Nama Pelanggan\]:[\s\S]*?Atau mau bayar COD di tempat bund\? 😊\"/g, `Rekap pesanan Bunda [Nama Pelanggan]:

Pengiriman : [COD / NON COD (Transfer)]
Nama Penerima : [Nama Pelanggan]
No WA : [Nomor Pelanggan]
Alamat Lengkap : [Jalan, RT/RW, Kelurahan, Kecamatan, Kota/Kabupaten, Provinsi]
Kode Pos : [Kode Pos jika ada, atau -]
Produk : Label DTF / UV DTF
Nama Cetak : [Nama 1] | [Nama 2]
Varian : [Varian yang dipilih]
Jumlah : [Z] Paket
Harga Produk : Rp 39.000
Ongkir JNE ke [Kota] : Rp [Ongkir]
Total Yang Harus Dibayar : Rp [Total]
Catatan : [Kosong / Catatan khusus]

Pembayaran ke:
🏦 Bank Mandiri
No. Rek: 1710016814843
A/N: PARE DIGITAL CUSTOM

Atau mau bayar COD di tempat bund? 😊"`);

// Update Upsell Name
content = content.replace(/bundling upsell/g, 'Paket Bundling Back to School');

// Update COD / TRANSFER Flow
content = content.replace(/LANGKAH 8 — COD \/ TRANSFER \(AKHIR OBROLAN\):[\s\S]*?Tandai dengan label: \"Menunggu Transfer\" atau \"Closing\"/g, `LANGKAH 8 — COD / TRANSFER (AKHIR OBROLAN):

Jika customer memilih COD:
"Baik bun, pesanan COD segera kami proses dan kirim ya. Terima kasih banyak 🙏"
(JIKA METODE BAYAR ADALAH COD, MAKA STATUS ADALAH CLEAR/SELESAI. JANGAN PERNAH MENYEBUT 'MENUNGGU TRANSFER' ATAU MEMINTA BUKTI TRANSFER).

Jika customer memilih Transfer:
"Baik bun, ditunggu bukti transfernya ya agar pesanan bisa segera diproses. Terima kasih banyak 🙏"

Setelah LANGKAH 8 selesai (termasuk mengirim Promo Paket Bundling Back to School), WAJIB:
1. Gunakan tool tambahkan_label_chat dengan label yang sesuai (contoh: ["COD", "Closing"] atau ["Menunggu Transfer", "Closing"]).
2. Gunakan tool matikan_bot_kontak agar bot berhenti merespon pelanggan ini (Karena CS Manusia yang akan memproses sisanya).`);

fs.writeFileSync('docs/17_MASTER_AGENT_PROMPT_ARAHAN_OWNER.md', content);
console.log('Update success');
