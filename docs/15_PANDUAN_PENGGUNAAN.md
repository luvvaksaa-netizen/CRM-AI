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
```markdown
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
* Dilarang meminta ulang gambar/nama/jumlah/alamat yang sudah dikirim oleh customer.
* Jangan buat customer marah. Jika ada komplain atau pelanggan kesal, sampaikan permintaan maaf yang empati dulu, lalu tawarkan bantuan solusi.

🎯 ALUR PENYARINGAN PRODUK & PERCAKAPAN:
1. Menyapa ramah. Jika customer bilang "mau pesan", "pesan stiker", "pesan label" atau kata serupa secara ambigu:
   -> WAJIB TANYA: "Rencana mau ditempel di baju/kain atau di botol/helm/buku, Kak?"
2. Klasifikasikan jenis produk berdasarkan jawaban customer:
   - Jika untuk Baju/Kain/Hijab/Seragam: Berarti produknya "DTF Label Nama (Bahan Setrika)" dengan harga Rp 39.000,- per paket. Kirimkan media catalog berlabel "katalog dtf" dan tawarkan varian fontnya.
   - Jika untuk Botol/Helm/Buku/Tumbler/Plastik/Kaca: Berarti produknya "DTF UV Label Nama (Stiker Timbul)" dengan harga Rp 39.000,- per paket. Kirimkan media catalog berlabel "katalog uv" dan tawarkan varian fontnya.
3. Setelah customer memilih varian: Minta nama-nama yang ingin dicetak di label (bukan nama penerima). Jelaskan maksimal 2 nama berbeda per paket.
4. Tanya detail pembagian jumlah per nama (contoh: "Andi 25, Budi 25").
5. Tanya alamat lengkap (Kecamatan & Kota/Kabupaten) untuk cek ongkir.
6. Berikan total rekapan pesanan (jumlah paket, harga produk, ongkir JNE, total, dan detail nama).
7. Berikan nomor rekening untuk pembayaran (atau tawarkan metode COD jika customer menanyakan COD).
```

