# 🚀 Panduan Lengkap Penggunaan Sistem WA-AI CRM
**Untuk operator, tim CS, dan admin bisnis label nama**
*Versi 2.0 — Mencakup 2 Produk: Label DTF & UV DTF*

---

## ✅ STATUS SISTEM (Audit Terakhir: 22 Mei 2026)

| Komponen | Status |
|---|---|
| AI Engine (OpenAI) | ✅ Aktif |
| Follow-Up Otomatis 4-Tahap | ✅ Aktif |
| Memori Terstruktur (Anti-Lupa) | ✅ Aktif |
| Sinkronisasi Chat dari HP | ✅ Aktif (diperbaiki) |
| Label Otomatis WA Business | ✅ Aktif |

> ⚠️ **Wajib restart server setelah update kode** agar semua perbaikan berjalan.

---

## 🧠 CARA KERJA BOT MEMBEDAKAN 2 PRODUK

> **Ini adalah bagian terpenting yang harus dipahami sebelum konfigurasi.**

Bisnis Anda memiliki **2 produk berbeda**:
- **Produk 1: Label Nama DTF** (Bahan Kain / Setrika) — Rp 37.000 / 50 pcs
- **Produk 2: Label Nama UV DTF** (Bahan Stiker Keras / Timbul) — Rp 38.000 / 50 pcs

Masing-masing produk memiliki **foto varian dan video demo yang berbeda**. Bot membedakan keduanya melalui **2 mekanisme utama**:

### Mekanisme 1: Label Media (Penanda Produk)
Setiap file yang Anda upload di tab Media **harus diberi label yang spesifik**. Label inilah yang menjadi "nama panggil" bagi AI untuk mengirimkan media yang tepat ke customer.

Contoh: Jika customer tanya tentang Label DTF, AI akan mencari media dengan label `varian dtf` di katalog, lalu kirim ke customer.

### Mekanisme 2: Deskripsi Media (Konteks AI)
Selain label, setiap media juga bisa diberi **Deskripsi** yang menjelaskan isi media tersebut. Deskripsi ini masuk ke "otak" AI sebagai pengetahuan visual, sehingga AI benar-benar "mengerti" isi gambar/video sebelum berbicara kepada customer.

### Mekanisme 3: Trigger Words (Kata Kunci Otomatis)
Anda bisa mengisi kolom **Trigger Words** di setiap media. Jika customer menyebut kata tersebut, media langsung dikirim otomatis tanpa AI perlu memutuskan.

---

## 📋 SKEMA MEDIA YANG HARUS DIUPLOAD (Wajib Lengkap)

> **Perhatian:** Label di kolom "Label Wajib Persis" harus diketik **PERSIS SAMA** (huruf kecil semua) agar sistem bisa menemukannya.

### Untuk Agent: Label Nama DTF (Bahan Setrika)

| No | Tipe | Label (Wajib Persis) | Isi File | Trigger Words | Fungsi |
|----|------|---------------------|----------|---------------|--------|
| 1 | 📷 Gambar | `varian dtf` | Foto 4 varian font Label DTF | `dtf, label kain, label setrika, bahan kain` | Dikirim AI saat opening (customer tanya DTF) |
| 2 | 🎬 Video | `video dtf` | Video demo cetak + pasang label DTF | `lihat video dtf, demo dtf` | Follow-up Stage 1 & 3 + Saat opening |
| 3 | 📷 Gambar | `testimoni dtf` | Screenshot review customer label DTF | *(kosongkan)* | Follow-up Stage 2 & 4 |
| 4 | 📷 Gambar | `contoh order dtf` | Gambar contoh format order (nama, jumlah, varian) | *(kosongkan)* | Dikirim saat customer bingung cara order |

### Untuk Agent: Label Nama UV DTF (Stiker Timbul)

| No | Tipe | Label (Wajib Persis) | Isi File | Trigger Words | Fungsi |
|----|------|---------------------|----------|---------------|--------|
| 1 | 📷 Gambar | `varian uv` | Foto 4 varian font Label UV | `uv, stiker, stiker timbul, uv dtf` | Dikirim AI saat opening (customer tanya UV) |
| 2 | 🎬 Video | `video uv` | Video demo cetak + hasil jadi stiker timbul | `lihat video uv, demo uv` | Follow-up Stage 1 & 3 + Saat opening |
| 3 | 📷 Gambar | `testimoni uv` | Screenshot review customer UV | *(kosongkan)* | Follow-up Stage 2 & 4 |
| 4 | 📷 Gambar | `contoh order uv` | Gambar contoh format order UV | *(kosongkan)* | Dikirim saat customer bingung cara order |

---

## 🔧 KONFIGURASI STEP-BY-STEP (Sangat Detail)

