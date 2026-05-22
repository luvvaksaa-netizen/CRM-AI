# 🚀 Panduan Lengkap Penggunaan Sistem WA-AI CRM
**Untuk operator, tim CS, dan admin bisnis label nama**

---

## ✅ STATUS AUDIT & PERBAIKAN SISTEM (22 Mei 2026)

> Audit mendalam telah dilakukan terhadap **seluruh codebase** (8 file inti, 3 flow utama). Seluruh issue sinkronisasi dan perutean domain telah diperbaiki 100%.

| Komponen | Status | Catatan |
|---|---|---|
| Database (`FollowUp` table) | ✅ Selesai | Schema lengkap + auto-migrate |
| `followup_service.js` (Scheduler 4-tahap) | ✅ Selesai | Dipanggil otomatis di startup |
| `message_handler.js` (Trigger & Cancel) | ✅ Selesai | Wired dengan benar |
| `whatsapp_service.js` (`sendFollowUpMessage`) | ✅ Selesai | Tidak pause AI |
| `dashboard_service.js` (API Routes) | ✅ **BUGFIX** | Route `stats` dipindah sebelum `/:storeId` |
| `ai_service.js` (Bot Name + Memory + Bottom-Weight) | ✅ Selesai | `{BOT_NAME}` dan draconian rules |
| `index.html` (Tab Follow-Up UI) | ✅ Selesai | Stats + grid + cancel button |
| `generateChatSummary` (Structured Memory) | ✅ Selesai | Format KEY-VALUE 14 field |
| **Sinkronisasi Pesan Terlewat** | ✅ **BUGFIX** | Membaca 20 pesan × 15 chat terbaru saat startup + listen outgoing dari HP via `message_create` |

> ⚠️ **PENTING: Restart server** di Laptop Server setelah menarik update terbaru agar database tabel `FollowUps` otomatis dibuat, scheduler aktif, dan engine penangkap pesan HP aktif.

---

## 🔄 LANGKAH WAJIB: RESTART SERVER

Karena kode baru memiliki logika sinkronisasi baru, jalankan ini di **Laptop Server**:

```powershell
# Di terminal yang sedang running node/npm start
Tekan Ctrl + C

# Jalankan kembali
node index.js
```

---

## 💡 STRATEGI 1 AGEN UNTUK 2 PRODUK (DTF & UV DTF)

Banyak pengguna bingung bagaimana 1 nomor WhatsApp dengan 1 Agent AI bisa menangani 2 produk berbeda (DTF vs UV) tanpa salah kirim gambar atau salah sebut harga. Berikut adalah panduan setup dan cara kerjanya secara logis.

### 1. Bagaimana AI Membedakan Produk?
AI membedakan produk berdasarkan **pilihan sadar dari customer** dalam percakapan. AI dibekali dengan **Long-Term Memory** terstruktur (rekap data customer) yang mencatat salah satu field krusial:
`PRODUK DIMINATI: [Label DTF / Label DTF UV / belum jelas]`

Begitu customer menentukan jenis bahan yang diinginkan (misal: "Stiker UV"), AI akan menandai memorinya dan seterusnya menggunakan rincian produk UV (harga 38rb, bahan timbul, dll).

---

### 2. Aturan Penamaan Label Media (SANGAT PENTING)
Agar AI tidak salah mengirim gambar/video katalog ketika pelanggan bertanya atau saat opening flow, Anda harus mengunggah media dengan **Label yang spesifik** di Tab Media.

Tabel panduan label media wajib untuk 2 produk:

| Tipe Media | Label Media (WAJIB SAMA PERSIS) | Produk | Fungsi Utama |
|---|---|---|---|
| 📸 Gambar | `katalog dtf` | DTF (Setrika) | Foto pilihan font/desain DTF |
| 📸 Gambar | `katalog uv` | UV (Stiker) | Foto pilihan font/desain UV |
| 🎬 Video | `video dtf` | DTF (Setrika) | Video cara setrika label DTF |
| 🎬 Video | `video uv` | UV (Stiker) | Video demo stiker timbul UV |
| 📸 Gambar | `testimoni dtf` | DTF (Setrika) | Bukti ulasan pelanggan DTF |
| 📸 Gambar | `testimoni uv` | UV (Stiker) | Bukti ulasan pelanggan UV |

