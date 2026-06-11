# Mesin AI (AI Engine)

> **Proyek:** CRM-AI v2-core  
> **Dokumen:** 06_AI_ENGINE.md  
> **Bahasa:** Bahasa Indonesia  
> **Terakhir diperbarui:** 2026-06-08

---

## Daftar Isi

1. [Ringkasan](#1-ringkasan)
2. [AI Providers yang Didukung](#2-ai-providers-yang-didukung)
3. [Konfigurasi Environment Variables](#3-konfigurasi-environment-variables)
4. [AI Tools](#4-ai-tools)
5. [Media Analysis Pipeline](#5-media-analysis-pipeline)
6. [Voice Note Transcription](#6-voice-note-transcription)
7. [Learning / Pattern System](#7-learning--pattern-system)
8. [Auto-Labeling Integration](#8-auto-labeling-integration)
9. [Troubleshooting Masalah AI Umum](#9-troubleshooting-masalah-ai-umum)
10. [Struktur File AI Engine](#10-struktur-file-ai-engine)

---

## 1. Ringkasan

**AI Engine** adalah inti kecerdasan buatan dari CRM-AI v2-core. Mesin ini bertanggung jawab untuk:

- Menjawab pertanyaan pelanggan secara otomatis via WhatsApp
- Menganalisis media (gambar / video) untuk knowledge AI
- Mentranskripsi voice notes menjadi teks
- Menyediakan tools untuk interaksi lanjutan (cek ongkir, kirim katalog, dll)
- Belajar dari percakapan sukses (closing) untuk meningkatkan performa
- Memberi label otomatis ke kontak WhatsApp berdasarkan status percakapan

AI Engine menggunakan arsitektur provider-agnostic dengan dukungan OpenAI dan Groq, serta mekanisme fallback otomatis jika salah satu provider tidak tersedia.

(rest to be appended)

## 2. AI Providers yang Didukung

### 2.1 OpenAI

| Item                | Detail                                |
|---------------------|---------------------------------------|
| **Endpoint**        | `https://api.openai.com/v1`           |
| **API Key**         | `OPENAI_API_KEY` (env)                |
| **Default Model**   | `gpt-4o-mini` (dari `MODEL_NAME`)     |
| **Vision Model**    | `gpt-4o` (hardcoded untuk analisis gambar) |
| **Audio Model**     | `whisper-1` (transkripsi voice note)  |

OpenAI digunakan sebagai provider utama untuk:
- **Chat completion** (menjawab pelanggan) -- via `ai_service.js`
- **Vision AI** (analisis gambar) -- via `vision_service.js`
- **Transkripsi suara** (voice note) -- via `ai_service.js`
- **Generate summary** percakapan -- via `ai_service.js`
- **Learning / Pattern Analysis** -- via `learning_service.js`

> Penting: OpenAI API Key wajib diawali `sk-`. Jika tidak valid, sistem mengembalikan fallback.

### 2.2 Groq

| Item                | Detail                                       |
|---------------------|----------------------------------------------|
| **Endpoint**        | `https://api.groq.com/openai/v1`             |
| **API Keys**        | `GROQ_API_KEYS` (env, comma-separated)       |
| **Default Model Text** | `llama-3.3-70b-versatile`                 |
| **Default Model Audio** | `whisper-large-v3`                        |

Groq digunakan untuk:
- **Transkripsi audio** (voice note & video) -- via `groq_manager.js` dengan load balancing round-robin
- **Alternatif chat completion** (masa depan)

**Load Balancing Round-Robin:** Multiple API keys dirotasi. Jika key terkena rate limit (429) atau server error (5xx), otomatis ke key berikutnya.

### 2.3 Fallback Mechanism

1. **Groq -> OpenAI (Audio):** Jika semua key Groq habis, transkripsi fallback ke OpenAI Whisper (`whisper-1`).
2. **OpenAI -> Fallback Text:** Jika OpenAI API key tidak valid, sistem mengembalikan pesan error fallback.
3. **Provider Requirement:** Minimal satu provider (OpenAI atau Groq) harus dikonfigurasi.

## 3. Konfigurasi Environment Variables

Konfigurasi AI engine disimpan di `backend/.env`, dibaca menggunakan `dotenv`.

### 3.1 Tabel Lengkap Environment Variables AI

| Variabel                          | Wajib   | Default                    | Deskripsi                                                  |
|-----------------------------------|---------|----------------------------|------------------------------------------------------------|
| `OPENAI_API_KEY`                  | Ya*     | --                         | API Key OpenAI. Wajib jika GROQ tidak diisi.               |
| `MODEL_NAME`                      | Tidak   | `gpt-4o-mini`              | Model OpenAI untuk chat completion.                        |
| `GROQ_API_KEYS`                   | Ya*     | --                         | API Key(s) Groq, comma-separated.                          |
| `GROQ_MODEL_TEXT`                 | Tidak   | `llama-3.3-70b-versatile`  | Model Groq untuk text generation.                          |
| `GROQ_MODEL_AUDIO`                | Tidak   | `whisper-large-v3`         | Model Groq untuk transkripsi audio.                        |
| `CLIENT_NAME`                     | Tidak   | `WA-AI-CS-Bot`             | Nama klien untuk identifikasi sistem.                      |
| `ORIGIN_NAME`                     | Tidak   | `Kediri`                   | Nama kota asal pengiriman (default cek ongkir).            |
| `RAJAONGKIR_API_KEY`              | Tidak   | --                         | API Key RajaOngkir untuk pengecekan ongkos kirim.          |
| `OPENAI_CHAT_TIMEOUT_MS`          | Tidak   | `18000`                    | Timeout (ms) panggilan chat completion OpenAI.             |
| `OPENAI_SECOND_CALL_TIMEOUT_MS`   | Tidak   | `10000`                    | Timeout (ms) panggilan kedua (setelah tool call).          |
| `OPENAI_TRANSCRIPTION_TIMEOUT_MS` | Tidak   | `30000`                    | Timeout (ms) transkripsi audio OpenAI.                     |
| `OPENAI_TRANSCRIPTION_RETRIES`    | Tidak   | `2`                        | Jumlah retry transkripsi jika gagal.                        |
| `AI_MEDIA_FAST_REPLY_ENABLED`     | Tidak   | `true`                     | Aktifkan fast reply media.                                 |
| `AI_MAX_BUBBLE_WORDS`             | Tidak   | `10`                       | Maksimal kata per bubble chat AI.                          |
| `FFMPEG_PATH`                     | Tidak   | `ffmpeg`                   | Path binary ffmpeg untuk ekstraksi audio video.            |
| `FFPROBE_PATH`                    | Tidak   | `ffprobe`                  | Path binary ffprobe untuk metadata video.                  |
| `MEDIA_VIDEO_OPTIMIZE_ENABLED`    | Tidak   | `true`                     | Optimasi video untuk WhatsApp.                             |
| `MEDIA_VIDEO_OPTIMIZE_THRESHOLD_MB` | Tidak | `25`                      | Threshold ukuran video (MB) untuk optimasi.                |
| `MEDIA_VIDEO_OPTIMIZE_TIMEOUT_MS` | Tidak   | `120000`                   | Timeout (ms) optimasi video ffmpeg.                        |

> Catatan: `*` -- Minimal salah satu dari `OPENAI_API_KEY` atau `GROQ_API_KEYS` harus diisi.

## 4. AI Tools

AI Engine menyediakan **5 tools** yang dapat dipanggil AI via function calling ke OpenAI.

### 4.1 cek_ongkir

**Fungsi:** Mengecek biaya ongkos kirim J&T dari Kediri ke kota tujuan di Indonesia.

| Parameter         | Tipe    | Wajib | Deskripsi                                                    |
|-------------------|---------|-------|--------------------------------------------------------------|
| `destinationCity` | string  | Ya    | Kecamatan dan Kota/Kabupaten. Contoh: `Loceret, Nganjuk`     |
| `weightGrams`     | integer | Tidak | Berat paket dalam gram (default: 1000).                      |

Alur: AI panggil tool -> `mengantar_service.js` -> API Mengantar -> hasil ongkir dikembalikan ke AI.
Caching: 7 hari di `mengantar_cache.json`.

### 4.2 kirim_media_katalog

**Fungsi:** Mengirim foto/video produk ke pelanggan berdasarkan ID atau label.

| Parameter     | Tipe    | Wajib | Deskripsi                                                    |
|---------------|---------|-------|--------------------------------------------------------------|
| `media_ids`   | array   | Tidak | Array ID media numerik.                                      |
| `label_names` | array   | Tidak | Array label. Contoh: `['katalog dtf', 'video dtf']`          |
| `caption`     | string  | Tidak | Teks penjelasan untuk media.                                 |

Aturan:
- Interaksi ke-1: WAJIB panggil tool ini
- Customer minta katalog: WAJIB panggil tool ini
- Ghost media prevention: jika AI sebut media tanpa tool, sistem auto-inject

### 4.3 tambahkan_label_chat

**Fungsi:** Menambahkan label WA ke kontak pelanggan. Hanya label terkonfigurasi yang bisa dipakai.

| Parameter     | Tipe    | Wajib | Deskripsi                                                    |
|---------------|---------|-------|--------------------------------------------------------------|
| `label_names` | array   | Ya    | Daftar label (dari konfigurasi agen). Bisa lebih dari satu. |

**Milestone:**
- Customer konfirmasi pesanan -> `Menunggu Rekap`
- Alamat lengkap -> `Menunggu Alamat`
- Setuju harga / minta rekening -> `Menunggu Transfer`
- COD -> `COD`
- COD konfirmasi deal -> `['COD', 'Closing']`
- Transfer + bukti -> `Closing`
- Antusias tapi belum order -> `Hot Lead`

### 4.4 matikan_bot_kontak

**Fungsi:** Mem-pause bot untuk kontak tertentu, alihkan ke CS manusia.

| Parameter | Tipe    | Wajib | Deskripsi                                |
|-----------|---------|-------|------------------------------------------|
| `reason`  | string  | Ya    | Alasan singkat.                          |

Validasi lengkap sebelum matikan bot: pengiriman jelas, nama penerima, no WA, alamat, produk konsisten, ongkir, total harus terisi.

### 4.5 catat_ringkasan_percakapan

**Fungsi:** (Internal) Mencatat ringkasan percakapan via `generateChatSummary()`.

Format output minimal:
```
NAMA CUSTOMER: [nama]
PRODUK DIMINATI: [Label DTF / Stiker UV DTF Timbul]
VARIAN: [Varian / Cowok/Cewek/Polos]
STATUS: [opening / gali kebutuhan / menunggu rekap / closing]
ONGKIR: [nominal aktual]
METODE BAYAR: [Transfer / COD]
WA_LABELS: [label yang relevan]
```

## 5. Media Analysis Pipeline

Media Analysis Pipeline menganalisis gambar dan video yang diupload, menghasilkan deskripsi AI sebagai knowledge untuk AI saat melayani pelanggan.

### 5.1 Analisis Gambar (Image)

Upload -> `MediaAsset.create()` -> status: `pending`
-> `_runAnalysisInBackground()` -> status: `processing`
-> Ambil Konteks Agen (BotAgent: nama, product_knowledge)
-> Vision AI (GPT-4o) -- `analyzeImage(filePath, agentContext)`
-> Simpan `ai_analysis` -> status: `done`
-> Socket emit `mediaAnalysisReady` -> Dashboard update

Format didukung: `jpg`, `jpeg`, `png`, `gif`, `webp`.
Model: GPT-4o. Output: 2-4 kalimat Bahasa Indonesia.

### 5.2 Analisis Video

Upload -> `MediaAsset.create()` -> pending -> processing

Jalankan paralel:
- **Whisper:** Ekstrak audio via ffmpeg -> Transkripsi via Groq (fallback OpenAI) -> `video_transcript`
- **Frame + Vision:** Ekstrak 3 frame (10%, 50%, 85% durasi) -> Analisis GPT-4o Vision -> `ai_analysis`

Gabung hasil -> Optimasi video (>25MB) -> status: `done` -> emit `mediaAnalysisReady`.

Format video: `mp4`, `mov`, `avi`, `mkv`, `3gp`.

### 5.3 Status Analisis (analysis_status)

| Status       | Deskripsi                                     |
|--------------|-----------------------------------------------|
| `pending`    | Media baru dibuat, menunggu analisis            |
| `processing` | Analisis sedang berjalan di background          |
| `done`       | Analisis selesai, hasil siap digunakan          |
| `failed`     | Analisis gagal (error, timeout, format)         |

### 5.4 Socket Notification (mediaAnalysisReady)

```typescript
// Event: mediaAnalysisReady
// Arah: Server -> Client
// Payload: { agentId: string, assetId: string }
```

Frontend menangkap event ini untuk update UI real-time.

### 5.5 Optimasi Video untuk WhatsApp

| Parameter             | Default        |
|-----------------------|----------------|
| Threshold ukuran      | 25 MB          |
| Codec video           | H.264 (libx264)|
| Preset                | veryfast       |
| Max bitrate video     | 900 kbps       |
| Audio                 | AAC 64 kbps    |
| Output                | `[nama]-wa.mp4`|

File asli dihapus setelah optimasi. Jika hasil tidak lebih kecil, optimasi dibatalkan.

## 6. Voice Note Transcription

Voice Note (VN) pelanggan ditranskripsi menjadi teks agar AI bisa merespon.

### 6.1 Alur Transkripsi Voice Note

Voice Note diterima -> `ai_service.transcribeAudio(audioPath)`
-> OpenAI Whisper API (`whisper-1`, language: `id`)
-> Hasil teks diinjeksikan ke prompt AI sebagai konteks
-> AI merespon berdasarkan isi voice note

### 6.2 Groq vs OpenAI Fallback

Untuk analisis **video**, transkripsi dilakukan oleh:
1. **Primary:** Groq Whisper (`whisper-large-v3`) via load balancing round-robin
2. **Fallback:** OpenAI Whisper (`whisper-1`) jika Groq tidak tersedia

Retry: max 3x percobaan, exponential backoff `800ms * attempt`.

Ekstraksi audio untuk video: ffmpeg -> MP3 mono 16kHz 48kbps.
Jika video tidak memiliki audio track, proses dilewati dengan grace.

---

## 7. Learning / Pattern System

Sistem continuous improvement yang memungkinkan AI belajar dari percakapan closing sukses.

### 7.1 Cara Kerja Learning Engine

Label Closing terpasang ke kontak -> `onClosingDetected()` (debounce 5 menit)
-> Ambil chat dari DB (max 200 pesan)
-> Deteksi tipe produk (DTF/UV/generic via regex)
-> AI analisis (GPT-4o-mini, JSON output): ekstrak pola sukses, score, alur lengkap
-> Quality Gate: validasi kualitas percakapan
-> Simpan / update pola ke tabel `ClosingPatterns`
-> Top 6 pola diinjeksikan ke system prompt AI

Tabel database terkait:
- **ClosingPatterns**: teknik, contoh_kalimat, konteks, dampak, frequency, confidence
- **ClosingAnalytics**: conversation_score, pesan_sampai_closing, metode_bayar

Fitur:
- Debounce: cegah analisis ganda untuk kontak sama dalam 5 menit
- Dedup: pola sama -> naikkan frekuensi (bukan duplikat)
- Confidence: +0.08 per pengulangan, max 0.98
- Scoring: 1-10 berdasarkan completeness percakapan

### 7.2 Quality Gate

| Kriteria              | Minimum   |
|-----------------------|-----------|
| **Quality Score**     | >= 6.0/10 |
| **Alur Lengkap**      | true      |
| **Data Lengkap**      | true      |

Jika quality gate gagal, pola tidak disimpan (dicatat sebagai analytic rejected).

### 7.3 Injeksi ke System Prompt

Pola terbaik (top 6) diinjeksikan ke prompt AI setiap interaksi:

```
TEKNIK TERBUKTI DARI PERCAKAPAN SUKSES:
(Dipelajari otomatis dari closing nyata -- wajib diadopsi!)
1. [Teknik: tanya_varian_dulu] (Terbukti 5x, Kepercayaan: 85%)
   Contoh: "Mau pilih varian yang mana nih bun?"
   Kapan dipakai: Customer baru pertama chat
   Efeknya: Customer langsung memilih varian
```

### 7.4 Dataset Offline

File `.txt` untuk seed awal pola sebelum produksi:

```javascript
const { processDatasetFile } = require('./services/learning_service');
await processDatasetFile('/path/to/dataset.txt', agentId);
```

Format file: `CS: [teks]` dan `Customer: [teks]` per baris.

## 8. Auto-Labeling Integration

Auto-labeling memberikan label WhatsApp ke kontak pelanggan berdasarkan status percakapan.

### 8.1 Smart Label Engine

**Lokasi:** `backend/src/services/smart_label_service.js`

Alur: Parse teks summary -> cari field STATUS & WA_LABELS -> cocokkan mapping -> buat label WA jika belum ada (ensureLabel) -> terapkan label ke kontak -> hapus label lama (funnel labels) -> update kolom wa_labels.

### 8.2 Mapping Status ke Label WA

| Status (dari AI Summary)       | Label WA               | Warna      |
|--------------------------------|------------------------|------------|
| `status: closing` / `selesai`  | **Closing**            | Hijau      |
| `status: batal` / `cancel`     | **Cancel**             | Abu-abu    |
| `status: menunggu transfer`    | **Menunggu Transfer**  | Kuning     |
| `status: menunggu rekap`       | **Menunggu Rekap**     | Orange     |
| `status: menunggu alamat`      | **Menunggu Alamat**    | Orange     |
| `status: negosiasi`            | **Hot Lead**           | Merah muda |
| `status: gali kebutuhan`       | **AI Lead Aktif**      | Biru       |
| `status: opening`              | **AI Lead Baru**       | Abu-abu    |

### 8.3 Immutable Labels

| Label       | Sifat                                    |
|-------------|------------------------------------------|
| `Closing`   | Immutable -- tidak bisa ditimpa           |
| `Cancel`    | Immutable -- tidak bisa ditimpa           |
| `COD`       | Tidak pernah dihapus otomatis             |

**Funnel labels** (bisa ditimpa saat status berubah):
`AI Lead Baru`, `AI Lead Aktif`, `Hot Lead`, `Menunggu Rekap`, `Menunggu Alamat`, `Menunggu Transfer`

Label `COD` sengaja tidak pernah dihapus karena info metode pembayaran tetap relevan bahkan setelah closing.

---

## 9. Troubleshooting Masalah AI Umum

### 9.1 AI Tidak Merespon / Fallback

Gejala: AI mengembalikan pesan fallback.

| Penyebab                    | Solusi                                      |
|-----------------------------|---------------------------------------------|
| OpenAI API Key tidak valid  | Periksa OPENAI_API_KEY, pastikan diawali sk-|
| Kuota OpenAI habis          | Cek dashboard OpenAI, isi ulang saldo        |
| Timeout panggilan API       | Naikkan OPENAI_CHAT_TIMEOUT_MS              |
| Concurrency queue penuh     | Naikkan AI_CONCURRENCY (default: 10)        |
| Antrean stale (>1 menit)    | Periksa koneksi internet dan latency        |

Cek log: `grep "AI Queue|Fallback|Kesalahan AI" logs/backend.log`

### 9.2 Ghost Media

AI bilang "Cek videonya ya bun" tapi tidak ada media terkirim.
Sistem memiliki **Ghost Media Prevention**: auto-inject media jika AI menyebut keyword tanpa panggil tool.
Cek log: `[AI] Ghost-media dicegah!`

### 9.3 Rate Limiting

- **Groq:** Tambah key di `GROQ_API_KEYS`, rotasi otomatis. Cek `grep "Groq" logs/backend.log | grep "Rate Limit"`
- **OpenAI:** Kurangi concurrency, upgrade tier akun

### 9.4 Transkripsi Voice Note Gagal

| Penyebab                    | Solusi                                      |
|-----------------------------|---------------------------------------------|
| Format tidak didukung       | Pastikan format audio standar               |
| Groq habis limit            | Fallback otomatis ke OpenAI Whisper          |
| File terlalu besar          | Naikkan OPENAI_TRANSCRIPTION_TIMEOUT_MS     |
| ffmpeg tidak terinstall     | Periksa @ffmpeg-installer/ffmpeg            |

### 9.5 Analisis Media Gagal

1. Format gambar: `jpg/jpeg/png/gif/webp` saja
2. Format video: `mp4/mov/avi/mkv/3gp` saja
3. Pastikan API key punya akses ke GPT-4o (vision model)
4. Periksa binary ffmpeg path dan timeout ekstraksi

### 9.6 Auto-Label Tidak Terpasang

1. Periksa format `STATUS:` dan `WA_LABELS:` di teks summary
2. Pastikan sesi WA aktif dan label bisa dibuat
3. Label immutable (Closing/Cancel) tidak akan ditimpa

### 9.7 Cek Ongkir Error

1. Periksa `RAJAONGKIR_API_KEY` di .env
2. Format: "Kecamatan, Kabupaten/Kota"
3. Hapus file cache `mengantar_cache.json` atau `komerce_cache.json` jika rusak
4. Periksa status API Mengantar

## 10. Struktur File AI Engine

```
backend/src/
+-- ai_service.js                       # Main AI logic, queue, sanitizer
+-- config.js                           # Konfigurasi env vars AI
+-- constants.js                        # Konstanta (ERRORS.AI_FALLBACK)
|
+-- services/
|   +-- vision_service.js               # Vision AI - analisis gambar GPT-4o
|   +-- video_analysis_service.js       # Video: Whisper + Frame Vision
|   +-- media_service.js                # Manajemen media & trigger analisis
|   +-- learning_service.js             # Learning Engine - pola closing
|   +-- smart_label_service.js          # Auto-label WA berdasarkan status
|   +-- mengantar_service.js            # Shipping cost via Mengantar API
|   +-- rajaongkir_service.js           # Shipping via RajaOngkir API
|
+-- utils/
|   +-- groq_manager.js                 # Groq load balancing round-robin
|
+-- models/
    +-- index.js                        # MediaAsset, ClosingPattern, dll
```

**Ringkasan File:**

| File                      | Tanggung Jawab Utama                                     |
|---------------------------|----------------------------------------------------------|
| `ai_service.js`           | Chat completion, tool calling, sanitizer, queue manager  |
| `vision_service.js`       | Analisis gambar GPT-4o Vision + konteks toko             |
| `video_analysis_service.js` | Whisper transkripsi + frame extraction + visual analisis|
| `media_service.js`        | Register media, trigger analisis, optimasi video          |
| `learning_service.js`     | Ekstrak pola closing, quality gate, injeksi prompt        |
| `smart_label_service.js`  | Parse summary ke label WA + immutable label management    |
| `groq_manager.js`         | Round-robin load balancing antar multiple Groq API keys   |

---

*Dokumen ini diperbarui secara berkala. Untuk pertanyaan lebih lanjut, hubungi tim pengembangan.*