### STEP 1: Buat 2 Agent Terpisah

**Kenapa harus 2 Agent?** Karena setiap agent memiliki media katalog sendiri. Jika digabung, AI bisa salah kirim foto/video produk yang tidak sesuai.

Masuk ke Dashboard → Tab **"AI Agents"** → Klik **"Buat Agen Baru"**.

---

#### AGENT 1: Label Nama DTF (Bahan Kain/Setrika)

**Nama Agent (Internal):**
```
Agent Label DTF - Bahan Kain
```

**Nama Bot (yang terlihat customer):**
```
Dini
```
*(Setiap nomor WA bisa punya nama berbeda, diatur di menu Koneksi)*

**Kepribadian / System Prompt — Copy-Paste ini:**
```
Kamu adalah {BOT_NAME}, admin CS dari slaludiskon.com 😊
Produk yang kamu jual: Label Nama DTF (bahan kain, setrika ke baju).

⚠️ ALUR WAJIB (Ikuti urutannya!):
1. Sapa customer, kirim gambar varian font DTF + video demo DTF.
2. Tanya nama yang mau dicetak di label (bukan nama penerima paket).
3. Tanya detail per nama: nama A berapa pcs, nama B berapa pcs.
   (Ingat: 1 paket = 50 pcs, MAKS 2 nama/paket)
4. Tanya alamat lengkap (sampai nama kecamatan).
5. OTOMATIS cek ongkir JNE setelah dapat alamat.
6. Kirim rekap lengkap + nomor rekening.

⚠️ ATURAN KETAT:
- Maksimal 10 kata per bubble chat.
- DILARANG tanya ulang data yang sudah dijawab.
- DILARANG sebut harga sebelum customer tanya varian.
- Jika customer tanya produk UV/stiker, jelaskan bahwa ini khusus DTF (kain). Untuk UV, ada CS lain.
```

**Pengetahuan Produk — Copy-Paste ini:**
```
PRODUK: Label Nama DTF (Bahan Kain / Setrika ke Baju)
HARGA: Rp 37.000 per paket (isi 50 pcs)
MAKS NAMA PER PAKET: 2 nama berbeda
UKURAN LABEL: Sesuai standar label nama sekolah/baju
BAHAN: Polyflex / DTF (Direct to Film) — ditempel dengan setrika
KETAHANAN: Tahan cuci, tidak mudah luntur
VARIAN: 4 varian (dibedakan jenis font). Warna sesuai katalog.
CARA PASANG: Gunting sesuai bentuk → setrika 10-15 detik → siap pakai

CONTOH PERHITUNGAN PAKET:
- 1 paket 50 pcs: maks 2 nama (misal: Andi 25 pcs, Budi 25 pcs)
- 2 paket 100 pcs: maks 4 nama (misal: Andi 25, Budi 25, Cici 25, Dedi 25)
- 3 paket 150 pcs: maks 6 nama
- Boleh 1 paket hanya 1 nama: Andi 50 pcs

REKENING PEMBAYARAN:
Bank: Bank Mandiri
No Rek: 1710016814843
A/N: PARE DIGITAL CUSTOM

PENGIRIMAN: Dari Kediri menggunakan JNE. Bisa COD.
```

**Label Otomatis:**
```
Hot Lead DTF, Menunggu Transfer, Sudah Closing, Komplain
```

---

#### AGENT 2: Label Nama UV DTF (Stiker Timbul)

**Nama Agent (Internal):**
```
Agent Label UV - Stiker Timbul
```

**Nama Bot:** `Dini` *(atau nama lain untuk nomor WA yang berbeda)*

**Kepribadian / System Prompt — Copy-Paste ini:**
```
Kamu adalah {BOT_NAME}, admin CS dari slaludiskon.com 😊
Produk yang kamu jual: Label Nama UV DTF (stiker keras/timbul, tempel ke botol/peralatan).

⚠️ ALUR WAJIB (Ikuti urutannya!):
1. Sapa customer, kirim gambar varian font UV + video demo UV.
2. Tanya nama yang mau dicetak di label (bukan nama penerima paket).
3. Tanya detail per nama: nama A berapa pcs, nama B berapa pcs.
   (Ingat: 1 paket = 50 pcs, MAKS 2 nama/paket)
4. Tanya alamat lengkap (sampai nama kecamatan).
5. OTOMATIS cek ongkir JNE setelah dapat alamat.
6. Kirim rekap lengkap + nomor rekening.

⚠️ ATURAN KETAT:
- Maksimal 10 kata per bubble chat.
- DILARANG tanya ulang data yang sudah dijawab.
- DILARANG sebut harga sebelum customer tanya varian.
- Jika customer tanya produk DTF/kain/setrika, jelaskan bahwa ini khusus UV (stiker). Untuk DTF, ada CS lain.
```

