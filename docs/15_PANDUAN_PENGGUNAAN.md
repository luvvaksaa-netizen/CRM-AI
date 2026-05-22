# 🚀 Panduan Lengkap Penggunaan Sistem WA-AI CRM
**Untuk operator, tim CS, dan admin bisnis label nama**

---

## ✅ STATUS AUDIT SISTEM (22 Mei 2026)

> Audit mendalam telah dilakukan terhadap **seluruh codebase** (8 file inti, 3 flow utama). Satu bug kritis ditemukan dan **telah diperbaiki**.

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

> ⚠️ **PENTING: Restart server** setelah semua perubahan agar database tabel `FollowUps` otomatis dibuat dan scheduler aktif.

---

## 🔄 LANGKAH WAJIB: RESTART SERVER

Karena `npm start` masih berjalan dengan kode lama, **harus di-restart**:

```powershell
# Di terminal yang sedang running npm start
Tekan Ctrl + C

# Jalankan kembali
node index.js
```

Setelah restart, cari log ini untuk konfirmasi:
```
✅ Database SQLite (Agent-Based Architecture) Siap!
[FollowUp] Scheduler otomatis aktif (cek tiap 60 detik).
```

---

## 🎯 PANDUAN KONFIGURASI AGENT (Langkah Demi Langkah)

### STEP 1: Buka Dashboard Admin
Buka browser → `http://localhost:3001` (atau `https://crm.datasdm.com` jika sudah setup Cloudflare)

---

### STEP 2: Buat Master Agent
1. Klik tab **"AI Agents"** di sidebar kiri
2. Klik tombol **"Buat Agen Baru"**
3. Isi form berikut:

**Nama Agen (Internal):**
```
Master Agent - Label Nama
```

**Nama Bot (yang muncul ke customer):**
```
Dini
```
> ⚡ Tiap nomor WA bisa punya nama CS berbeda. Caranya: di menu **Koneksi**, isi field "Nama Bot Override" per-perangkat. Ini akan menggantikan `{BOT_NAME}` secara otomatis.

**Kepribadian / System Prompt:**
```
Kamu adalah {BOT_NAME}, admin customer service dari slaludiskon.com yang ramah dan natural 😊

⚠️ RULE UTAMA:
* Maksimal chat 1 bubble = 10 kata.
* Wajib singkat seperti chat manusia (tidak kaku/formal).
* Jangan pernah mengirim paragraf panjang.
* Gunakan emoji secukupnya agar terkesan ramah.
* Jangan terlihat seperti bot/AI.

⚠️ DILARANG KERAS (DRACONIAN RULES):
* Dilarang mengulang pertanyaan atau menanyakan informasi yang sudah dijawab oleh customer.
* Selalu periksa bagian "DATA CUSTOMER YANG SUDAH DIKETAHUI" sebelum membalas.
* Jika Nama Pemesan, Varian, Detail Qty, dan Alamat sudah ada, JANGAN TANYAKAN LAGI. Langsung berikan total rekapan dan nomor rekening.
* Dilarang meminta ulang gambar/nama/jumlah yang sudah dikirim oleh customer.

🎯 ALUR PERCAKAPAN SEDERHANA:
1. Menyapa ramah, tawarkan varian (kirim gambar & 1 video saat opening jika interaksi baru).
2. Minta nama yang mau dicetak di label (bukan nama penerima).
3. Tanya detail qty per nama (maksimal 2 nama per paket).
4. Tanya alamat lengkap untuk cek ongkir.
5. Berikan total rekapan pesanan (harga + ongkir + biaya admin jika ada).
6. Berikan nomor rekening untuk pembayaran (atau konfirmasi COD jika customer minta).
```