---

### 3. Setup System Prompt & Knowledge Base (Copy-Paste)
Gunakan draf konfigurasi Agent di bawah ini pada Dashboard untuk memastikan bot membedakan produk dengan benar, tidak pelupa, dan tidak memicu kemarahan pelanggan.

#### **Nama Agen (Internal):**
```
Master Agent - Multi Produk (DTF & UV)
```

#### **Nama Bot (yang muncul ke customer):**
```
Dini
```

#### **System Prompt (Kepribadian & Aturan Draconian):**
```
Kamu adalah {BOT_NAME}, admin CS slaludiskon.com yang ramah, ringkas, dan sangat teliti 😊

⚠️ ATURAN KEPRIBADIAN & GAYA CHAT:
- Maksimal chat 1 bubble = 10 kata. Wajib singkat layaknya manusia asli!
- Gunakan emoji sewajarnya agar terkesan ramah. Jangan kaku seperti robot.
- Jika mengirimkan list varian, nama, atau alamat, gunakan pemisah baris baru (tiap baris otomatis menjadi 1 bubble pendek).

⚠️ ALUR WAJIB (MULTI-PRODUK):
1. OPENING: Sapa ramah, lalu tanyakan: "Mau pesan Label DTF (untuk baju/setrika) atau Label UV (untuk botol/helm/stiker timbul) Kak?"
2. Setelah customer memilih salah satu produk:
   - Jika pilih DTF: Panggil tool 'kirim_media_katalog' untuk label 'katalog dtf' dan 'video dtf'.
   - Jika pilih UV: Panggil tool 'kirim_media_katalog' untuk label 'katalog uv' dan 'video uv'.
3. Lanjutkan menanyakan data secara bertahap:
   - Nama yang mau dicetak (Maksimal 2 nama berbeda untuk 1 paket).
   - Jumlah paket yang dipesan.
   - Alamat lengkap untuk cek ongkir.
4. JANGAN PERNAH menanyakan kembali data yang statusnya sudah terisi di bagian "DATA CUSTOMER YANG SUDAH DIKETAHUI" di bawah. Menanyakan kembali data yang sudah dijawab akan membuat pelanggan sangat marah!

⚠️ LOGIKA MATEMATIKA PAKET:
- 1 Paket = Isi 50 pcs (Maksimal 2 nama berbeda).
- 2 Paket = Isi 100 pcs (Maksimal 4 nama berbeda).
- Jika customer memesan 2 paket tapi hanya memberikan 3 nama, itu SANGAT DIPERBOLEHKAN (karena 3 nama masih di bawah batas maksimal 4 nama). Jangan menolak pesanan ini!

⚠️ PENGGUNAAN TOOL ONGKIR:
- Begitu customer memberikan alamat (Kecamatan & Kota/Kabupaten), kamu WAJIB langsung memanggil tool 'cek_ongkir_jne'. Jangan berkata "saya cek dulu" tanpa memanggil tool.
```

#### **Product Knowledge (Pengetahuan Produk Lengkap):**
```
1. PRODUK LABEL NAMA DTF (BAHAN BAJU/KAIN):
   - Cara pakai: Ditempel menggunakan setrika biasa di rumah.
   - Harga: Rp 37.000,- per paket.
   - Isi: 50 pcs label nama siap setrika.
   - Batasan: Maksimal 2 nama berbeda per paket.
   - Desain: Memiliki 4 varian font (sesuai gambar katalog dtf).

2. PRODUK LABEL NAMA UV DTF (BAHAN STIKER KERAS/TIMBUL):
   - Cara pakai: Langsung ditempel (stiker timbul/hard-sticker), tahan air, kuat untuk botol minum, helm, tumbler, HP, dll.
   - Harga: Rp 38.000,- per paket.
   - Isi: 50 pcs stiker timbul.
   - Batasan: Maksimal 2 nama berbeda per paket.
   - Desain: Memiliki 4 varian font (sesuai gambar katalog uv).

3. INFORMASI REKENING PEMBAYARAN:
   - Bank: Bank Mandiri
   - Nomor Rekening: 1710016814843
   - Atas Nama: PARE DIGITAL CUSTOM

4. PENGIRIMAN:
   - Dikirim dari Kediri menggunakan kurir JNE.
   - Menerima metode pembayaran Transfer Mandiri atau COD (Cash on Delivery).
```