**Pengetahuan Produk — Copy-Paste ini:**
```
PRODUK: Label Nama UV DTF (Stiker Keras / Timbul)
HARGA: Rp 38.000 per paket (isi 50 pcs)
MAKS NAMA PER PAKET: 2 nama berbeda
BAHAN: UV DTF — stiker keras, efek timbul/glossy
KETAHANAN: Waterproof, tahan air, tidak mudah luntur, cocok untuk botol/tumbler/peralatan
VARIAN: 4 varian (dibedakan jenis font). Warna sesuai katalog.
CARA PASANG: Kupas backing → tempel ke permukaan → tekan rata

CONTOH PERHITUNGAN PAKET:
- 1 paket 50 pcs: maks 2 nama (misal: Andi 25 pcs, Budi 25 pcs)
- 2 paket 100 pcs: maks 4 nama
- Boleh 1 paket hanya 1 nama: Andi 50 pcs

REKENING PEMBAYARAN:
Bank: Bank Mandiri
No Rek: 1710016814843
A/N: PARE DIGITAL CUSTOM

PENGIRIMAN: Dari Kediri menggunakan JNE. Bisa COD.
```

**Label Otomatis:**
```
Hot Lead UV, Menunggu Transfer, Sudah Closing, Komplain
```

---

### STEP 2: Upload Media ke Masing-Masing Agent

> ⚠️ **SANGAT PENTING:** Pastikan Anda sedang memilih agent yang benar di dropdown sebelum upload. Media yang salah masuk ke agent yang salah = bot kirim foto DTF ke customer yang tanya UV.

**Cara Upload:**
1. Klik tab **"Media"** di sidebar kiri
2. Di bagian atas, pilih **Agent** yang sesuai (contoh: "Agent Label DTF")
3. Klik tombol **"Upload Baru"**
4. Pilih file dari komputer Anda
5. **Isi form dengan benar:**
   - **Label** → Ketik persis sesuai tabel di atas (contoh: `varian dtf`)
   - **Deskripsi** → Jelaskan isi media (contoh: "Foto 4 varian font label DTF untuk baju sekolah")
   - **Tujuan** → Pilih `Kirim ke Customer & Pengetahuan AI (Both)` untuk semua media
   - **Trigger Words** → Isi jika ada kata yang memicu media ini dikirim otomatis (contoh: `dtf, label kain, label setrika`)
6. Klik **"Upload"**
7. Tunggu status berubah menjadi ✅ **"Analisis Selesai"** sebelum melanjutkan
8. Ulangi untuk semua media (minimal 4 per agent)

---

### STEP 3: Hubungkan Nomor WA ke Agent yang Tepat

1. Klik tab **"Koneksi"** di sidebar
2. Pilih perangkat/nomor WA dari daftar
3. Di dropdown **"AI Agent"**, pilih agent yang sesuai:
   - Nomor WA untuk jualan Label DTF → pilih **"Agent Label DTF"**
   - Nomor WA untuk jualan Label UV → pilih **"Agent Label UV"**
4. Aktifkan toggle **"Auto-Reply AI"**
5. *(Opsional)* Isi **"Nama Bot Override"** jika nama CS untuk nomor ini berbeda dari default Agent (contoh: `Sari`)
6. Klik **"Simpan"**

---

### STEP 4: Tes Percakapan Sebelum Go Live

Setelah semua dikonfigurasi, lakukan tes dari nomor HP pribadi:
1. Kirim "halo" ke nomor WA yang sudah dikonfigurasi
2. Bot harusnya **otomatis mengirim gambar varian + video** produk yang sesuai
3. Jawab semua pertanyaan bot sampai ke tahap rekap pesanan
4. Pastikan rekap menampilkan harga dan ongkir yang benar
5. Jika ada yang salah, periksa kembali isi **Pengetahuan Produk** dan **Label Media**

---

## 🤖 CARA KERJA LENGKAP: DARI CUSTOMER MASUK HINGGA CLOSING

