# WA-AI-CS — Dokumentasi Proyek Lengkap

> **Versi Dokumen:** 1.0 | **Tanggal:** 2026-05-19  
> **Status Proyek:** Production-Running | **Branch:** `main`

---

## 🎯 Tujuan Proyek

**WA-AI-CS** adalah platform **CRM & AI Customer Service berbasis WhatsApp** yang berjalan secara lokal maupun di VPS. Sistem ini dirancang untuk membantu bisnis (terutama UMKM) menangani percakapan pelanggan secara otomatis menggunakan AI, mengelola katalog media (foto/video produk), serta memberikan dashboard monitoring real-time kepada operator manusia.

### Use Case Utama:
- **Otomasi CS:** Bot AI membalas pertanyaan pelanggan 24/7 berdasarkan knowledge base yang dikonfigurasi.
- **Media Catalog:** Admin upload foto/video produk → AI otomatis menganalisis & mendeskripsikan konten.
- **Human Override:** Operator dapat mengambil alih percakapan kapan saja (AI di-pause per kontak).
- **Multi-Toko (Multi-Tenant):** Satu server bisa menjalankan banyak nomor WhatsApp sekaligus.
- **Cek Ongkir Otomatis:** AI bisa langsung mengecek biaya pengiriman JNE via tool calling.

---

## 🏗️ Arsitektur Sistem

```
┌─────────────────────────────────────────────────────────────┐
│                    WA-AI-CS Platform                        │
│                                                             │
│  ┌───────────────┐    ┌─────────────────────────────────┐  │
│  │   WhatsApp    │    │        AI Engine (OpenAI)       │  │
│  │   Web.js      │───▶│  • GPT-4o-mini (chat)           │  │
│  │  (Browser)    │    │  • GPT-4o (vision/frame)        │  │
│  └───────┬───────┘    │  • Whisper (audio/VN)           │  │
│          │            └─────────────────────────────────┘  │
│          ▼                                                   │
│  ┌───────────────┐    ┌─────────────────────────────────┐  │
│  │ Message       │    │         SQLite Database          │  │
│  │ Handler       │───▶│  • BotAgents                    │  │
│  │ (Debouncer)   │    │  • Stores (Nomor WA)             │  │
│  └───────┬───────┘    │  • ChatMessages                  │  │
│          │            │  • MediaAssets                   │  │
│          ▼            │  • ChatSummaries                 │  │
│  ┌───────────────┐    └─────────────────────────────────┘  │
│  │  Dashboard    │                                          │
│  │  Service      │                                          │
│  │ (Express +    │                                          │
│  │  Socket.io)   │                                          │
│  └───────────────┘                                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Layer | Teknologi | Versi | Fungsi |
|-------|-----------|-------|--------|
| **Runtime** | Node.js | ≥ 20 | Platform eksekusi |
| **WhatsApp** | whatsapp-web.js | 1.26.0 | WA Web automation via Puppeteer |
| **AI - Chat** | OpenAI GPT-4o-mini | API | Membalas percakapan pelanggan |
| **AI - Vision** | OpenAI GPT-4o | API | Analisis foto produk & frame video |
| **AI - Audio** | OpenAI Whisper-1 | API | Transkripsi voice note & narasi video |
| **Database** | SQLite3 + Sequelize | 6.x | Penyimpanan data persisten |
| **Web Server** | Express.js | 4.x | REST API + Dashboard |
| **Real-time** | Socket.io | 4.x | Live update dashboard |
| **Auth** | express-session | 1.x | Session-based auth (SQLite store) |
| **File Upload** | Multer | 1.x | Upload katalog media |
| **Video Process** | fluent-ffmpeg | 2.x | Ekstrak frame video untuk analisis |
| **Shipping** | Komerce/RajaOngkir API | v1 | Cek ongkir JNE |
| **HTTP Client** | Axios | 1.x | Panggil external API |

---

## 📁 Struktur Direktori

```
wa-ai-cs/
├── index.js                    # Entry point — orchestrates semua service
├── package.json
├── .env                        # Konfigurasi (tidak di-commit)
├── .env.example                # Template konfigurasi
├── database.sqlite             # Database utama (DATA_DIR/database.sqlite)
├── settings.json               # Legacy settings (sudah tidak aktif dipakai)
│
├── src/
│   ├── config.js               # Centralized config & env validation
│   ├── constants.js            # Konstanta global (fallback messages, dll)
│   ├── whatsapp_service.js     # WA Client manager (multi-session)
│   ├── ai_service.js           # AI orchestrator (GPT + tool calling)
│   │
│   ├── database/
│   │   └── index.js            # Sequelize models + migration logic
│   │
│   ├── events/
│   │   └── message_handler.js  # Handler pesan masuk WWebJS
│   │
│   ├── services/
│   │   ├── dashboard_service.js # Express server + Socket.io + semua REST API
│   │   ├── media_service.js     # CRUD media + background AI analysis
│   │   ├── vision_service.js    # GPT-4o image analysis
│   │   ├── video_analysis_service.js # Whisper + frame extraction
│   │   ├── rajaongkir_service.js # Cek ongkir JNE via Komerce API
│   │   ├── backup_service.js     # Auto-backup SQLite
│   │   ├── history_service.js    # Chat history helpers
│   │   └── settings_service.js   # Settings management
│   │
│   └── utils/
│       └── logger.js           # Terminal + file logger (logs/app.log)
│
├── public/
│   └── index.html              # Dashboard SPA (single HTML file)
│
├── data/
│   └── uploads/                # Storage katalog media (foto/video)
│
├── logs/
│   └── app.log                 # Log persisten aplikasi
│
├── backups/                    # Snapshot SQLite otomatis
├── docs/                       # 📖 Dokumentasi proyek (FOLDER INI)
└── scratch/                    # File debug/eksperimen (tidak di-commit)
```

---

## 🔌 Koneksi WhatsApp

Sistem menggunakan **WWebJS (whatsapp-web.js)** sebagai satu-satunya engine koneksi:
- Menggunakan **Chromium browser** (headless) via Puppeteer
- Scan QR Code untuk autentikasi sesi
- Satu Store = Satu instance Chromium
- Memory optimization: flags `--single-process`, cache cleanup otomatis
- Stagger delay 15 detik antar-launch browser untuk mencegah RAM spike

> **Catatan:** Fitur RocketChat API Mode sudah **dihapus** karena tidak lagi digunakan.

---

## 🔄 Alur Data Lengkap

```
Pelanggan kirim WA
        │
        ▼
[whatsapp_service.js: message event]
        │
        ▼
[message_handler.js: handleMessage()]
  ├── Download media (timeout 20s)
  ├── Vision AI / Whisper jika ada media
  ├── Simpan ke DB (ChatMessage)
  ├── Emit ke Dashboard via Socket.io
  │
  ├── Cek pausedContacts (Human Override)
  │
  └── DEBOUNCER (3.5 detik tunggu)
        │
        ▼
[_processAIReply()]
  ├── Load Store + BotAgent dari DB
  ├── Cek keyword trigger (Autopilot)
  ├── Load history 15 pesan terakhir
  ├── Load ChatSummary (long-term memory)
  ├── Panggil getAIResponse()
  │     ├── Build system prompt (full context)
  │     ├── Tool: cek_ongkir_jne
  │     └── Tool: kirim_media_katalog
  ├── Typing delay (human-like)
  ├── Reply ke WA (text / media)
  ├── Log ke DB & Dashboard
  └── Update ChatSummary (background)
```
