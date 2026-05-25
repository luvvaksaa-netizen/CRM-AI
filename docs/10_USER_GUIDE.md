# 📖 Panduan Pengguna — WA-AI-CS CRM Dashboard

> **Versi:** 1.8 (WA-JS Sync Recovery + Fast Typing)  
> **Terakhir Diperbarui:** 2026-05-20  
> **Target:** Pengguna Non-Teknis & Admin

---

## 🚀 Cara Menjalankan di Lokal

### Prasyarat
1. **Node.js** versi 20 ke atas → [Download](https://nodejs.org/)
2. **Google Chrome** (dibutuhkan untuk WWebJS)
3. **File `.env`** sudah terisi (lihat contoh di bawah)

### Langkah Setup

```bash
# 1. Clone / masuk ke folder proyek
cd wa-ai-cs

# 2. Install semua dependensi
npm install

# 3. Siapkan file .env (jika belum ada)
# Lihat bagian "Konfigurasi .env" di bawah

# 4. Jalankan!
node index.js

# 5. Buka browser → http://localhost:3000/login.html
```

### Konfigurasi `.env`

Buat file `.env` di root folder dengan isi:
```env
OPENAI_API_KEY=sk-proj-xxx          # API Key dari OpenAI (WAJIB)
ADMIN_USER=admin                    # Username login dashboard
ADMIN_PASS=PasswordKuatAnda!        # Password login (GANTI!)
SESSION_SECRET=rahasia-random-anda  # Secret untuk session cookie
RAJAONGKIR_API_KEY=xxx              # Untuk fitur cek ongkir (opsional)
ORIGIN_NAME=Kediri                  # Kota asal pengiriman (opsional)
```

> ⚠️ **PENTING:** Jangan gunakan password default `admin123` di production!

---

## 🔑 Login

1. Buka `http://localhost:3000/login.html`
2. Masukkan username dan password dari `.env`
3. Klik **Masuk**
4. Anda akan diarahkan ke Dashboard utama

---

## 📱 Fitur Dashboard

### 1. Sidebar Multi-Store (Kiri)
Sidebar menampilkan semua akun WhatsApp yang terdaftar:
- **Ikon bundar** dengan inisial nama toko
- **Titik hijau** = Online (terhubung)
- **Titik kuning** = Menunggu scan QR
- **Titik merah** = Offline / terputus
- **Tombol `+`** di bawah = Tambah toko baru

**Cara pindah toko:** Klik ikon toko yang diinginkan.

---

### 2. Tab Koneksi (QR Code)
- Halaman pertama yang muncul saat toko baru
- Scan **QR Code** menggunakan WhatsApp di HP Anda:
  1. Buka WhatsApp → Titik tiga → **Perangkat tertaut**
  2. Klik **Tautkan perangkat**
  3. Arahkan kamera ke QR Code di layar
- Setelah berhasil, status berubah **"Dihubungkan (Online)"**
- **Auto-Reply AI** toggle: Aktif/nonaktifkan AI untuk seluruh toko

**Pilih Agen Penggerak:** Dropdown di atas QR untuk memilih "otak AI" yang menggerakkan toko ini.

---

### 3. Tab Live Chat 💬
Tampilan CRM real-time seperti WhatsApp Web:

#### Panel Kiri — Daftar Percakapan
- Semua kontak yang pernah berkomunikasi
- **Search bar** untuk cari pelanggan
- Klik kontak untuk membuka percakapan

#### Panel Kanan — Detail Percakapan
- **Bubble biru** = pesan dari AI/Admin (keluar)
- **Bubble putih** = pesan dari pelanggan (masuk)
- Foto yang dikirim pelanggan ditampilkan inline
- Voice Note yang didengar AI ditampilkan dengan badge khusus

#### Fitur Manual Reply
1. Ketik pesan di kotak input bawah
2. Tekan **Enter** atau klik ikon pesawat
3. Pesan langsung terkirim via WhatsApp
4. **AI otomatis dipause** untuk kontak ini (Human Override)

#### Fitur Kirim Media Manual
1. Klik ikon **klip (📎)** di samping kotak input
2. Pilih media dari katalog toko
3. Media akan dikirim ke pelanggan

#### Toggle AI Menjawab ↔ Dipause
- Di pojok kanan atas panel chat
- **Biru "AI Menjawab"** = AI aktif membalas
- **Merah "AI Dipause"** = AI diam, Anda yang reply
- Toggle ini **tersimpan permanen** (tidak hilang saat restart server!)

---

### 4. Tab AI Agents 🤖
Kelola "otak AI" yang menggerakkan tiap toko:

#### Halaman List
- Tampilkan semua agen yang terdaftar
- **Buat Agen Baru** → isi nama internal

#### Halaman Edit (Klik "Edit Otak")
- **Nama Bot:** Nama yang ditampilkan ke pelanggan (misal: "CS Ventura")
- **Kepribadian (System Prompt):** Instruksi perilaku AI:
  ```
  Kamu adalah CS toko sepatu online "Ventura".
  Selalu ramah, jawab singkat tapi informatif.
  Jangan pernah menjanjikan diskon tanpa konfirmasi owner.
  ```
- **FAQ / Knowledge Base:** Informasi produk yang AI harus tahu:
  ```
  Produk: Sepatu Lari Nike Air Max
  Harga: Rp 1.299.000
  Stok: 43, 44, 45
  Pengiriman dari Kediri via JNE.
  ```

---

### 5. Tab Media 📸
Katalog foto & video produk per agen:

#### Upload Media
1. Klik **Upload Foto/Video**
2. Pilih file (JPG, PNG, WEBP, HEIC, MP4)
3. AI otomatis menganalisis isi (Vision/Whisper)
4. Edit label, deskripsi, dan **trigger words**

#### Trigger Words (Auto-Kirim)
- Isi kata kunci dipisah koma: `katalog, harga, produk`
- Jika pelanggan mengetik salah satu kata kunci, media otomatis dikirim!
- Contoh: Pelanggan tulis "minta katalog dong" → foto katalog terkirim otomatis

#### Purpose (Tujuan Media)
- **Both** = Knowledge AI + bisa dikirim
- **Knowledge Only** = AI tahu tapi tidak kirim
- **Send Only** = Bisa dikirim tapi AI tidak belajar dari ini

---

### 6. Tab Rekap 📊
Ringkasan otomatis per pelanggan:
- AI merangkum setiap percakapan menjadi 3-5 poin kunci
- Contoh: *"Pelanggan tertarik sepatu Nike size 43, sudah tanya ongkir ke Jakarta, belum order."*
- Diupdate otomatis setiap kali ada percakapan baru
- **Filter Toko (Baru):** Gunakan *dropdown* **"🏷️ Semua Toko"** di pojok kanan atas untuk memfilter rekapan. Anda bisa memilih agen tertentu (Misal: Agent DTF) agar tampilan rekap lebih fokus dan tidak campur aduk.
- Setiap kartu rekapan juga dilengkapi dengan **Badge Nama Toko** di sudut atas.

---

### 7. Tab Sistem 🖥️
Monitoring dan maintenance:
- **RAM & CPU** usage real-time
- **Database Backup** — daftar snapshot otomatis (setiap 24 jam)
- **Download backup** untuk recovery manual
- **Live Log Console** — lihat log server real-time

---

## ⚡ Tips Penggunaan

### Manajemen RAM
- Setiap toko butuh ~150-200MB RAM (Chromium browser)
- 4GB RAM → maks 8-10 toko
- 8GB RAM → maks 15-20 toko
- Gunakan `pm2 start index.js` untuk auto-restart jika crash

### Urutan Setup Toko Baru
1. Buat **Agen AI** dulu (tab AI Agents → Buat Agen Baru)
2. Edit prompt & knowledge base agen
3. Upload media/katalog ke agen
4. Tambah **Toko** (tombol + di sidebar)
5. Pilih agen yang sudah dibuat
6. Scan QR Code
7. Selesai! AI akan otomatis membalas pesan masuk

### Production di VPS
```bash
# Install PM2
npm install -g pm2

# Jalankan dengan PM2
pm2 start index.js --name wa-crm

# Lihat log
pm2 logs wa-crm

# Set auto-start saat reboot
pm2 startup
pm2 save
```

---

## 🔧 Troubleshooting

| Masalah | Solusi |
|---------|--------|
| QR Code tidak muncul | Restart server, tunggu 30 detik |
| Browser crash saat startup | Kurangi jumlah toko atau tambah RAM |
| Login gagal | Cek `ADMIN_USER` dan `ADMIN_PASS` di `.env` |
| AI tidak membalas | Cek toggle "AI Menjawab" per toko & per kontak |
| Media gagal dikirim | Pastikan file ada di `data/uploads/` |
| Error "Client tidak aktif" | WhatsApp belum di-scan, buka tab Koneksi |

---

## 📋 Daftar Endpoint API

| Method | Endpoint | Fungsi |
|--------|----------|--------|
| POST | `/api/login` | Login admin |
| GET | `/api/stores` | List semua toko |
| POST | `/api/stores` | Tambah toko baru |
| GET | `/api/settings/:id` | Ambil pengaturan toko |
| POST | `/api/settings/:id` | Update pengaturan toko |
| GET | `/api/agents` | List semua agen AI |
| POST | `/api/agents` | Buat agen baru |
| PUT | `/api/agents/:id` | Update agen |
| DELETE | `/api/agents/:id` | Hapus agen + semua media |
| GET | `/api/media/:agentId` | List media per agen |
| POST | `/api/media/:agentId` | Upload media |
| PUT | `/api/media/:agentId/:id` | Update detail media |
| DELETE | `/api/media/:agentId/:id` | Hapus media |
| GET | `/api/chat/:storeId` | Ambil histori chat |
| GET | `/api/summaries` | List semua rekap percakapan |
| POST | `/api/send` | Kirim pesan manual via WA; mendukung `quotedMessageId` untuk reply spesifik |
| POST | `/api/send-media` | Kirim media manual via WA |
| GET | `/api/stores/:s/contacts/:c/pause` | Cek status pause kontak |
| POST | `/api/stores/:s/contacts/:c/pause` | Toggle pause kontak |

---

## Update Fitur 2026-05-19

- Histori chat panjang sekarang bisa dimuat bertahap. Buka satu kontak lalu scroll ke bagian atas chat untuk memuat pesan lama.
- Kirim pesan manual sekarang memvalidasi nomor WA dan punya rate limit agar dashboard lebih aman.
- Sistem memakai hybrid WA-JS untuk fitur tambahan seperti reaksi emoji pada media/stiker, dengan fallback otomatis ke WWebJS.
- Startup sync memakai WA-JS `chat.list/getMessages` jika tersedia. Pesan non-reply tetap aman karena metadata quoted dibaca secara defensif.
- Typing customer-side dibatasi pendek dan muncul dekat waktu kirim, bukan sepanjang AI sedang berpikir.
| GET | `/api/system/backups` | List backup database |

---

## Update Fitur 2026-05-20

### Kontak Privat WhatsApp (`@lid`)
- WhatsApp kadang mengirim customer sebagai `@lid` (private ID), bukan nomor telepon asli.
- Dashboard akan menampilkan nomor asli `+62...` jika mapping LID sudah tersedia di cache WhatsApp.
- Jika nomor belum tersedia, dashboard menampilkan format aman seperti `Kontak WA #148720`, bukan `+130571653148720`.
- Jika tombol telepon muncul di header chat, klik tombol itu untuk resolve nomor dari cache lokal atau meminta nomor asli customer via WhatsApp.
- Balasan manual tetap bisa dikirim ke chat `@lid` selama percakapannya sudah ada.

### Label Otomatis WA-JS
- Jika WA-JS aktif dan akun mendukung label WhatsApp Business, sistem mencoba memberi label `AI Lead Baru` pada customer masuk.
- Untuk kontak `@lid`, sistem juga mencoba memberi label `Kontak LID`.
- Jika akun tidak mendukung label, bot tetap berjalan normal dan hanya menulis warning di log.
- Tombol label di header chat dan halaman Rekap membuka pengelola label WhatsApp.
- Dari pengelola label, operator bisa membuat, mengedit, menghapus, menempelkan, dan melepas label pada chat aktif.
- Daftar `Label Otomatis` pada AI Agent dipakai AI untuk memilih label via WA-JS saat konteks chat relevan.

### Respons Lebih Cepat & Bubble Pendek
- Debounce balasan default dipercepat menjadi `AI_REPLY_DEBOUNCE_MS=1200`.
- Typing simulation dipangkas agar chat pendek tidak terasa menunggu lama.
- Jika AI menulis beberapa baris, tiap baris dikirim sebagai bubble WhatsApp terpisah.
- Chat normal dijaga maksimal 10 kata per bubble; rekap order/payment tetap boleh panjang agar data lengkap.
- Brand/domain valid seperti `slaludiskon.com` tidak lagi dibersihkan oleh sanitizer.

### Troubleshooting Tambahan

| Masalah | Solusi |
|---------|--------|
| Error `EADDRINUSE` port 3000 | Sudah ada server lama berjalan. Tutup server lama atau stop proses `node index.js`, lalu jalankan `npm start` lagi. |
| Nomor customer terlihat seperti `Kontak WA #xxxxxx` | Itu kontak `@lid` yang belum punya mapping nomor di cache. Klik tombol telepon di header chat. |

### Endpoint Baru

| Method | Endpoint | Fungsi |
|--------|----------|--------|
| POST | `/api/stores/:s/contacts/:c/request-phone` | Minta nomor asli kontak `@lid` via WA-JS |
| GET | `/api/stores/:s/labels` | List label WA Business |
| POST | `/api/stores/:s/labels` | Buat label WA Business |
| GET | `/api/stores/:s/labels/palette` | List palet warna label WA Business |
| PUT | `/api/stores/:s/labels/:labelId` | Edit label WA Business |
| DELETE | `/api/stores/:s/labels/:labelId` | Hapus label WA Business |
| POST | `/api/stores/:s/contacts/:c/labels` | Tambah/hapus label pada chat |
| POST | `/api/stores/:s/messages/reaction` | Kirim reaksi emoji by message id |
| POST | `/api/stores/:s/messages/forward` | Forward pesan by message id |

### Navigasi URL & Persistence (20 Mei Sore)

- **URL Hash Routing** — Setiap halaman dashboard sekarang punya URL unik:
  - `http://localhost:3000/#/chat` — Live Chat
  - `http://localhost:3000/#/agents` — AI Agents
  - `http://localhost:3000/#/connect` — Koneksi / QR Code
  - `http://localhost:3000/#/media` — Media Library
  - `http://localhost:3000/#/summaries` — Rekap Pembahasan
  - `http://localhost:3000/#/system` — Monitor Sistem
- **Tombol Back/Forward browser** kini berfungsi normal antar halaman dashboard.
- **Deep Link** — Anda bisa langsung buka URL di atas untuk masuk ke halaman tertentu.
- **Toggle Auto-Reply AI** di halaman Koneksi sekarang **benar-benar tersimpan** ke database. Refresh halaman tidak akan mereset toggle.
- Jika save gagal (misalnya koneksi terputus), UI akan otomatis **revert ke data server** terakhir untuk mencegah ketidakkonsistenan.
