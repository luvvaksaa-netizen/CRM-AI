# 02 — Arsitektur V2-Core

> **Dokumen ini** menjelaskan arsitektur keseluruhan sistem **V2-Core CRM-AI**, mulai dari struktur direktori, tech stack, alur autentikasi, API, database, Socket.IO, hingga perbandingan dengan sistem legacy (monolith JS).

---

## Daftar Isi

1. [Tech Stack](#tech-stack)
2. [Struktur Folder](#struktur-folder)
3. [Autentikasi & JWT Flow](#autentikasi--jwt-flow)
4. [API & Protected Routes](#api--protected-routes)
5. [Socket.IO Architecture](#socketio-architecture)
6. [Database Schema Overview](#database-schema-overview)
7. [Data Flow Diagrams](#data-flow-diagrams)
8. [Perbandingan Legacy vs V2-Core](#perbandingan-legacy-vs-v2-core)

---

## Tech Stack

| Layer        | Teknologi                                                                 |
|--------------|---------------------------------------------------------------------------|
| **Runtime**    | Node.js LTS                                                               |
| **Bahasa**     | TypeScript ^6.0.3 (backend), TypeScript ~6.0.2 (frontend)                 |
| **Backend**    | Express ^5.2.1 + Sequelize ^6.37.8 + SQLite ^6.0.1 (WAL mode)             |
| **Frontend**   | React ^19.2.6 + Vite ^8.0.12 + TailwindCSS ^4.3.0 + Framer Motion ^12.40.0 |
| **Auth**       | JWT (jsonwebtoken ^9.0.3), role-based (admin / operator / viewer)         |
| **Realtime**   | Socket.IO ^4.8.3 (server) + Socket.IO Client ^4.8.3 (client)              |
| **WA Engine**  | whatsapp-web.js                                                           |
| **AI / LLM**   | OpenAI SDK + Groq                                                         |
| **HTTP**       | Helmet, express-rate-limit, Multer                                        |
| **Charts**     | Recharts                                                                  |
| **State**      | Zustand (frontend)                                                        |
| **Routing**    | React Router DOM ^7.16.0                                                  |
| **HTTP Client** | Axios                                                                     |
| **Toast**      | react-hot-toast                                                           |

**Port:**
- Backend: `3002`
- Frontend: `5173`
- Database: `backend/data/database.sqlite` (shared dengan legacy)

---
## Struktur Folder

```
D:\\CRM-AI\\v2-core\\
+-- backend
|   +-- data
|   |   +-- database.sqlite
|   +-- src
|   |   +-- config
|   |   |   +-- database.ts
|   |   +-- middleware
|   |   |   +-- auth.middleware.ts
|   |   |   +-- error.middleware.ts
|   |   +-- models
|   |   |   +-- BotAgent.ts
|   |   |   +-- Store.ts
|   |   |   +-- MediaAsset.ts
|   |   |   +-- ChatMessage.ts
|   |   |   +-- ChatSummary.ts
|   |   |   +-- PausedContact.ts
|   |   |   +-- FollowUp.ts
|   |   |   +-- ClosingPattern.ts
|   |   |   +-- AdminConfig.ts
|   |   |   +-- ClosingAnalytic.ts
|   |   +-- routes
|   |   |   +-- auth.routes.ts
|   |   |   +-- agents.routes.ts
|   |   |   +-- analytics.routes.ts
|   |   |   +-- chat.routes.ts
|   |   |   +-- settings.routes.ts
|   |   |   +-- followups.routes.ts
|   |   |   +-- stores.routes.ts
|   |   |   +-- media.routes.ts
|   |   |   +-- summaries.routes.ts
|   |   |   +-- closing.routes.ts
|   |   |   +-- learning.routes.ts
|   |   |   +-- smart-labels.routes.ts
|   |   |   +-- bot-activation.routes.ts
|   |   +-- services
|   |   |   +-- socket.service.ts
|   |   |   +-- wa.service.ts
|   |   |   +-- ai.service.ts
|   |   |   +-- followup-scheduler.ts
|   |   +-- utils
|   |   |   +-- helpers.ts
|   |   +-- app.ts
|   +-- package.json
|   +-- tsconfig.json
+-- frontend
|   +-- src
|   |   +-- components
|   |   +-- pages
|   |   +-- hooks
|   |   +-- store
|   |   +-- services
|   |   |   +-- api.ts
|   |   |   +-- socket.ts
|   |   +-- App.tsx
|   +-- package.json
|   +-- vite.config.ts
|   +-- tailwind.config.ts
+-- docs
|   +-- 01_OVERVIEW.md
|   +-- 02_ARCHITECTURE.md
+-- package.json
+-- README.md
```

Keterangan:
- **backend/**: Express 5 + TypeScript + Sequelize
- **frontend/**: React 19 + Vite + TailwindCSS
- **docs/**: Dokumentasi proyek

---
## Autentikasi & JWT Flow

### Alur Login

```
Client                          Backend
  +                               +
  |  POST /api/auth/login         |
  |  { email, password }          |
  +------------------------------>+
  |                               |
  |          Rate Limiter         |
  |        10 req / 15 min        |
  |           per IP              |
  |                               |
  |   Validasi email & password   |
  |   (bcrypt compare)            |
  |                               |
  |   Generate JWT:               |
  |   { id, role, storeId,        |
  |     iat, exp }                |
  |   sign(dengan SECRET_KEY)     |
  |   expiresIn: 24h              |
  |                               |
  |  { token, user }              |
  +<------------------------------+
```

### Middleware Auth (`auth.middleware.ts`)

1. **Extract Token** — dari header `Authorization: Bearer <token>`
2. **Verify** — `jwt.verify(token, SECRET_KEY)`
3. **Attach User** — `req.user = { id, role, storeId }`
4. **Role Guard** — middleware mengecek role (`admin`/`operator`/`viewer`)
5. **Session Check** — endpoint `/api/auth/session`

### Diagram Alur Protected Request

```
Client                         Backend
  +                               +
  |  GET /api/stores              |
  |  Authorization: Bearer ***    |
  +------------------------------>+
  |                               |
  |   auth.middleware.ts          |
  |   +- verify token             |
  |   +- attach req.user          |
  |   +- next()                   |
  |                               |
  |   roleGuard([admin])          |
  |   +- if role tidak sesuai     |
  |   |  -> 403 Forbidden         |
  |   +- next()                   |
  |                               |
  |   Controller -> Service       |
  |   +- response data            |
  +<------------------------------+
```

---
## API & Protected Routes

Total **14 group routes**, semuanya di bawah prefix `/api/`:

| Route Group          | Prefix                          | Role Access              | Keterangan                              |
|----------------------|---------------------------------|--------------------------|-----------------------------------------|
| Auth                 | `/api/auth`                     | Public                   | Login, session check                    |
| Agents               | `/api/agents`                   | admin, operator          | CRUD BotAgent + cascade delete          |
| Analytics            | `/api/analytics`                | admin, operator, viewer  | Dashboard overview, leads, followups, learning |
| Chat                 | `/api/chat`                     | admin, operator          | Contacts, messages, send, reactions     |
| Settings             | `/api/settings`                 | admin                    | Health, backup, WA status, logs         |
| Follow-Ups           | `/api/followups`                | admin, operator          | Pipeline 4-stage, scheduler             |
| Stores               | `/api/stores`                   | admin                    | CRUD, QR scan, reconnect, logout        |
| Media                | `/api/media`                    | admin, operator          | Upload (max 50MB), AI analysis, trigger |
| Summaries            | `/api/summaries`                | admin, operator, viewer  | Ringkasan percakapan per kontak         |
| Closing              | `/api/closing`                  | admin, operator          | Pattern detection, COD/Transfer, CSV    |
| Learning             | `/api/learning`                 | admin, operator          | Pattern management, analytics           |
| Smart Labels         | `/api/smart-labels`             | admin, operator          | CRUD labels, sync WA, color palette     |
| Bot Activation       | `/api/bot-activation`           | admin                    | Toggle bot per store                    |
| Admin Profile        | `/api/settings/profile`         | admin                    | Update profil admin                     |

**Middleware chain per route:**

```
authenticate -> roleGuard([...roles]) -> validation -> controller -> service -> response
```

---
## Socket.IO Architecture

### Sentralisasi via `socket.service.ts`

Socket.IO dikelola secara **terpusat** dalam satu file: `backend/src/services/socket.service.ts`.

```
+------------------------------------------+
|           socket.service.ts              |
|                                          |
|  - Inisialisasi Socket.IO server         |
|  - Map: userId <-> SocketId              |
|  - Map: storeId <-> SocketId             |
|  - Event handlers terpusat               |
|  - Emit helpers (broadcast, room, etc)   |
|  - Graceful shutdown (SIGINT/SIGTERM)    |
+------------------+-----------------------+
                   |
         +---------+----------+
         |                    |
         v                    v
      Backend              Frontend
      (emit events)       (listen events)
```

### Event Flow

| Event (Client -> Server)     | Aksi                                          |
|------------------------------|-----------------------------------------------|
| `login`                       | Register socket ke user map                   |
| `join-store`                  | Join room berdasarkan storeId                 |
| `typing`                      | Broadcast typing indicator ke room            |
| `send-message`                | Kirim pesan via WA engine                     |
| `mark-read`                   | Tandai pesan telah dibaca                     |
| `disconnect`                  | Hapus socket dari map                         |

| Event (Server -> Client)     | Data                                          |
|------------------------------|-----------------------------------------------|
| `new-message`                 | { from, body, timestamp, storeId }            |
| `message-status`              | { messageId, status }                         |
| `typing`                      | { contactId, isTyping }                       |
| `qr-code`                     | { storeId, qrBase64 }                         |
| `connection-update`           | { storeId, status }                           |
| `followup-reminder`           | { followUpId, contact, stage }                |
| `store-sync`                  | { storeId, contacts, messages }               |

### Kenapa Terpusat?

- **Single source of truth** untuk semua koneksi realtime
- **Mudah di-debug** -- semua event tercatat di satu tempat
- **Graceful shutdown** -- semua koneksi ditutup rapi saat server mati
- **Reusability** -- service lain cukup import io dari socket.service.ts, tidak perlu buat instance baru

---
## Database Schema Overview

Sistem menggunakan **SQLite dengan WAL mode** untuk performa baca-tulis yang lebih baik. Database tersimpan di `backend/data/database.sqlite`.

### Entity Relationship Diagram (Ringkas)

```
Store (1) -----< (N) BotAgent
Store (1) -----< (N) MediaAsset
Store (1) -----< (N) ChatMessage
Store (1) -----< (N) ChatSummary
Store (1) -----< (N) PausedContact
Store (1) -----< (N) FollowUp
Store (1) -----< (N) ClosingAnalytic

BotAgent (1) ---< (N) MediaAsset
BotAgent (1) ---< (N) ChatMessage   (nullable)
BotAgent (1) ---< (N) FollowUp       (nullable)
```

#### 1. BotAgent

```typescript
BotAgent {
  id: INTEGER PRIMARY KEY AUTOINCREMENT
  name: STRING -- Nama agen bot
  role: ENUM(admin/operator/viewer)
  phoneNumber: STRING -- Nomor WhatsApp
  isActive: BOOLEAN -- Status aktif
  storeId: INTEGER FK -- Relasi ke Store
  createdAt: DATE
  updatedAt: DATE
}
```

#### 2. Store

```typescript
Store {
  id: INTEGER PRIMARY KEY AUTOINCREMENT
  name: STRING -- Nama toko
  waNumber: STRING -- Nomor WhatsApp
  connectionStatus: ENUM(connected/disconnected/scanning)
  qrCode: TEXT -- QR Code base64 (sementara)
  botActive: BOOLEAN -- Status bot aktif/nonaktif
  createdAt: DATE
  updatedAt: DATE
}
```

#### 3. MediaAsset

```typescript
MediaAsset {
  id: INTEGER PRIMARY KEY AUTOINCREMENT
  filename: STRING -- Nama file asli
  filepath: STRING -- Path penyimpanan
  mimetype: STRING -- image/jpeg, video/mp4, dll
  size: INTEGER -- Ukuran file (bytes, max 50MB)
  aiAnalysis: TEXT -- Hasil analisis AI (JSON)
  triggerWords: TEXT -- Trigger words (JSON array)
  agentId: INTEGER FK -- Relasi ke BotAgent
  storeId: INTEGER FK -- Relasi ke Store
  createdAt: DATE
  updatedAt: DATE
}
```

#### 4. ChatMessage

```typescript
ChatMessage {
  id: INTEGER PRIMARY KEY AUTOINCREMENT
  contactId: STRING -- ID kontak WhatsApp
  contactName: STRING -- Nama kontak
  body: TEXT -- Isi pesan
  fromMe: BOOLEAN -- Dari bot/user
  messageType: ENUM(text/image/video/document)
  status: ENUM(sent/delivered/read/failed)
  reaction: STRING -- Emoji reaksi (nullable)
  storeId: INTEGER FK -- Relasi ke Store
  agentId: INTEGER FK -- Relasi ke BotAgent (nullable)
  timestamp: DATE
  createdAt: DATE
  updatedAt: DATE
}
```

#### 5. ChatSummary

```typescript
ChatSummary {
  id: INTEGER PRIMARY KEY AUTOINCREMENT
  contactId: STRING -- ID kontak WhatsApp
  summary: TEXT -- Ringkasan percakapan (AI-generated)
  storeId: INTEGER FK -- Relasi ke Store
  createdAt: DATE
  updatedAt: DATE
}
```

#### 6. PausedContact

```typescript
PausedContact {
  id: INTEGER PRIMARY KEY AUTOINCREMENT
  contactId: STRING -- ID kontak yang di-pause
  reason: TEXT -- Alasan pause
  pausedAt: DATE
  resumedAt: DATE -- Null jika masih paused
  storeId: INTEGER FK -- Relasi ke Store
  createdAt: DATE
  updatedAt: DATE
}
```

#### 7. FollowUp

```typescript
FollowUp {
  id: INTEGER PRIMARY KEY AUTOINCREMENT
  contactId: STRING -- ID kontak
  contactName: STRING -- Nama kontak
  stage: ENUM(1/2/3/4) -- Stage pipeline
  scheduledAt: DATE -- Waktu follow-up terjadwal
  lastMessage: TEXT -- Pesan terakhir
  notes: TEXT -- Catatan
  status: ENUM(pending/done/cancelled/emergency_cancelled)
  storeId: INTEGER FK -- Relasi ke Store
  agentId: INTEGER FK -- Relasi ke BotAgent (nullable)
  createdAt: DATE
  updatedAt: DATE
}
```

#### 8. ClosingPattern

```typescript
ClosingPattern {
  id: INTEGER PRIMARY KEY AUTOINCREMENT
  pattern: TEXT -- Pola kata/kalimat closing
  type: ENUM(cod/transfer) -- Jenis pembayaran
  isActive: BOOLEAN -- Aktif/nonaktif
  createdAt: DATE
  updatedAt: DATE
}
```

#### 9. AdminConfig

```typescript
AdminConfig {
  id: INTEGER PRIMARY KEY AUTOINCREMENT
  key: STRING UNIQUE -- Key konfigurasi
  value: TEXT -- Value (JSON)
  createdAt: DATE
  updatedAt: DATE
}
```

#### 10. ClosingAnalytic

```typescript
ClosingAnalytic {
  id: INTEGER PRIMARY KEY AUTOINCREMENT
  contactId: STRING -- ID kontak
  type: ENUM(cod/transfer)
  amount: DECIMAL(10,2) -- Nominal transaksi
  detectedAt: DATE
  storeId: INTEGER FK -- Relasi ke Store
  createdAt: DATE
  updatedAt: DATE
}
```
## Data Flow Diagrams

### Chat Flow

```
User (Frontend)                    Backend                          WhatsApp
  +                               +                                +
  |  Ketik pesan                   |                                |
  |  Socket: `typing`              |                                |
  +------------------------------>+                                |
  |                               |  Broadcast `typing`            |
  |                               |  ke room storeId              |
  |                               +------------------------------->+
  |                               |                                |
  |  Klik Kirim                    |                                |
  |  POST /api/chat/send          |                                |
  +------------------------------>+                                |
  |                               |  wa.service.ts                 |
  |                               |  +- client.sendMessage()       |
  |                               +------------------------------->+
  |                               |  Simpan ke ChatMessage         |
  |                               |  (status: `sent`)             |
  |                               |                                |
  |  Socket: `new-message`        |                                |
  +<------------------------------+                                |
  |                               |  Status delivery              |
  |                               +<-------------------------------+
  |                               |                                |
  |  Socket: `message-status`     |                                |
  +<------------------------------+                                |
```

### Follow-Up Flow

```
User (Frontend)                    Backend                     Scheduler
  +                               +                            +
  |  POST /api/followups          |                            |
  |  { contactId, stage,          |                            |
  |    scheduledAt }              |                            |
  +------------------------------>+                            |
  |                               |  Simpan ke FollowUp        |
  |                               |  status: `pending`         |
  |                               |  Daftarkan ke scheduler    |
  |                               +--------------------------->+
  |                               |                            |
  |  [Waktu tiba]                 |                            |
  |                               +<---------------------------+
  |                               |  Trigger follow-up         |
  |                               |  wa.service.ts             |
  |                               |  +- Kirim pesan follow-up  |
  |                               |                            |
  |  Socket: `followup-reminder`  |                            |
  +<------------------------------+                            |
  |                               |  Update stage (1->2->3->4)  |
  |                               |  atau status `done`        |
  |                               |                            |
  |  [Emergency Cancel]           |                            |
  |  PUT /api/followups/:id       |                            |
  |  /emergency-cancel            |                            |
  +------------------------------>+                            |
  |                               |  Hapus dari scheduler      |
  |                               |  status -> `emergency_`       |
  |                               |           `cancelled`        |
```
### Media Upload Flow

```
User (Frontend)                    Backend                          AI
  +                               +                            +
  |  POST /api/media/upload       |                            |
  |  FormData: file + agentId     |                            |
  +------------------------------>+                            |
  |                               |  Multer middleware         |
  |                               |  Validate: max 50MB        |
  |                               |  mimetype: image/video     |
  |                               |  Simpan file ke storage    |
  |                               |  Simpan record ke          |
  |                               |  MediaAsset                |
  |                               |  Kirim ke AI Service       |
  |                               |  (OpenAI Vision / Groq)    |
  |                               +--------------------------->+
  |                               |  Terima hasil analisis     |
  |                               +<---------------------------+
  |                               |  Update aiAnalysis field   |
  |                               |  Ekstrak trigger words     |
  |                               |                            |
  |  { mediaAsset, analysis }      |                            |
  +<------------------------------+                            |
```

---

## Perbandingan Legacy vs V2-Core

| Aspek                  | Legacy (Monolith JS)               | V2-Core (Modular TS)                    |
|------------------------|-------------------------------------|------------------------------------------|
| Bahasa                 | JavaScript (ES5/ES6)                | TypeScript ^6.0.3 (strict typing)        |
| Framework              | Express 4                           | Express 5                                |
| Database               | SQLite (default mode)               | SQLite + **WAL mode** (write-ahead log)  |
| ORM                    | Raw queries / knex                  | Sequelize ^6.37.8 (model-based)          |
| Frontend               | EJS / jQuery / Bootstrap            | React 19 + Vite + TailwindCSS 4          |
| Realtime               | Socket.IO (tersebar)                | Socket.IO **terpusat** (socket.service)  |
| Auth                   | Session-based                       | **JWT** stateless, role-based            |
| Rate Limiting          | Tidak ada                           | express-rate-limit                       |
| AI Integration         | Belum ada                           | OpenAI SDK + Groq                        |
| Struktur               | Monolith                            | Modular routes/services                  |
| Error Handling         | Try-catch manual                    | Global error middleware                  |
| Graceful Shutdown      | Tidak ada                           | SIGINT/SIGTERM handler                   |
| Keamanan               | Minimal                             | Helmet, JWT, role guard, CORS            |
| File Upload            | Multer (tanpa validasi)             | Multer + validasi tipe & ukuran          |
| Charts                 | Chart.js manual                     | Recharts (React-ready)                   |
| State Mgmt             | DOM manipulation                    | Zustand                                  |
| Scheduler              | Cron sederhana                      | Scheduler + cancel/emergency             |

### Keuntungan V2-Core

1. **Type Safety** -- TypeScript mengurangi runtime error
2. **Modular** -- Setiap layer punya tanggung jawab jelas
3. **Scalable** -- Mudah menambah route/model/service baru
4. **Maintainable** -- Struktur kode konsisten, mudah direview
5. **Secure** -- JWT + Helmet + rate limiter + role-based access
6. **Real-time** -- Socket.IO terpusat, mudah di-debug
7. **AI Ready** -- Integrasi LLM sudah built-in
8. **Graceful Shutdown** -- Tidak ada data corruption saat restart

---

## Catatan Penting

- **Graceful Shutdown**: Server menangani `SIGINT` dan `SIGTERM` -- menutup koneksi database, Socket.IO, dan WhatsApp engine dengan rapi sebelum process exit.
- **WAL Mode**: SQLite menggunakan Write-Ahead Logging untuk performa concurrent read yang lebih baik.
- **Shared Database**: Database `backend/data/database.sqlite` digunakan bersama dengan sistem legacy, memudahkan migrasi bertahap.
- **Cascade Delete**: Menghapus `BotAgent` akan otomatis menghapus `Store` dan `MediaAsset` terkait.
- **Follow-up Scheduler**: Berjalan di dalam proses yang sama (in-process scheduler), bukan cron terpisah.

---

> **Dokumen ini diperbarui secara berkala.**
> Terakhir diperbarui: Juni 2026
> Versi: 2.0.0