---

## 🤖 CARA KERJA SISTEM MEMORI (ANTI-LUPA)

Untuk memastikan bot tidak berulang kali menanyakan hal yang sama (yang sering kali membuat customer kesal):

1. **Structured Memory Extraction**: Setiap kali ada percakapan baru masuk, modul `generateChatSummary` akan mengekstrak informasi penting secara background.
2. **Bottom-Weighted Data Injection**: Sebelum AI membalas pesan customer, ringkasan memori yang berisi status data (misalnya: `VARIAN: varian 1`, `TEKS LABEL: Tiara`, `ALAMAT: Loceret, Nganjuk`) dimasukkan ke dalam instruksi paling bawah prompt AI.
3. **Draconian Memory Rules**: Aturan sistem menegaskan bahwa jika field tersebut sudah terisi (statusnya bukan "belum"), AI **dilarang keras** memintanya lagi. AI harus langsung lompat ke langkah berikutnya (misal: jika alamat sudah ada, langsung berikan total harga + rekening).

---

## 😡 PENANGANAN PELANGGAN MARAH (EMPATHY RESPONSES)

Sistem AI telah dilengkapi dengan **Panduan Kecerdasan Lanjutan (Advanced Intelligence)** di dalam core engine-nya. Jika customer mengirim kata-kata dengan emosi tinggi (marah, komplain lambat, dsb):
- AI secara otomatis beralih ke mode empati.
- AI akan meminta maaf dengan ramah, memvalidasi keluhan pelanggan, dan segera menawarkan solusi konkrit (misal: menawarkan pengecekan nomor resi atau membantu re-check data pesanan).
- AI dilarang membalas dengan nada defensif atau kaku.

---

## 📊 CARA MEMANTAU PERFORMA & MANAJEMEN LIVE CHAT

### Tab: Live Chat
- **Panel Kiri**: Daftar chat aktif yang diurutkan dari pesan terbaru.
- **Panel Tengah (Chat Box)**: Riwayat chat real-time yang tersinkronisasi 100% dengan HP (termasuk pesan keluar dari HP).
- **Panel Kanan (Rekap Data)**: Ringkasan 14 field data customer yang secara otomatis terupdate setiap kali customer memberikan data baru.
- **Header Chat**: Toggle "AI Menjawab". Jika dimatikan, bot akan berhenti membalas nomor tersebut agar CS manusia bisa mengetik jawaban manual tanpa diganggu AI.

### Tab: Follow Up
Memantau antrean follow-up otomatis yang dijadwalkan per customer (Stage 1 sampai Stage 4). Jika customer merespons di tengah jalan, antrean otomatis berubah menjadi **Dibalas/Selesai** dan dibatalkan agar tidak mengganggu pelanggan (anti-spam).

---

## 🛠️ TROUBLESHOOTING UMUM

| Masalah | Kemungkinan Penyebab | Solusi |
|---------|---------------------|--------|
| Pesan keluar dari HP tidak tampil di web | Server belum menggunakan versi terbaru | Jalankan `git pull` dan restart `node index.js` di server lokal. |
| AI salah kirim media DTF ke customer UV | Label media katalog tidak sesuai panduan | Pastikan label di Tab Media ditulis persis `katalog uv` atau `katalog dtf` tanpa tambahan spasi. |
| Tombol tambah label muncul error | Akun WA yang terkoneksi bukan WA Business | Sesuai pembatasan API WhatsApp, fitur Label kategori hanya didukung oleh akun WhatsApp Business resmi. |
| Ongkir tidak keluar | Kecamatan tujuan tidak tertulis jelas | Minta customer menyebutkan nama Kecamatan dan Kota/Kabupaten tujuan secara jelas (contoh: "Kecamatan Loceret Kabupaten Nganjuk"). |