**Pengetahuan Produk / Product Knowledge:**
```
Kategori Bisnis: Cetak Label Nama DTF & UV DTF

1. DETAIL PRODUK & HARGA:
- Paket Label Nama DTF (Bahan Kain/Setrika): Isi 50 pcs per paket, harga Rp 37.000,-
- Paket Label Nama UV DTF (Bahan Stiker Keras/Timbul): Isi 50 pcs per paket, harga Rp 38.000,-
- Batasan Nama: Maksimal 2 nama berbeda untuk 1 paket.

2. VARIAN & DESAIN:
- Varian: Tersedia dalam 4 varian desain yang dibedakan berdasarkan jenis font.
- Pilihan Warna: Hanya tersedia warna sesuai yang ada di gambar katalog.

3. INFORMASI REKENING PEMBAYARAN:
- Bank: Bank Mandiri
- Nomor Rekening: 1710016814843
- Atas Nama: PARE DIGITAL CUSTOM

4. METODE PENGIRIMAN & COD:
- Pengiriman dikirim dari Kediri menggunakan kurir JNE.
- Mendukung COD (Cash On Delivery) jika customer memintanya.
```

**Label Otomatis:**
```
Hot Lead, Menunggu Transfer, Sudah Closing, Komplain
```
> Pisahkan dengan koma. AI akan otomatis menempelkan label ini ke WhatsApp Business sesuai konteks percakapan.

4. Klik **"Simpan Agent"**

---

### STEP 3: Upload Media Katalog
1. Klik tab **"Media"** di sidebar kiri
2. Pastikan Agent yang aktif adalah Agent yang baru dibuat
3. Upload media dalam kategori ini:

| Tipe | Label (WAJIB PERSIS) | Keterangan | Fungsi |
|------|---------------------|------------|--------|
| 📷 Gambar | `varian font` | Foto 4 varian font | Dikirim AI saat opening |
| 🎬 Video | `video produk` | Video demo cetak label | Dikirim AI saat opening + follow-up stage 1 & 3 |
| 📷 Gambar | `testimoni` | Screenshot review bintang 5 | Untuk follow-up stage 2 & 4 |

> ⚠️ **Label media sangat penting!** Sistem follow-up otomatis mencari media berdasarkan label. Jika label salah, follow-up akan dikirim teks saja (tanpa gambar/video).

**Cara Upload:**
1. Klik "Upload Baru" → pilih file → isi Label dan Deskripsi → klik Upload
2. Tunggu hingga status menjadi ✅ "Analisis Vision AI Selesai"
3. Media siap digunakan oleh bot

---

### STEP 4: Hubungkan Nomor WA ke Agent
1. Klik tab **"Koneksi"** di sidebar kiri
2. Pilih perangkat/nomor WA dari daftar
3. Di dropdown **"AI Agent"**, pilih agent yang baru dibuat
4. Aktifkan toggle **"Auto-Reply AI"**
5. Klik **"Simpan"**
6. Scan QR Code (jika belum terhubung)

---

## 🤖 CARA KERJA SISTEM OTOMATIS

### Alur Percakapan Customer Baru (Tanpa Interaksi Manual)

```
Customer kirim "halo"
    ↓
Bot baca pesan → set centang biru
    ↓
AI: Interaksi pertama? → Kirim gambar varian + video produk
    ↓
AI tanya nama yang mau dicetak
    ↓
AI tanya qty per nama
    ↓
Customer beri alamat → AI OTOMATIS cek ongkir JNE
    ↓
AI kirim REKAP TOTAL (nama, qty, harga, ongkir, total, rekening)
    ↓
Bot catat semua data di DATABASE (Rekap Pembahasan)
    ↓ (jika customer tidak reply 10 menit)
Follow-Up Stage 1: Kirim video + teks reminder (dengan nama customer)
    ↓ (jika masih tidak reply 1 jam)
Follow-Up Stage 2: Kirim foto testimoni + promo text
    ↓ (jika masih tidak reply, jam 19:00)
Follow-Up Stage 3: Kirim video + urgency closing malam ini
    ↓ (jika masih tidak reply, jam 06:00 esok)
Follow-Up Stage 4: Kirim foto + sapaan pagi
    ↓
Jika customer reply kapanpun → SEMUA follow-up pending DIBATALKAN otomatis
```

---

## 📊 CARA MEMANTAU PERFORMA (Dashboard)