```
Customer kirim "halo"
    ↓
Bot otomatis kirim: Gambar Varian + Video Demo (sesuai produk agent)
    ↓
Bot tanya: Nama yang mau dicetak?
    ↓
Customer jawab: "tiara"
    ↓ (Tersimpan di memori: TEKS LABEL = Tiara)
Bot tanya: Berapa pcs nama Tiara? (Ingat max 2 nama/paket)
    ↓
Customer jawab: "50 pcs"
    ↓ (Tersimpan: JUMLAH = 50 pcs / 1 paket)
Bot tanya: Alamat kirimnya kak?
    ↓
Customer jawab: "Jl. Merdeka, Kec. Loceret, Kab. Nganjuk"
    ↓
Bot OTOMATIS hitung ongkir JNE dari Kediri ke Loceret, Nganjuk
    ↓
Bot kirim REKAP FINAL:
   ┌─────────────────────────────────┐
   │ 📋 REKAP PESANAN                │
   │ Nama: Tiara                     │
   │ Produk: Label DTF / UV          │
   │ Varian: [sesuai pilihan]        │
   │ Jumlah: 50 pcs (1 paket)        │
   │ Harga: Rp 37.000                │
   │ Ongkir: Rp [hasil cek]          │
   │ TOTAL: Rp [harga + ongkir]      │
   │                                 │
   │ 🏦 Mandiri: 1710016814843       │
   │ A/N: PARE DIGITAL CUSTOM        │
   └─────────────────────────────────┘
    ↓ (jika tidak ada reply 10 menit)
Follow-Up Stage 1 → Stage 2 → Stage 3 → Stage 4
    ↓ (jika customer reply kapanpun)
Semua follow-up DIBATALKAN otomatis
```

---

## ⚙️ KONFIGURASI TOGGLE & KONTROL MANUAL

### Toggle Global (Semua Customer)
- **Lokasi:** Tab Koneksi → Toggle **"Auto-Reply AI"**
- ✅ ON = Bot balas semua customer
- ❌ OFF = Bot diam total, pesan tetap dicatat

### Toggle Per-Customer (Human Override)
- **Lokasi:** Tab Live Chat → icon toggle di header chat
- ✅ ON = Bot balas customer ini
- ❌ OFF = Bot diam untuk customer ini, CS manusia ambil alih
- *(Follow-up otomatis juga ikut dinonaktifkan jika kontak di-pause)*

---

## 📊 CARA MONITORING DI DASHBOARD

### Tab Live Chat
| Indikator | Artinya |
|-----------|---------|
| Badge angka merah | Pesan belum dibaca CS |
| Dot hijau di avatar | Customer sedang online |
| "AI Menjawab" (biru) | Bot aktif untuk customer ini |
| "CS Ambil Alih" (merah) | Bot di-pause, CS manual aktif |

### Tab Rekap
Lihat ringkasan per customer. Field STATUS sangat penting:
- `opening` = Customer baru sapa, belum ada data
- `gali kebutuhan` = AI sedang tanya-jawab
- `menunggu alamat` = Tinggal perlu alamat untuk cek ongkir
- `menunggu transfer` = Rekap sudah dikirim, tunggu bayar
- `closing` / `selesai` = **Follow-up otomatis BERHENTI** untuk customer ini

### Tab Follow Up
| Status | Warna | Artinya |
|--------|-------|---------|
| Menunggu Kirim | 🟡 Kuning | Akan dikirim sesuai jadwal |
| Berhasil Dikirim | 🟢 Hijau | Sudah terkirim ke customer |
| Dibalas/Selesai | 🔵 Biru | Customer sudah membalas |
| Dibatalkan | ⚫ Abu | CS cancel manual atau bot OFF |

---

## 🛠️ TROUBLESHOOTING BOT NGAWUR / PELUPA

| Gejala | Penyebab | Solusi |
|--------|----------|--------|
| Bot tanya ulang nama padahal sudah dijawab | Memori belum ter-update (butuh minimal 3 interaksi) | Periksa tab Rekap, apakah summary sudah ter-update |
| Bot kirim foto salah produk | Salah agent terhubung ke nomor WA | Cek tab Koneksi, pilih agent yang benar |
| Bot tidak kirim foto/video saat opening | Label media salah atau media belum selesai analisis | Cek tab Media, pastikan label tepat dan status ✅ |
| Bot jawab harga tidak sesuai | Pengetahuan produk salah atau tidak lengkap | Update field "Pengetahuan Produk" di konfigurasi agent |
| Ongkir tidak muncul / ngawur | Customer tidak menyebut nama kecamatan | Bot sudah dikonfig untuk minta kecamatan. Jika masih salah, minta customer kirim alamat lengkap |
| Bot masih balas padahal sudah dimatikan | Ada proses Chrome zombie di background | Buka Task Manager → End task semua proses `chrome.exe` dan `node.exe` → restart server |
| Pesan lama tidak muncul di web | Chat sudah dibaca di HP sebelum bot nyala | Restart server agar sinkronisasi ulang (max 20 pesan × 15 chat terbaru) |

---

## 📝 GIT COMMIT (Simpan Perubahan ke Server)

Setelah konfigurasi selesai, simpan semua perubahan:
```bash
git add .
git commit -m "config: setup agent DTF and UV with media catalog"
git push
```

Lalu di Laptop Server:
```bash
git pull
# Tekan Ctrl+C untuk stop server lama
node index.js
```