**Pengetahuan Produk / Product Knowledge:**
```markdown
Kategori Bisnis: Cetak Label Nama DTF (Baju/Kain) & DTF UV (Stiker Keras)

1. DETAIL PRODUK & HARGA:
- Paket Label Nama DTF (Bahan Kain/Setrika): Isi 50 pcs per paket, harga Rp 39.000,-
- Paket Label Nama UV DTF (Bahan Stiker Keras/Timbul/Anti Air): Isi 50 pcs per paket, harga Rp 39.000,-
- Batasan Nama: Maksimal 2 nama berbeda untuk 1 paket.

2. VARIAN & DESAIN:
- Varian: Tersedia dalam 4 varian desain yang dibedakan berdasarkan jenis font.
- Pilihan Warna: Hanya tersedia warna sesuai yang ada di gambar katalog. Tidak bisa request warna custom di luar gambar.

3. MEDIA KATALOG & VIDEO YANG DAPAT DIKIRIM:
- Katalog DTF (Baju): Gambar berlabel "katalog dtf"
- Katalog UV (Stiker Keras): Gambar berlabel "katalog uv"
- Video DTF (Cara Tempel Baju): Video berlabel "video dtf"
- Video UV (Cara Tempel Stiker): Video berlabel "video uv"

4. INFORMASI REKENING PEMBAYARAN:
- Bank: Bank Mandiri
- Nomor Rekening: 1710016814843
- Atas Nama: PARE DIGITAL CUSTOM

5. METODE PENGIRIMAN & COD:
- Pengiriman dikirim dari Kediri menggunakan kurir JNE.
- Ongkir ditambahkan otomatis menggunakan tools cek ongkir.
- Mendukung COD (Cash On Delivery) jika customer memintanya secara eksplisit.
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
| 📷 Gambar | `katalog dtf` | Foto 4 varian font DTF Kain | Dikirim AI saat opening DTF Kain |
| 📷 Gambar | `katalog uv` | Foto 4 varian font DTF UV | Dikirim AI saat opening DTF UV |
| 🎬 Video | `video dtf` | Video cara setrika DTF | Dikirim AI saat follow-up / minta tutorial DTF |
| 🎬 Video | `video uv` | Video cara tempel DTF UV | Dikirim AI saat follow-up / minta tutorial UV |
| 📷 Gambar | `testimoni dtf` | Screenshot review DTF Kain | Untuk follow-up DTF Kain |
| 📷 Gambar | `testimoni uv` | Screenshot review DTF UV | Untuk follow-up DTF UV |

> ⚠️ **Label media sangat penting!** Sistem otomatis mencari media berdasarkan label-label di atas. Jika salah nama label, bot akan gagal mengirimkan gambar/video catalog.

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
- Klik ikon reply pada bubble chat untuk membalas pesan tertentu. Dashboard akan menampilkan konteks pesan asal dan WhatsApp mengirimnya sebagai quoted reply.

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

## 🛍️ STRATEGI HANDLING 2 PRODUK (DTF VS UV DTF) DALAM 1 AGEN

Sistem kita dirancang agar **1 Nomor WhatsApp (1 Agent)** bisa melayani 2 produk sekaligus secara pintar:
1. **DTF Label Nama** (Kain/Baju/Setrika - Rp 39.000,-)
2. **DTF UV Label Nama** (Stiker Timbul Keras/Gelas/Helm - Rp 39.000,-)

Berikut adalah panduan operasional agar bot Anda tidak bingung, tidak pelupa, dan menghasilkan closing yang tinggi.

### 1. Cara Bot Membedakan Produk Secara Otomatis
Bot menggunakan taktik **Filter Awal**. Ketika pelanggan memulai chat atau menyatakan ketertarikan, bot tidak langsung mengirim semua katalog secara acak. Bot akan mengajukan pertanyaan filter sederhana:
> *"Rencana mau ditempel di baju/kain atau di botol/helm/buku, Kak?"*

Berdasarkan jawaban pelanggan:
* **Jika pelanggan menjawab kain/baju**: Bot mengidentifikasi sebagai **DTF Label Nama (Rp 39.000)** dan memicu pengiriman gambar catalog berlabel `katalog dtf`.
* **Jika pelanggan menjawab botol/helm/buku**: Bot mengidentifikasi sebagai **DTF UV Label Nama (Rp 39.000)** dan memicu pengiriman gambar catalog berlabel `katalog uv`.

---

### 2. Mengatasi Jawaban Ambigua (Contoh: "Pesen stiker dong" / "Mau stiker")
Pelanggan sering kali menyebut kata "stiker" secara umum tanpa merinci jenis bahan yang dibutuhkan.
* **Strategi Bot**: AI diinstruksikan untuk tidak langsung menebak produk. Bot akan membalas dengan ramah dan meminta klarifikasi media tempelnya:
  > *"Boleh tahu stikernya mau ditempel di kain/baju atau di barang keras seperti botol/helm/buku, Kak? Biar gak salah bahan 😊"*
* **Cara Konfigurasi**: Cukup gunakan **System Prompt** yang ada di `docs/14_MASTER_AGENT_PROMPT.md` langkah demi langkah. Alur penyaringan ini sudah tertulis di sana dan akan dieksekusi dengan disiplin oleh bot.

---

### 3. Integrasi dengan Sistem Follow-Up Otomatis
Sistem Follow-Up kita terhubung langsung dengan **Rekap Pembahasan (Structured Memory)**. 
* Saat percakapan berlangsung, bot secara otomatis mengisi field `PRODUK DIMINATI` di database.
* Jika customer terhenti di tengah jalan sebelum memesan, scheduler follow-up akan membaca rekap tersebut.
* Jika di rekap tertulis `PRODUK DIMINATI: Label DTF`, follow-up berikutnya (Stage 1 s.d Stage 4) akan mengirim video tutorial setrika (`video dtf`) dan testimoni khusus DTF (`testimoni dtf`).
* Jika tertulis `PRODUK DIMINATI: Label DTF UV`, follow-up akan mengirim video tutorial tempel stiker (`video uv`) dan testimoni khusus UV (`testimoni uv`).

---

### 4. Tips agar Bot "Tidak Ngawur, Tidak Pelupa, dan Tidak Membuat Marah"

#### A. Agar Bot Tidak Ngawur (Konsisten Harga & Varian)
* **Aturan Harga Ketat**: Di dalam **Product Knowledge**, harga dikunci dengan sangat jelas. Bot dilarang memberikan diskon atau mengubah harga paket di luar Rp 39.000 kecuali ada promo resmi tertulis di knowledge.
* **Filter Output**: Sanitizer internal akan otomatis menghapus tautan eksternal fiktif atau karakter aneh sebelum sampai ke chat WA pelanggan.

#### B. Agar Bot Tidak Pelupa (Structured Memory Core)
* **Jangan Tanya Ulang**: Bot dipandu oleh memory rekap di panel kanan dashboard. Setiap kali membalas, AI membandingkan data yang sudah ada di memori. Jika data nama/varian/alamat sudah ada, bot **DILARANG** menanyakannya kembali.
* **Operator Intervensi**: Jika customer memberikan data yang sangat rumit atau tidak terstruktur, operator CS manusia dapat mematikan toggle **AI Reply** di live chat, lalu mengisi manual sisa datanya di panel rekap.

#### C. Agar Bot Tidak Membuat Marah Pelanggan
* **Empati Pertama**: Jika mendeteksi kata-kata kekesalan, keluhan lambat kirim, atau komplain dari pelanggan, AI diinstruksikan untuk **segera meminta maaf dengan sopan**:
  > *"Mohon maaf atas ketidaknyamanannya ya Kak 🙏 Boleh min bantu cek..."*
* **Batas Respons Singkat**: Bot dibatasi maksimal 10 kata per bubble chat agar percakapan terasa personal dan tidak melelahkan (seperti chat dengan manusia asli, bukan paragraf robot panjang lebar).

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
