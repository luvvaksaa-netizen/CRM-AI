# 02 — Software Requirements Specification (SRS)

> **Versi:** 1.0 | **Tanggal:** 2026-05-29
> **Standar:** IEEE 830 (simplified)

---

## Ringkasan Eksekutif

Dokumen ini menspesifikasikan kebutuhan fungsional dan non-fungsional untuk CRM-AI WhatsApp Customer Service Platform versi 2.0 — transformasi dari aplikasi eksperimental berbasis WWebJS/WA-JS menjadi platform CRM-AI yang aman, maintainable, dan siap produksi menggunakan WhatsApp Business Platform resmi.

---

## 1. Deskripsi Sistem

### 1.1 Arsitektur Tingkat Tinggi

```
┌──────────────────────────────────────────────────────────────┐
│                    CRM-AI PLATFORM v2.0                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────┐  ┌───────────────┐  ┌──────────────────┐       │
│  │ Channel  │  │ Conversation  │  │   AI Orchestrator │      │
│  │ Adapter  │→ │   Service     │→ │   (Prompt Engine) │      │
│  └─────────┘  └───────────────┘  └──────────────────┘       │
│       ↑              ↓                    ↓                  │
│  ┌─────────┐  ┌───────────────┐  ┌──────────────────┐       │
│  │ WA Cloud│  │    CRM Core   │  │  Notification     │      │
│  │ API     │  │ (Customer,    │  │  Queue / Follow-Up│      │
│  │ Adapter │  │  Order, Label)│  │  (Compliant)      │      │
│  └─────────┘  └───────────────┘  └──────────────────┘       │
│       ↑              ↓                    ↓                  │
│  ┌─────────┐  ┌───────────────┐  ┌──────────────────┐       │
│  │ WWebJS  │  │   Policy      │  │   Dashboard       │      │
│  │ Legacy  │  │   Guard       │  │   (Frontend)      │      │
│  │ Adapter │  │   (Compliance)│  │                    │      │
│  └─────────┘  └───────────────┘  └──────────────────┘       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 Domain Model

| Domain | Entitas | Deskripsi |
|--------|---------|-----------|
| **Channel** | ChannelAdapter, WebhookReceiver | Abstraksi koneksi WhatsApp |
| **Conversation** | Message, ChatSession, MediaAttachment | Manajemen percakapan |
| **CRM** | Customer, Contact, Label, Order | Data pelanggan dan status |
| **AI** | Agent, Prompt, Tool, ModelConfig | Konfigurasi AI per tenant |
| **Notification** | FollowUp, Template, Schedule | Outbound messaging compliant |
| **Policy** | ConsentRegistry, AuditLog, RateLimit | Compliance enforcement |
| **Dashboard** | User, Role, Permission, Widget | UI dan access control |

---

## 2. Kebutuhan Fungsional

### 2.1 FR-CH: Channel Adapter

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-CH-01 | Sistem HARUS mendukung penerimaan pesan via WhatsApp Cloud API webhook | P0 |
| FR-CH-02 | Sistem HARUS mendukung pengiriman pesan text via WhatsApp Cloud API | P0 |
| FR-CH-03 | Sistem HARUS mendukung pengiriman media (image, video, document) via Cloud API | P0 |
| FR-CH-04 | Sistem HARUS mendukung pengiriman Message Templates yang sudah disetujui Meta | P0 |
| FR-CH-05 | Sistem HARUS memvalidasi webhook signature dari Meta | P0 |
| FR-CH-06 | Sistem HARUS menyimpan WWebJS adapter sebagai legacy fallback, dapat di-toggle per store | P1 |
| FR-CH-07 | Sistem HARUS merespon webhook verification challenge dari Meta | P0 |
| FR-CH-08 | Sistem HARUS menangani status updates (delivered, read) dari Cloud API | P2 |
| FR-CH-09 | Sistem HARUS mendukung penerimaan media dari customer via Cloud API | P1 |
| FR-CH-10 | Sistem HARUS menangani error/retry untuk pengiriman pesan yang gagal | P1 |

### 2.2 FR-CV: Conversation Service

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-CV-01 | Sistem HARUS menyimpan semua pesan masuk dan keluar ke database | P0 |
| FR-CV-02 | Sistem HARUS mendeduplikasi pesan berdasarkan message ID | P0 |
| FR-CV-03 | Sistem HARUS menampilkan riwayat chat per customer di dashboard | P0 |
| FR-CV-04 | Sistem HARUS mendukung debouncing pesan (menggabungkan pesan beruntun) | P1 |
| FR-CV-05 | Sistem HARUS mendukung quoted reply (reply to specific message) | P2 |
| FR-CV-06 | Sistem HARUS menandai pesan yang dikirim oleh AI vs CS manual | P0 |
| FR-CV-07 | Sistem HARUS sinkronisasi pesan yang dikirim dari HP langsung | P1 |
| FR-CV-08 | Sistem HARUS menghapus pesan dari CRM saat customer menghapus di WA | P2 |

### 2.3 FR-AI: AI Orchestrator

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-AI-01 | Sistem HARUS menggunakan LLM (Groq/OpenAI) untuk menghasilkan respons | P0 |
| FR-AI-02 | Sistem HARUS mendukung konfigurasi prompt per Agent | P0 |
| FR-AI-03 | Sistem HARUS mendukung product knowledge per Agent | P0 |
| FR-AI-04 | Sistem HARUS mendukung tool calling (cek ongkir, kirim media, label) | P0 |
| FR-AI-05 | Sistem HARUS menghasilkan chat summary secara otomatis | P1 |
| FR-AI-06 | Sistem HARUS sanitize output AI (hapus markdown, link, ID internal) | P0 |
| FR-AI-07 | Sistem HARUS fallback ke model alternatif jika primary model gagal | P1 |
| FR-AI-08 | Sistem HARUS membatasi concurrent AI requests (concurrency limiter) | P1 |
| FR-AI-09 | Sistem HARUS timeout AI request setelah batas waktu tertentu | P0 |
| FR-AI-10 | Sistem HARUS menangani voice note (transcription via Whisper) | P2 |
| FR-AI-11 | Sistem HARUS menangani foto dari customer (vision analysis) | P2 |

### 2.4 FR-CRM: CRM Core

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-CRM-01 | Sistem HARUS menyimpan profil customer (nama, nomor, alamat, history) | P0 |
| FR-CRM-02 | Sistem HARUS mendukung label/tag per customer | P1 |
| FR-CRM-03 | Sistem HARUS mendukung auto-labeling berdasarkan status percakapan | P2 |
| FR-CRM-04 | Sistem HARUS menyediakan rekap data customer yang terstruktur (key-value) | P1 |
| FR-CRM-05 | Sistem HARUS mendukung multi-store (banyak nomor WA) | P0 |
| FR-CRM-06 | Sistem HARUS mendukung multi-agent (banyak konfigurasi AI) | P1 |
| FR-CRM-07 | Sistem HARUS mendukung media asset management (upload, catalog, trigger words) | P1 |

### 2.5 FR-NF: Notification & Follow-Up

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-NF-01 | Sistem HARUS hanya mengirim follow-up kepada customer yang opt-in | P0 |
| FR-NF-02 | Sistem HARUS menghormati 24-hour customer service window | P0 |
| FR-NF-03 | Sistem HARUS menggunakan approved Message Templates untuk outbound di luar 24-hour window | P0 |
| FR-NF-04 | Sistem HARUS mendukung auto-cancel follow-up saat customer merespons | P1 |
| FR-NF-05 | Sistem HARUS mendukung auto-cancel follow-up saat CS manual membalas | P1 |
| FR-NF-06 | Sistem HARUS mendukung scheduling follow-up bertahap | P2 |
| FR-NF-07 | Sistem HARUS rate-limit outbound messages (max N per customer per 24 jam) | P0 |

### 2.6 FR-PG: Policy Guard

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-PG-01 | Sistem HARUS menyimpan consent registry (opt-in/opt-out per customer) | P0 |
| FR-PG-02 | Sistem HARUS mengenali command "STOP" dari customer dan menghentikan outbound | P0 |
| FR-PG-03 | Sistem HARUS menyimpan audit log untuk setiap pesan terkirim | P1 |
| FR-PG-04 | Sistem HARUS mencegah pengiriman pesan ke customer yang opt-out | P0 |
| FR-PG-05 | Sistem HARUS enforce 24-hour window sebelum mengizinkan proactive message | P0 |

### 2.7 FR-UI: Dashboard

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-UI-01 | Sistem HARUS menyediakan login page dengan autentikasi aman | P0 |
| FR-UI-02 | Sistem HARUS menyediakan chat list dengan filter dan search | P0 |
| FR-UI-03 | Sistem HARUS menyediakan chat detail view real-time | P0 |
| FR-UI-04 | Sistem HARUS menyediakan toggle AI on/off per kontak dan per store | P0 |
| FR-UI-05 | Sistem HARUS menyediakan agent management UI (CRUD) | P1 |
| FR-UI-06 | Sistem HARUS menyediakan media management UI | P1 |
| FR-UI-07 | Sistem HARUS menyediakan analytics dashboard | P2 |
| FR-UI-08 | Sistem HARUS menyediakan follow-up management UI | P2 |
| FR-UI-09 | Sistem HARUS real-time update via WebSocket | P0 |
| FR-UI-10 | Sistem HARUS responsive (desktop + mobile) | P2 |

---

## 3. Kebutuhan Non-Fungsional

### 3.1 Performance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-P-01 | Webhook response time | < 200ms (acknowledge) |
| NFR-P-02 | AI response generation | < 5s (p95) |
| NFR-P-03 | Dashboard page load | < 2s |
| NFR-P-04 | Chat history query | < 500ms untuk 1000 messages |
| NFR-P-05 | Concurrent users | Minimal 10 concurrent dashboard users |

### 3.2 Security

| ID | Requirement |
|----|-------------|
| NFR-S-01 | Password HARUS di-hash dengan bcrypt (min cost 12) atau argon2 |
| NFR-S-02 | Session secret HARUS random dan dari environment variable |
| NFR-S-03 | CSRF token HARUS ada di semua form/mutation |
| NFR-S-04 | CORS HARUS restricted ke domain yang diizinkan |
| NFR-S-05 | Security headers HARUS include: X-Frame-Options, X-Content-Type-Options, CSP |
| NFR-S-06 | File upload HARUS validasi MIME type via magic bytes |
| NFR-S-07 | Socket.IO HARUS autentikasi session sebelum connect |
| NFR-S-08 | API keys HARUS TIDAK pernah ter-commit ke git |
| NFR-S-09 | Database credentials HARUS hanya via environment variables |
| NFR-S-10 | Webhook dari Meta HARUS divalidasi signature-nya |

### 3.3 Reliability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-R-01 | Uptime | 99.5% |
| NFR-R-02 | RTO (Recovery Time Objective) | < 1 jam |
| NFR-R-03 | RPO (Recovery Point Objective) | < 1 hari |
| NFR-R-04 | Automated backup | Daily |
| NFR-R-05 | Graceful shutdown | Semua proses berhenti aman |

### 3.4 Scalability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-SC-01 | Nomor WhatsApp | Minimal 10 concurrent |
| NFR-SC-02 | Messages per day | Minimal 5.000 |
| NFR-SC-03 | Customer records | Minimal 50.000 |
| NFR-SC-04 | Media storage | Minimal 10GB |

### 3.5 Maintainability

| ID | Requirement |
|----|-------------|
| NFR-M-01 | Kode HARUS mengikuti clean architecture / domain separation |
| NFR-M-02 | Tidak boleh ada circular dependencies |
| NFR-M-03 | Setiap service HARUS punya interface yang jelas |
| NFR-M-04 | Minimum test coverage: 60% untuk core services |
| NFR-M-05 | Database migration HARUS versioned dan reversible |

---

## 4. Interface Requirements

### 4.1 External Interfaces

| Interface | Protokol | Deskripsi |
|-----------|----------|-----------|
| WhatsApp Cloud API | HTTPS REST + Webhooks | Send/receive messages |
| Groq API | HTTPS REST (OpenAI-compatible) | LLM inference |
| OpenAI API | HTTPS REST | Fallback LLM + Vision + Whisper |
| RajaOngkir/Mengantar API | HTTPS REST | Shipping cost calculation |

### 4.2 Internal Interfaces

| Interface | Protokol | Deskripsi |
|-----------|----------|-----------|
| Dashboard ↔ API | HTTP REST + Socket.IO | Frontend-backend communication |
| Channel Adapter → Conversation Service | Internal function call / event | Message routing |
| Conversation Service → AI Orchestrator | Internal function call | AI processing |
| Policy Guard | Middleware / decorator | Compliance enforcement |

---

## 5. Data Requirements

### 5.1 Data Entities

| Entity | Fields | Storage |
|--------|--------|---------|
| Customer | id, name, phone, wa_id, consent_status, created_at | PostgreSQL |
| Message | id, customer_id, store_id, body, type, is_from_me, wa_message_id, timestamp | PostgreSQL |
| Agent | id, name, bot_name, system_prompt, product_knowledge, auto_labels | PostgreSQL |
| Store | id, wa_id, name, agent_id, is_bot_active, phone_number_id | PostgreSQL |
| MediaAsset | id, agent_id, filename, type, label, description, ai_analysis | PostgreSQL + Object Storage |
| FollowUp | id, store_id, customer_id, stage, scheduled_at, status, template_id | PostgreSQL |
| AuditLog | id, actor, action, target, metadata, timestamp | PostgreSQL |
| ConsentRegistry | customer_id, opt_in, opt_out_at, channel | PostgreSQL |

### 5.2 Data Retention

| Data Type | Retention |
|-----------|-----------|
| Chat messages | 90 hari (configurable) |
| Chat summaries | 1 tahun |
| Audit logs | 2 tahun |
| Media assets | Sampai dihapus manual |
| Backups | 30 hari rolling |

---

## 6. Constraints & Assumptions

### 6.1 Constraints

- WhatsApp Cloud API memerlukan Meta Business verification
- Message Templates memerlukan approval (1-7 hari)
- 24-hour customer service window adalah hard limit dari Meta
- Free tier WhatsApp Cloud API: 1.000 conversations/bulan
- Groq free tier: rate limited

### 6.2 Assumptions

- Bisnis sudah memiliki Meta Business account
- Bisnis bersedia menunggu proses verifikasi Meta (1-4 minggu)
- Budget untuk WhatsApp Cloud API conversations tersedia
- Tim teknis minimal 1 developer untuk maintenance

---

## 7. Acceptance Criteria Dokumen SRS

- [x] Arsitektur tingkat tinggi terdefinisi
- [x] Semua kebutuhan fungsional terdokumentasi dengan prioritas
- [x] Kebutuhan non-fungsional terukur
- [x] Interface requirements terdefinisi
- [x] Data model dan retention policy
- [x] Constraints dan assumptions