### Tab: Live Chat
- **Badge merah** = pesan yang belum dibaca CS
- **Toggle AI Reply** per-kontak: matikan jika ingin CS manusia ambil alih
- **Rekap Pembahasan** muncul di panel kanan setiap customer

### Tab: Follow Up
| Kolom | Artinya |
|-------|---------|
| 🟡 Menunggu Kirim | Customer masih menunggu follow-up dikirim |
| 🟢 Berhasil Dikirim | Follow-up sudah terkirim ke WhatsApp customer |
| 🔵 Dibalas/Selesai | Customer sudah membalas → antrian dibatalkan |

- Klik **"Batalkan FU"** untuk membatalkan satu follow-up secara manual

### Tab: Rekap
- Lihat status setiap customer: **STATUS** field di rekap (opening → gali kebutuhan → menunggu transfer → closing)
- Customer yang **STATUS: closing** tidak akan dapat follow-up

---

## ⚙️ KONFIGURASI TOGGLE BOT

### Toggle Global (Semua Customer)
**Lokasi:** Tab Koneksi → Toggle "Auto-Reply AI"
- ✅ ON = Bot membalas semua customer
- ❌ OFF = Bot diam, semua pesan tetap dicatat

### Toggle Per-Customer (Human Override)
**Lokasi:** Tab Live Chat → klik icon toggle di header chat customer
- ✅ ON = Bot balas customer ini
- ❌ OFF = Bot diam untuk customer ini saja (CS manusia bisa balas manual)

> 💡 **Penting:** Follow-up otomatis juga menghormati toggle ini. Jika kontak di-pause, follow-up tidak dikirim.

---

## 🎯 TIPS CLOSING MAKSIMAL

### 1. Prompt yang Tepat = Closing Lebih Cepat
Pastikan `system_prompt` mengandung instruksi alur yang jelas:
- "Tanya nama dulu sebelum harga"
- "Setelah dapat alamat, WAJIB cek ongkir"
- "Setelah ongkir didapat, langsung kirim rekap + rekening"

### 2. Upload Media yang Tepat
- **Video demo cetak** = paling efektif meningkatkan trust
- **Foto varian** = wajib ada agar opening visual dan menarik
- **Screenshot testimoni** = untuk follow-up stage 2 & 4

### 3. Pantau Tab Follow-Up
- Jika banyak customer di stage 1 tapi tidak lanjut ke stage 2, artinya pesan stage 1 kurang menarik
- Edit template di `src/services/followup_service.js` → array `copies` setiap stage

### 4. Gunakan Label Otomatis
Dengan label `Menunggu Transfer` atau `Hot Lead`, tim manusia bisa langsung tahu mana yang perlu di-follow-up manual.

---

## 🛠️ TROUBLESHOOTING UMUM

| Masalah | Kemungkinan Penyebab | Solusi |
|---------|---------------------|--------|
| Bot tidak membalas | Toggle AI OFF atau Agent belum terhubung | Cek tab Koneksi, aktifkan toggle |
| Follow-up tidak terkirim | Media tidak ditemukan (label salah) | Cek label media di tab Media |
| Bot kirim teks aneh / markdown | Sanitizer AI gagal filter | Restart server |
| Statistik Follow-Up selalu 0 | Server belum di-restart setelah update | Restart `node index.js` |
| Bot lupa data customer | Summary belum ter-generate (chat < 3 pesan) | Normal, akan aktif setelah 3+ interaksi |
| Ongkir tidak muncul | AI tidak extract kecamatan dari alamat | Pastikan customer menyebut kecamatan |

---

## 📝 GIT COMMIT (Simpan semua perubahan)

```bash
git add docs/03_AI_ENGINE.md docs/13_FOLLOWUP_SYSTEM.md docs/14_MASTER_AGENT_PROMPT.md public/index.html src/ai_service.js src/database/index.js src/events/message_handler.js src/services/dashboard_service.js src/services/followup_service.js src/whatsapp_service.js
git commit -m "feat(crm): implement 4-stage follow-up system, structured AI memory, and bot name override; fix: followup API route ordering bug"
git push
```
