# 📘 PANDUAN PENGGUNAAN MAKSIMAL — CRM AI System
> **Versi:** Post-Refactoring 2026 (v2-core + Legacy Parity)  
> **Diperbarui:** Juni 2026  
> **Berlaku untuk:** Web App Dashboard + Bot WhatsApp (semua versi)

---

## ❓ PERTANYAAN YANG SERING MEMBINGUNGKAN (BACA DULU)

### "1 Toko = Berapa Agent?"

> ✅ **1 toko / 1 nomor WA = HANYA 1 AGENT**

Agent itu bukan spesifikasi per produk — agent adalah **"otak" dari 1 nomor WA**.  
1 agent bisa melayani **semua produk sekaligus** (DTF + UV + BTS) karena sistemnya fleksibel.

**Contoh nyata:**
- Toko A punya nomor WA khusus iklan label nama → 1 Agent (tapi bisa handle UV dan BTS juga)
- Toko B punya nomor WA lain → 1 Agent berbeda
- Toko A dan B bisa pakai template prompt yang sama tapi nama CS berbeda

### "Kalau pasang katalog dtf di 4 agent, apakah dobel?"

> ✅ **TIDAK DOBEL.** Setiap agent punya media library sendiri yang terpisah.

Media yang di-upload ke Agent A tidak terlihat oleh Agent B dan sebaliknya.  
Label `katalog dtf` di Agent A = record berbeda dari `katalog dtf` di Agent B.  
**Tidak perlu ganti nama jadi `katalog dtf1`, `katalog dtf2`.** Nama label tetap standar.

### "Kalau ada beberapa file berlabel sama di 1 agent, semua dikirim?"

> ✅ **TIDAK SEMUA.** Bot memilih **1 file secara random** dari yang berlabel sama.

Ini disengaja — anti-spam, dan membuat katalog yang dikirim terasa bervariasi setiap interaksi.

### "Inspector Agent itu agent ke-2 yang bisa dikonfigurasi?"

> ⚠️ **Inspector bukan agent terpisah yang dikonfigurasi dari dashboard.**

Inspector adalah **middleware validasi otomatis** yang berjalan di dalam kode setiap kali bot hendak mengirim rekap. Tidak ada tombol "aktifkan inspector" — dia selalu berjalan secara otomatis. Developer bisa mengubah schema validasinya di kode, tapi bukan dari dashboard.

---

## 📌 DAFTAR ISI

1. [Arsitektur Sistem](#1-arsitektur-sistem)
2. [Konsep 1 Agent = 1 Toko yang Fleksibel](#2-konsep-1-agent--1-toko-yang-fleksibel)
3. [Cara Kerja Media Per Agent](#3-cara-kerja-media-per-agent)
4. [Setup Awal](#4-setup-awal)
5. [Konfigurasi Agent](#5-konfigurasi-agent)
6. [Template Prompt Lengkap (Salin-Tempel)](#6-template-prompt-lengkap)
7. [Upload & Pelabelan Media](#7-upload--pelabelan-media)
8. [Koneksi Nomor WhatsApp ke Agent](#8-koneksi-nomor-whatsapp-ke-agent)
9. [Cara Kerja Bot (Alur Lengkap)](#9-cara-kerja-bot)
10. [Inspector Agent — Validasi Rekap Otomatis](#10-inspector-agent)
11. [Label Otomatis — Transfer-First Policy](#11-label-otomatis)
12. [Follow-Up Otomatis](#12-follow-up-otomatis)
13. [Dashboard — Pemantauan Harian](#13-dashboard)
14. [Tips Closing Maksimal](#14-tips-closing-maksimal)
15. [Troubleshooting & FAQ](#15-troubleshooting--faq)
16. [Checklist Setup Toko Baru](#16-checklist-setup-toko-baru)

---

## 1. Arsitektur Sistem

```
┌───────────────────────────────────────────────────────────────┐
│                       DATABASE (SQLite)                       │
│                                                               │
│  BotAgent: system_prompt | product_knowledge | auto_labels    │
│  MediaAsset: agent_id | label | type | purpose | ai_analysis  │
│  ↑ Media TERIKAT per agent_id (tidak bocor antar agent)       │
└───────────────────────┬───────────────────────────────────────┘
                        │
              ┌─────────┴─────────┐
              │  Nomor WA Toko A  │──── Agent A (DTF+UV+BTS)
              │  Nomor WA Toko B  │──── Agent B (DTF+UV+BTS)
              │  Nomor WA Toko C  │──── Agent C (fokus BTS)
              └─────────┬─────────┘
                        │
              ┌─────────▼─────────────────────────────────────┐
              │            AI SERVICE (ai_service.js)          │
              │                                                 │
              │  fullSystemInstruction = [                      │
              │    mediaKnowledgeBlock,  ← media AGENT INI saja│
              │    catalogBlock,         ← katalog AGENT INI   │
              │    labelBlock,           ← label dikonfigurasi  │
              │    learningBlock,        ← pola closing nyata   │
              │    conversationBlock,    ← status interaksi     │
              │    technicalRulesBlock,  ← aturan sistem        │
              │    agentPromptBlock,     ← system_prompt + KB   │
              │  ]                                              │
              └─────────┬───────────────────────────────────────┘
                        │
              ┌─────────▼───────────────────────────────────────┐
              │          AI MODEL (GPT-4o / GPT-5.x)            │
              │  Menghasilkan respons + tool calls               │
              └─────────┬───────────────────────────────────────┘
                        │ jika output = Rekap Pesanan
              ┌─────────▼───────────────────────────────────────┐
              │    INSPECTOR (Middleware Validasi Otomatis)       │
              │  Schema: DTF | UV | BTS — cek kelengkapan data   │
              │  ✅ Lolos → kirim ke customer                    │
              │  ❌ Tidak lolos → bot tanya data yang kurang     │
              └─────────┬───────────────────────────────────────┘
                        │
              ┌─────────▼───────────────────────────────────────┐
              │              CUSTOMER (WhatsApp)                 │
              └─────────────────────────────────────────────────┘
```

### 🔑 Prinsip Utama

> **"Prompt mengatur percakapan. Kode mengatur validasi data."**

- Product knowledge, harga, varian, alur → **diatur dari DB (field `system_prompt` + `product_knowledge` agent)**
- Kode hanya mengatur: validasi rekap, routing media, tool calls, anti-hallucination
- **Ganti harga, tambah produk, ubah alur → edit di Dashboard, tanpa deploy ulang**

---

## 2. Konsep 1 Agent = 1 Toko yang Fleksibel

### Skenario Realistis

| Toko | Nomor WA | Agent | Produk Utama | Bisa Handle |
|------|----------|-------|-------------|-------------|
| Toko A | +62-xxx-001 | Agent Toko A | DTF Label Nama | DTF + UV + BTS |
| Toko B | +62-xxx-002 | Agent Toko B | UV Stiker Keras | DTF + UV + BTS |
| Toko C | +62-xxx-003 | Agent Toko C | Bundling BTS | DTF + UV + BTS |

Masing-masing agent punya **system_prompt dan product_knowledge sendiri** yang memuat info semua produk, sehingga bisa melayani customer apapun yang mereka tanyakan.

### Mengapa Bukan 3 Agent Terpisah per Toko?

Karena WhatsApp hanya punya **1 nomor = 1 chat stream**. Customer yang chat ke Toko A akan selalu dilayani oleh Agent Toko A, tidak bisa pindah ke agent lain di tengah percakapan.

Agent yang baik adalah agent yang **tahu semua produk tapi punya identitas spesifik**:
- *"Halo bund! Saya Dini dari iklan label nama ya 😊 Mau label nama DTF atau stiker UV bund?"*
- Jika customer tanya BTS → langsung layani, kirim katalog BTS, proses hingga closing

### Kapan Butuh Agent Berbeda?

Hanya jika **nomor WA berbeda**. Contoh:
- Nomor WA khusus iklan label nama → Agent dengan nama "Dini" (fokus DTF)
- Nomor WA khusus iklan bundling → Agent dengan nama "Rini" (fokus BTS)
- Keduanya tetap bisa cross-sell produk lain

---

## 3. Cara Kerja Media Per Agent

### Isolasi Media Per Agent

```
Agent Toko A          Agent Toko B          Agent Toko C
────────────          ────────────          ────────────
katalog dtf  ✓        katalog dtf  ✓        katalog bts  ✓
video dtf    ✓        katalog uv   ✓        video bts    ✓
katalog uv   ✓        video uv     ✓        bundling     ✓
testimoni dtf✓        testimoni uv ✓
bundling     ✓
```

**Media Agent A tidak terlihat oleh Agent B.** Masing-masing punya library sendiri.  
Label boleh sama (`katalog dtf`) — tidak akan konflik antar agent.

### Beberapa File, Label Sama = Anti-Spam

Jika Agent A punya 3 file berlabel `katalog dtf`:
```
katalog dtf (file 1: font serif)
katalog dtf (file 2: font bold)
katalog dtf (file 3: mockup baju)
```
Bot akan **pilih 1 secara random** setiap kali kirim. Ini desain sengaja agar:
- Tidak spam banyak foto sekaligus
- Katalog yang dikirim bervariasi (tidak monoton)

### Rekomendasi Upload Media Per Agent (Minimal)

| Label | Jumlah File | Catatan |
|-------|-------------|---------|
| `katalog dtf` | 1-3 foto | Foto varian font DTF |
| `katalog uv` | 1-3 foto | Foto varian font UV |
| `katalog bts` | 1-3 foto | Foto contoh bundling BTS |
| `video dtf` | 1 video | Cara pasang label DTF |
| `video uv` | 1 video | Cara pasang stiker UV |
| `testimoni dtf` | 2-5 foto | Screenshot review customer |
| `testimoni uv` | 2-5 foto | Screenshot review customer |
| `bundling upsell` | 1-2 foto | Ditawarkan setelah closing |

---

## 4. Setup Awal

### Menjalankan Server

**Versi Legacy:**
```powershell
cd d:\CRM-AI
node index.js
```

**Versi v2-core:**
```powershell
cd d:\CRM-AI\v2-core\backend
node index.js
```

**Konfirmasi sukses (lihat log terminal):**
```
✅ Database SQLite Siap!
🤖 AI Service: Ready (model: gpt-4o-mini)
📅 [FollowUp] Scheduler aktif
🌐 Server berjalan di port 3001
```

**Akses Dashboard:**
```
http://localhost:3001         ← lokal
https://crm.datasdm.com      ← jika sudah Cloudflare
```

---

## 5. Konfigurasi Agent

### 5.1 Buat Agent Baru

1. Sidebar kiri → **"AI Agents"**
2. Klik **"Buat Agen Baru"**
3. Isi field:

| Field | Penjelasan | Contoh |
|-------|-----------|--------|
| **Nama Agen** | Internal, tidak kelihatan customer | `Agent Label Nama — Toko A` |
| **Nama Bot** | Nama CS muncul di sapaan | `Dini` |
| **System Prompt** | Kepribadian, alur, aturan percakapan | Lihat Section 6 |
| **Product Knowledge** | Harga, varian, data wajib, rekap | Lihat Section 6 |
| **Label Otomatis** | Label WA Business yang boleh dipakai | `Hot Lead, Menunggu Transfer, COD, Transfer, Closing` |

### 5.2 Placeholder di System Prompt

| Placeholder | Diganti Otomatis |
|-------------|-----------------|
| `{BOT_NAME}` | Nama bot dari field "Nama Bot" |

### 5.3 Label Otomatis — Aturan Pengisian

Tulis **persis sama** dengan yang ada di WhatsApp Business (case-sensitive), pisahkan koma:
```
AI Lead Baru, AI Lead Aktif, Menunggu Rekap, Menunggu Transfer, COD, Transfer, DP, Closing, Cancel
```
⚠️ **Wajib:** Pastikan semua label di atas diketik persis seperti itu (huruf besar/kecil berpengaruh). Bot hanya boleh pakai label dari daftar ini. Label di luar daftar = diabaikan sistem.

---

## 6. Template Prompt Lengkap

> **SALIN-TEMPEL ke kolom System Prompt dan Product Knowledge.**  
> Sesuaikan **rekening, nama toko, dan harga** dengan data Anda sendiri.

---

### 🔵 TEMPLATE UNIVERSAL — Cocok untuk Semua Toko

> Agent ini bisa handle DTF + UV + BTS sekaligus. Paling direkomendasikan untuk toko yang iklannya fokus 1 produk tapi bisa cross-sell.

---

**⬇️ SYSTEM PROMPT (salin ke kolom System Prompt):**

```
Kamu adalah {BOT_NAME}, admin customer service dari slaludiskon.com yang ramah dan natural 😊

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IDENTITAS & FLEKSIBILITAS PRODUK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Agent ini UTAMANYA melayani produk Label Nama DTF (bahan setrika untuk baju, seragam, hijab, kain).

Namun kamu WAJIB melayani customer yang minta produk lain dengan sepenuh hati:
- Customer minta UV (botol, helm, tumbler, kaca) → LAYANI, kirim katalog uv via tool
- Customer minta BTS (bundling) → LAYANI, kirim katalog bts via tool
- JANGAN tolak customer hanya karena produk berbeda

Tentukan produk berdasarkan KEBUTUHAN customer, bukan berdasarkan nama agent ini.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ATURAN BUBBLE & GAYA BAHASA (WAJIB)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Satu respons = MAKSIMAL 2 bubble pendek
✅ Sapaan WAJIB: "bun" atau "bunda" — DILARANG pakai "kak"
✅ Emoji secukupnya: 😊 🥰 🙏 (jangan berlebihan)
✅ Akhiri dengan pertanyaan menggiring closing (kecuali rekap dan estimasi)
✅ Natural seperti CS manusia asli — hindari kalimat robotik/template berulang

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
URUTAN MENGGALI DATA (WAJIB, SATU PERTANYAAN PER GILIRAN)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Untuk DTF:
  Nama Cetak → Varian DTF → Warna DTF → Jumlah → Alamat → Ongkir → Rekap

Untuk UV:
  Nama Cetak → Varian UV → Jumlah → Alamat → Ongkir → Rekap
  ⚠️ UV TIDAK ADA PILIHAN WARNA — JANGAN TANYA WARNA UNTUK UV!

Untuk BTS:
  Nama Cetak → Desain Stiker Buku → Desain Alat Tulis → Desain Tempat Makan
  → Varian Bonus DTF → Warna Bonus DTF → Jumlah → Alamat → Ongkir → Rekap

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ATURAN REKAP & CLOSING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- DEFAULT pengiriman = NON COD (Transfer). COD hanya jika customer EKSPLISIT minta.
- JANGAN kirim rekap sebelum SEMUA data wajib lengkap (lihat Product Knowledge).
- Setelah rekap → tunggu customer konfirmasi "IYA" baru proses closing.
- Setelah closing Transfer: tunggu bukti transfer dulu sebelum label Closing dipasang.
- Setelah closing selesai: tawarkan Bundling BTS sebagai upsell (1x saja).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DILARANG KERAS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ Tanya ulang data yang sudah ada
❌ Tulis URL, link, atau ID media di teks balasan
❌ Sebut nama ekspedisi (JNE, J&T, dll) ke customer
❌ COD murni untuk pesanan >2 paket atau luar Jawa >1 paket
❌ Panggil matikan_bot_kontak setelah Closing
❌ Kirim lebih dari 2 bubble per respons
❌ Kalimat robotik yang sama berulang-ulang
```

---

**⬇️ PRODUCT KNOWLEDGE (salin ke kolom Product Knowledge):**

> ⚠️ **WAJIB SESUAIKAN** bagian rekening dan harga dengan data toko Anda!

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRODUK 1: DTF LABEL NAMA (BAJU/KAIN)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Harga  : Rp 39.000 per paket
Isi    : 50 pcs per paket
Bahan  : DTF (Direct to Film) — untuk baju, seragam, hijab, kain
Nama   : Maksimal 2 nama berbeda per paket

DATA WAJIB SEBELUM REKAP (cek semua ini dulu):
✅ Nama yang mau dicetak (minimal 1)
✅ Varian font (Varian 1 / Varian 2 / Varian 3 / Varian 4)
✅ Warna label (Pink / Kuning / Putih / Hijau / Biru / Hitam)
✅ Jumlah paket (angka)
✅ Alamat lengkap (minimal Kecamatan + Kota)
✅ Ongkir (wajib cek_ongkir dulu)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRODUK 2: UV DTF TIMBUL (STIKER KERAS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Harga  : Rp 39.000 per paket
Isi    : 60 pcs per paket
Bahan  : UV DTF — stiker keras/timbul anti air
Pakai  : Botol, helm, tumbler, kaca, plastik
Nama   : Maksimal 2 nama berbeda per paket

⚠️ UV TIDAK ADA PILIHAN WARNA. Varian UV: Cowok / Cewek / Polos
   Jangan tanya warna untuk produk UV!

DATA WAJIB SEBELUM REKAP UV:
✅ Nama yang mau dicetak (minimal 1)
✅ Varian UV (Cowok / Cewek / Polos)
✅ Jumlah paket (angka)
✅ Alamat lengkap (minimal Kecamatan + Kota)
✅ Ongkir (wajib cek_ongkir dulu)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRODUK 3: BUNDLING BTS (BACK TO SCHOOL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Harga    : Rp 97.000 per bundle
Subsidi  : Ongkir disubsidi Rp 20.000
           (ongkir ≤ Rp 20.000 → customer bayar Rp 0)
           (ongkir > Rp 20.000 → customer bayar selisihnya)

Isi 1 bundle:
- Stiker Buku (nama sama)
- Stiker Alat Tulis (nama sama)
- Stiker Tempat Makan (nama sama)
- Bonus Label DTF (nama sama, pilih varian & warna)

DATA WAJIB SEBELUM REKAP BTS:
✅ Nama Cetak (berlaku untuk semua komponen)
✅ Desain Stiker Buku (pilihan desain)
✅ Desain Stiker Alat Tulis (pilihan desain)
✅ Desain Stiker Tempat Makan (pilihan desain)
✅ Varian Bonus DTF (Varian 1 / 2 / 3 / 4)
✅ Warna Bonus DTF (Pink / Kuning / Putih / Hijau / Biru / Hitam)
✅ Jumlah bundle (angka)
✅ Alamat lengkap (minimal Kecamatan + Kota)
✅ Ongkir (cek_ongkir) → kurangi subsidi Rp 20.000

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMAT REKAP — WAJIB PAKAI FORMAT INI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Rekap dikirim SATU KALI setelah data lengkap. Jangan kirim rekening di dalam rekap awal. Rekening dikirim SETELAH customer membalas IYA.

Rekap pesanan Bunda [Nama Penerima]:

Produk: [Label Nama DTF / UV DTF Timbul / Bundling BTS]
Nama cetak:
- [Nama 1]: [jumlah] pcs
- [Nama 2]: [jumlah] pcs
Varian: [Varian yang dipilih]
Warna: [Warna — untuk UV tulis: Sesuai desain varian]
Jumlah: [X] Paket
Harga produk: Rp[Total harga produk]

Metode pembayaran: [Transfer / COD / DP + COD]
Nama penerima: [Nama penerima]
No. WA: [Terisi otomatis oleh sistem]
Alamat: [Alamat lengkap]
Kode pos: [Kode pos atau -]
Ongkir awal: Rp[Ongkir dari cek_ongkir]
Potongan ongkir: Rp[total diskon]
Ongkir dibayar: Rp[Ongkir final]
Total pesanan: Rp[Total harga produk + Ongkir final]
DP minimum: Rp[nominal], hanya untuk DP_COD
Sisa COD: Rp[sisa], hanya untuk COD atau DP_COD
Catatan: -

Mohon dicek ya bund, terutama nama cetak, varian, warna, dan alamatnya 🥰
Mohon balas IYA jika sudah sesuai 🙏

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMAT REKENING (Dikirim SETELAH balas IYA)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Silakan Transfer ke rekening berikut:
🏦 [NAMA BANK]: [NOMOR REKENING]
a.n. [NAMA PEMILIK]

Setelah Transfer, kirim bukti pembayarannya ya, Bun 😊

⚠️ GANTI BAGIAN REKENING DI ATAS DENGAN REKENING TOKO ANDA SENDIRI!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ATURAN ONGKIR & METODE BAYAR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Tidak ada gratis ongkir untuk order reguler DTF/UV
- Jika customer komplain ongkir → diskon Rp 3.000 saja (bukan lebih)
- Jika customer komplain ongkir + belum beli bundling → tawarkan BTS (subsidi Rp 20.000)
- COD murni dilarang untuk: >2 paket ATAU luar Jawa >1 paket

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ESTIMASI (wajib dikirim saat closing)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Transfer: 2-3 hari pengerjaan
COD     : 3-4 hari pengerjaan

Estimasi pengiriman:
📦 Pulau Jawa: 3-5 hari
📦 Pulau Bali: 5-6 hari
📦 Pulau Sumatra: 7-8 hari kerja
📦 Pulau Kalimantan/Sulawesi: 8-9 hari kerja

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
UPSELL BUNDLING BTS (setelah closing)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Setelah mengirimkan estimasi di closing → tawarkan bundling BTS 1x.
Kirim foto via tool: label "bundling upsell"
Jika customer tidak tertarik → akhiri natural tanpa memaksa.
Jangan tawarkan lagi jika sudah pernah ditolak di percakapan ini.
```

---

## 7. Upload & Pelabelan Media

> ⚠️ **Label media adalah hal paling kritis.** Satu karakter beda = media tidak terkirim.

### 7.1 Tabel Label Standar (Wajib Pakai Nama Ini)

| Label (PERSIS INI) | Tipe | Fungsi |
|--------------------|------|--------|
| `katalog dtf` | 📷 Foto | Dikirim saat customer tanya/opening DTF |
| `katalog uv` | 📷 Foto | Dikirim saat customer tanya/opening UV |
| `katalog bts` | 📷 Foto | Dikirim saat customer tanya bundling BTS |
| `video dtf` | 🎬 Video | Tutorial cara pasang label DTF |
| `video uv` | 🎬 Video | Tutorial cara tempel stiker UV |
| `video bts` | 🎬 Video | Penjelasan bundling BTS |
| `testimoni dtf` | 📷 Foto | Screenshot review/hasil customer DTF |
| `testimoni uv` | 📷 Foto | Screenshot review/hasil customer UV |
| `testimoni bts` | 📷 Foto | Screenshot review/hasil customer BTS |
| `bundling upsell` | 📷 Foto | Ditawarkan setelah closing (upsell) |
| `value dtf` | 📷 Foto | Keunggulan produk DTF |
| `value uv` | 📷 Foto | Keunggulan produk UV |

### 7.2 Cara Upload

1. Sidebar kiri → **"Media"**
2. Pastikan agent yang aktif **sudah benar** (lihat dropdown di atas tabel media)
3. Klik **"Upload Baru"**
4. Pilih file → isi:
   - **Label**: tulis persis seperti tabel (huruf kecil, pakai spasi)
   - **Deskripsi**: jelaskan singkat isi media (bantu AI memahami konteks)
   - **Purpose**:
     - `both` = AI tahu kontennya + bisa dikirim ke customer (paling umum)
     - `knowledge_only` = AI tahu tapi tidak dikirim ke customer
     - `send_only` = bisa dikirim tapi AI tidak "mempelajari" kontennya
5. Klik **"Upload"** → tunggu status: **"✅ Analisis Vision AI Selesai"**

### 7.3 Pertanyaan Umum Media

| Pertanyaan | Jawaban |
|-----------|---------|
| Boleh upload katalog dtf ke 4 agent? | ✅ Ya, tidak ada konflik |
| Boleh kasih nama katalog dtf1, dtf2? | ❌ Jangan — label standar yang dikenali sistem adalah `katalog dtf` |
| Kalau ada 3 foto berlabel sama, semua dikirim? | ❌ Hanya 1 dipilih random (anti-spam) |
| Apakah media satu agent bisa dilihat agent lain? | ❌ Tidak, isolasi per agent_id |

---

## 8. Koneksi Nomor WhatsApp ke Agent

1. Sidebar kiri → **"Koneksi"**
2. Pilih perangkat/nomor WA dari daftar
3. Di field **"AI Agent"** → pilih agent yang sesuai
4. Aktifkan toggle **"Auto-Reply AI"**
5. Isi **"Nama Bot Override"** jika nama CS berbeda dari default agent
6. Klik **"Simpan"** → scan QR jika perlu

> 💡 **Multi-Toko:** Nomor WA A → Agent A. Nomor WA B → Agent B. Satu agent bisa dipakai beberapa nomor WA, tapi rekomendasi terbaik: 1 nomor = 1 agent khusus.

---

## 9. Cara Kerja Bot

### 9.1 Alur Percakapan

```
Customer kirim pesan pertama
    ↓
[INTERAKSI #1 — WAJIB]
  1. Kirim katalog + video produk (tool kirim_media_katalog)
  2. Sambut dengan nama customer jika ada
  3. Tanya produk yang diinginkan jika belum jelas

    ↓ (jika produk sudah jelas)

[INTERAKSI #2-N — GALI DATA, SATU PER GILIRAN]
  DTF : Nama → Varian → Warna → Jumlah → Alamat
  UV  : Nama → Varian → Jumlah → Alamat
  BTS : Nama → Desain Buku → Desain Alat Tulis → Desain Makan
      → Varian Bonus → Warna Bonus → Jumlah → Alamat

    ↓ (semua data lengkap)

[CEK ONGKIR — tool cek_ongkir]
  → Sampaikan harga ongkir apa adanya
  → JANGAN sebut nama ekspedisi
  → Customer komplain ongkir → diskon Rp 3.000
  → Customer komplain ongkir + belum beli BTS → tawarkan BTS

    ↓ (Inspector cek kelengkapan rekap)

[KIRIM REKAP — hanya jika SEMUA data lengkap dan Inspector lolos]
  → Customer diminta konfirmasi "IYA"

    ↓ CLOSING COD
  1. Customer konfirmasi IYA
  2. Kirim estimasi pengerjaan + pengiriman
  3. Label: ["COD", "Closing"]
  4. Tawarkan upsell BTS (1x)

    ↓ CLOSING TRANSFER (2 tahap)
  TAHAP A: Customer konfirmasi IYA
    → Kirim instruksi rekening, minta bukti TF
    → Label: ["Menunggu Transfer"]

  TAHAP B: Customer kirim foto bukti transfer
    → Sistem Vision AI kenali bukti transfer
    → Kirim estimasi
    → Label: ["Transfer", "Closing"]
    → Tawarkan upsell BTS (1x)
```

### 9.2 Aturan Default Metode Bayar

| Kondisi | Di Rekap | Label |
|---------|----------|-------|
| Customer belum sebut bayar apapun | `NON COD (Transfer)` | `Menunggu Transfer` |
| Customer eksplisit bilang "COD" | `COD` | `COD` → lalu `COD, Closing` |
| Customer kirim bukti TF | Update ke `NON COD` | `Transfer, Closing` |
| Customer bayar DP | Isi field `Total Terbayar (DP)` dan `Sisa Bayar` | `Menunggu Transfer` |

---

## 10. Inspector Agent

### Apa Itu Inspector?

Inspector adalah **middleware validasi otomatis** yang berjalan di dalam kode — bukan agent terpisah di dashboard.

Cara kerja:
1. Bot AI membuat draft rekap
2. Sistem deteksi bahwa output = rekap pesanan
3. **Inspector Agent** (model AI tersendiri, `temperature: 0.0`) mengecek kelengkapan
4. ✅ Lolos → rekap dikirim ke customer
5. ❌ Tidak lolos → bot menahan rekap, tanya data yang kurang ke customer

### Inspector Berjalan Otomatis

**Tidak ada tombol aktifkan Inspector.** Dia selalu berjalan kapanpun bot hendak kirim rekap.  
Jika Inspector error (mis. API down) → rekap tetap lolos (non-blocking, tidak pernah blokir customer).

### Schema Validasi Per Produk

| Produk | Field Wajib Terisi |
|--------|-------------------|
| **DTF** | Nama Cetak, Varian, Warna, Jumlah, Alamat, Ongkir, Total, Metode |
| **UV** | Nama Cetak, Varian (Cowok/Cewek/Polos), Jumlah, Alamat, Ongkir, Total, Metode |
| **BTS** | Nama, Desain Buku, Desain Alat Tulis, Desain Makan, Varian Bonus, Warna Bonus, Jumlah, Alamat, Ongkir, Total, Metode |

Inspector mendeteksi produk dari konteks rekap → pilih schema yang sesuai secara otomatis.

---

## 11. Label Otomatis

### Kapan Label Dipasang

| Label | Kondisi |
|-------|---------|
| `Hot Lead` | Customer antusias tapi belum order |
| `Menunggu Rekap` | Customer minta rekap / konfirmasi pesanan |
| `Menunggu Transfer` | Customer konfirmasi "IYA" (default transfer) |
| `COD` | Customer eksplisit minta COD |
| `Transfer, Closing` | Customer kirim bukti transfer valid |
| `COD, Closing` | Customer COD konfirmasi setelah rekap dikirim |

### Aturan Kritis

- ❌ JANGAN pasang `COD, Closing` jika customer transfer
- ❌ JANGAN pasang `Transfer, Closing` jika customer COD
- ❌ `Transfer` dan `COD` tidak boleh bersamaan
- ✅ Jika rekap tercatat COD tapi customer transfer → otomatis ganti ke `Transfer, Closing`

---

## 12. Follow-Up Otomatis

### Alur 4 Stage

```
Customer tidak reply selama 10 menit
    ↓ Stage 1 — Kirim video produk + teks reminder personal
Masih tidak reply 1 jam
    ↓ Stage 2 — Kirim foto testimoni + social proof
Masih tidak reply (jam 19:00)
    ↓ Stage 3 — Kirim video + urgency closing malam ini
Masih tidak reply (jam 06:00 esok)
    ↓ Stage 4 — Kirim foto + sapaan pagi

Customer reply kapanpun → SEMUA follow-up pending DIBATALKAN otomatis
```

### Media Follow-Up (Per Produk)

Follow-up memilih media sesuai produk yang tercatat:
- Produk DTF → `video dtf`, `testimoni dtf`
- Produk UV → `video uv`, `testimoni uv`
- Produk BTS → `video bts`, `testimoni bts`

**Pastikan semua media ini sudah di-upload per agent!**

---

## 13. Dashboard

### Tab Live Chat

| Fitur | Cara Pakai |
|-------|-----------|
| Badge merah | Pesan belum dibaca CS |
| Toggle AI per-kontak | Matikan untuk CS manusia ambil alih |
| Rekap Pembahasan | Panel kanan: lihat semua data customer |
| Quoted Reply | Klik ikon reply pada bubble chat |

### Tab Media

| Fitur | Cara Pakai |
|-------|-----------|
| Filter by Agent | Dropdown agent di atas tabel |
| Status Vision AI | Tunggu "✅ Analisis Selesai" |
| Edit Label | Klik label langsung |

### Tab AI Agents

| Fitur | Cara Pakai |
|-------|-----------|
| Edit System Prompt | Ubah tanpa restart server |
| Edit Product Knowledge | Ubah harga, varian, dll tanpa deploy |
| Auto Labels | Tambah/hapus label yang boleh dipakai bot |

---

## 14. Tips Closing Maksimal

### Prioritas Media yang Paling Efektif

| Prioritas | Tipe | Dampak |
|-----------|------|--------|
| 🥇 1 | Video cara pasang/demo produk | Trust tinggi, customer paham produk |
| 🥈 2 | Foto katalog varian (multiple file) | Visual menarik, customer bisa pilih |
| 🥉 3 | Screenshot testimoni real | Social proof, kurangi keraguan |
| 4 | Foto keunggulan produk | Untuk customer ragu harga |

### Strategi Transfer-First

Bot default mengarahkan ke Transfer karena:
- Proses 1 hari lebih cepat (2-3 hari vs 3-4 hari)
- Lebih aman bagi penjual
- Tidak bisa ditolak kurir di lokasi

Gunakan kalimat: *"Kalau transfer bund, pesanannya masuk PRIORITAS jadi lebih cepat selesai 😊"*

### Pemantauan Harian (5 Menit)

1. 🏷️ Cek `Hot Lead` yang stuck > 2 jam → CS manusia ambil alih
2. 🔵 Cek `Menunggu Transfer` > 24 jam → follow-up manual
3. ❌ Cek chat tanpa label → bot mungkin tidak aktif
4. 📊 Cek Follow-Up tab → apakah stage 1 banyak tidak lanjut? (edit copy follow-up)

---

## 15. Troubleshooting & FAQ

### Masalah Umum

| Masalah | Penyebab | Solusi |
|---------|---------|--------|
| Bot tidak membalas | Toggle AI OFF / Agent belum terhubung | Tab Koneksi → aktifkan toggle |
| Bot tidak kirim katalog di opening | Media belum upload / label salah | Cek tab Media, pastikan label persis `katalog dtf` |
| Bot kirim banyak gambar | Bug lama (sudah diperbaiki di versi terbaru) | Update ke versi terbaru |
| Bot tanya data yang sudah ada | Chat < 3 pesan (summary belum aktif) | Normal, akan aktif setelah 3+ interaksi |
| Ongkir tidak muncul | Alamat tidak ada Kecamatan | Minta customer sebut Kecamatan dan Kota |
| Label tidak terpasang | Label tidak ada di daftar auto_labels | Tambah di field "Label Otomatis" agent |
| Bot tulis "kak" | System prompt tidak ada instruksi sapaan | Update system prompt |
| Rekap dikirim sebelum data lengkap | Inspector tidak mendeteksi pola rekap | Cek format rekap sesuai pattern sistem |
| Bot spam gambar yang sama | Versi lama | Pastikan pakai versi post-refactoring |
| Field Warna UV kosong | Instruksi tidak ada | Tambahkan di product knowledge: "UV tulis Sesuai desain varian" |
| Rekening salah di rekap | Rekening di product knowledge salah | Update product knowledge agent |

### FAQ

**Q: Harus buat berapa agent?**  
A: 1 agent per nomor WA. Toko punya 3 nomor WA → 3 agent. Tapi setiap agent bisa handle semua produk.

**Q: Rekening di rekap yang mana yang benar?**  
A: Rekening yang ada di **Product Knowledge agent Anda**. Tidak ada rekening yang di-hardcode di sistem — Anda yang tentukan sendiri di kolom Product Knowledge. Panduan ini sengaja tidak menulis rekening agar tidak salah salin.

**Q: Inspector bisa dikonfigurasi dari dashboard?**  
A: Belum. Inspector adalah middleware kode. Schema validator DTF/UV/BTS sudah ada di kode. Developer bisa edit schema-nya, tapi belum ada UI untuk konfigurasi dari dashboard.

**Q: Kalau customer tanya produk yang tidak ada di knowledge, bot bisa jawab?**  
A: Bot akan menjawab sesuai product knowledge yang ada. Jika produk benar-benar tidak ada → bot sebaiknya jujur dan minta CS manusia untuk ditangani (via matikan_bot_kontak jika diperlukan).

**Q: Apakah bot bisa dimatikan sementara per kontak?**  
A: Ya. Di Tab Live Chat, toggle AI pada header chat customer bisa di-OFF per kontak.

**Q: Nomor WA di rekap darimana?**  
A: Diinjeksi otomatis oleh sistem dari identitas chat WhatsApp — tidak perlu ditanya ke customer.

---

## 16. Checklist Setup Toko Baru

```
SETUP AGENT:
[ ] Buat agent baru (nama internal jelas, mis: "Agent Label Nama Toko A")
[ ] Isi System Prompt dari template Section 6
[ ] Isi Product Knowledge dari template Section 6
[ ] ⚠️ Ganti rekening bank di Product Knowledge dengan rekening toko
[ ] Isi auto_labels: Hot Lead, Menunggu Transfer, COD, Transfer, Closing, Menunggu Rekap

UPLOAD MEDIA (minimal wajib):
[ ] katalog dtf  (foto varian font DTF)
[ ] video dtf    (video cara pasang DTF)
[ ] katalog uv   (foto varian font UV)
[ ] video uv     (video cara pasang UV)
[ ] testimoni dtf (foto review customer)
[ ] testimoni uv  (foto review customer)
[ ] bundling upsell (foto penawaran bundling)

KONEKSI:
[ ] Hubungkan nomor WA ke agent yang benar
[ ] Aktifkan toggle Auto-Reply AI
[ ] Isi Nama Bot Override (nama CS per nomor)
[ ] Scan QR Code jika belum terhubung

VERIFIKASI:
[ ] Kirim pesan test dari nomor lain → bot kirim katalog di respons pertama
[ ] Cek apakah bot tanya data satu per satu (tidak borongan)
[ ] Test rekap: isi semua data → Inspector tidak blokir
[ ] Test rekap parsial: Inspector tanya data yang kurang
[ ] Cek label terpasang setelah closing test
[ ] Restart server jika ada update kode
```

---

## 📝 Catatan Penting untuk Owner

1. **Rekening**: Tidak ada rekening yang di-hardcode di sistem. Anda wajib isi rekening yang benar di kolom **Product Knowledge** setiap agent. Panduan ini tidak menulis rekening spesifik agar tidak salah salin.

2. **Harga**: Sama seperti rekening — harga diambil dari Product Knowledge, bukan dari kode. Ubah harga cukup di dashboard.

3. **Nama toko/domain**: Ganti `slaludiskon.com` di System Prompt dengan nama toko/domain toko Anda.

4. **Inspector**: Selalu aktif otomatis — tidak perlu setup. Jika ada rekap yang lolos padahal data kurang, kemungkinan pola rekap tidak cocok dengan format standar.

5. **Update**: Jika ada perubahan kode, restart server. Perubahan di dashboard (prompt, knowledge, media) tidak perlu restart.

---

*Panduan ini berlaku untuk versi CRM AI post-refactoring Juni 2026.*  
*File: `d:\CRM-AI\docs\19_PANDUAN_MAKSIMAL.md`*
