# 📦 MASTER DOCUMENTATION PACKAGE
## CRM WhatsApp AI — Full Rewrite
### Target: Eksekusi 1 Hari dengan Claude Agent

> **Cara Pakai Dokumen Ini:**
> Paste seluruh dokumen ini sebagai konteks pertama ke Claude sebelum mulai eksekusi setiap fase.
> Claude akan mengikuti semua keputusan arsitektur, konvensi kode, dan struktur folder yang sudah ditetapkan di sini.

---

# BAGIAN 1: PRODUCT REQUIREMENTS DOCUMENT (PRD)

## 1.1 Ringkasan Produk

**Nama Sistem:** CRM WhatsApp AI  
**Deskripsi:** Sistem CRM berbasis WhatsApp yang memungkinkan bisnis multi-toko mengelola percakapan pelanggan, auto-reply dengan AI, dan monitoring performa CS — semuanya dari satu dashboard web.  
**Deployment:** Laptop Windows lokal sebagai server, diakses via `crm.datasdm.com` (Cloudflare Tunnel + PM2)  
**Primary Users:** Owner/Admin, CS/Agent

---

## 1.2 User Personas

### Persona 1: Owner/Admin
- Memonitor semua chat dari semua toko
- Melihat laporan & statistik performa CS dan AI
- Mengatur konfigurasi AI, produk, dan agent
- Mengelola koneksi nomor WhatsApp per toko

### Persona 2: CS/Agent
- Menerima dan membalas chat dari pelanggan
- Melihat riwayat percakapan
- Take-over dari AI ke manual saat dibutuhkan
- Melihat notifikasi chat masuk secara real-time

---

## 1.3 Fitur Wajib (Must Have)

### F-01: Manajemen Multi-Toko & Multi-Nomor WA
- [ ] Daftar toko dengan status koneksi WA (Connected / Disconnected)
- [ ] QR Code scan per toko untuk koneksi WhatsApp
- [ ] Tambah / edit / hapus toko
- [ ] Setiap toko punya nomor WA, nama, dan konfigurasi AI sendiri

### F-02: Dashboard Chat Real-Time
- [ ] Sidebar kiri: daftar kontak/percakapan aktif (sorted by last message)
- [ ] Panel tengah: bubble chat (masuk & keluar) dengan timestamp
- [ ] Indikator: pesan dibaca / belum dibaca
- [ ] Badge unread count per kontak
- [ ] Search/filter kontak
- [ ] Filter per toko
- [ ] Fitur Tagging/Labeling per kontak (misal: "Menunggu Transfer", "Closing")

### F-03: AI Auto-Reply & Function Calling
- [ ] Auto-reply aktif/nonaktif per toko (toggle)
- [ ] Auto-reply aktif/nonaktif per kontak (fitur matikan_bot_kontak)
- [ ] Menggunakan OpenAI API dengan dukungan Function Calling (Tools)
- [ ] System prompt configurable per toko
- [ ] Eksekusi Tool Otomatis: Cek ongkir, kirim katalog/media, dan mengubah label/status bot
- [ ] Cooldown setelah CS reply manual (AI tidak langsung override)
- [ ] Log AI: setiap balasan AI tercatat (prompt, response, token usage, tool calls)

### F-04: Manajemen Agent/CS
- [ ] Daftar agent dengan role (Admin / CS)
- [ ] Assign agent ke toko tertentu
- [ ] Login/logout agent
- [ ] Tracking: agent mana yang membalas chat tertentu

### F-05: Broadcast / Blast Pesan
- [ ] Pilih toko & nomor pengirim
- [ ] Input daftar nomor penerima (manual atau upload CSV)
- [ ] Compose pesan (teks, bisa dengan variabel {nama})
- [ ] Jadwalkan pengiriman atau kirim sekarang
- [ ] Status pengiriman per nomor (Sent / Failed / Pending)

### F-06: Laporan & Statistik
- [ ] Total chat masuk per hari/minggu/bulan (per toko)
- [ ] Response time rata-rata CS
- [ ] Total pesan AI vs manual
- [ ] Token usage & estimasi biaya OpenAI
- [ ] Export laporan ke CSV

### F-07: Autentikasi & Keamanan
- [ ] Login dengan email + password
- [ ] JWT-based session (access token + refresh token)
- [ ] Role-based access: Admin bisa semua, CS hanya chat & profil
- [ ] Rate limiting login (max 5x salah → lockout 15 menit)

---

## 1.4 Fitur Nice-to-Have (Fase Berikutnya)
- Manajemen Katalog Produk
- Template pesan cepat (quick replies)
- Notifikasi desktop (browser notification)
- Dark mode

---

# BAGIAN 2: ARCHITECTURE DECISION RECORD (ADR)

## 2.1 Tech Stack Final

| Layer | Teknologi | Alasan |
|-------|-----------|--------|
| **Frontend** | React 18 + Vite + TypeScript | Component-based, Virtual DOM, type-safe |
| **UI Library** | shadcn/ui + TailwindCSS | Headless, customizable, tidak opinionated |
| **State Management** | Zustand | Lebih ringan dari Redux, cukup untuk skala ini |
| **Real-time Client** | Socket.IO Client | Konsisten dengan backend |
| **Backend** | Node.js + Express + TypeScript | Familiar, cepat setup, type-safe |
| **Real-time Server** | Socket.IO | Chat real-time tanpa polling |
| **WA Engine** | Baileys | Ringan, tidak pakai Chrome/Puppeteer |
| **AI** | OpenAI SDK (Node) | Official SDK, type-safe |
| **Database** | PostgreSQL + Prisma ORM | Robust, concurrent-safe, type-safe schema |
| **Cache & Queue** | Redis (ioredis) | Queue AI requests, session cache |
| **Process Manager** | PM2 | Sudah berjalan, tetap dipakai |
| **Auth** | JWT (jsonwebtoken) + bcrypt | Standard, stateless |
| **Validation** | Zod | Schema validation runtime + TypeScript inference |
| **Logger** | Winston | Structured logging, file rotation |

## 2.2 Keputusan Kritis

**ADR-01: Mengapa Baileys, bukan whatsapp-web.js?**
- whatsapp-web.js menggunakan Puppeteer (Chrome headless) → 300-500MB RAM per instance
- Baileys menggunakan WebSocket langsung → ~20-50MB per instance
- Trade-off: Baileys adalah reverse-engineered library, ada risiko banned. Mitigasi: gunakan nomor WA Business, hindari spam, pakai delay antar pesan broadcast.

**ADR-02: Mengapa PostgreSQL, bukan SQLite?**
- SQLite write-lock saat concurrent insert → gagal simpan chat
- PostgreSQL handle ribuan concurrent write tanpa masalah
- Di Windows: install via PostgreSQL installer atau Docker Desktop

**ADR-03: Mengapa Prisma, bukan Sequelize?**
- Prisma generate TypeScript types otomatis dari schema
- Query builder yang intuitif dan type-safe
- Migration system yang lebih bersih

**ADR-04: Monorepo Structure**
- Frontend dan backend dalam satu repository
- Memudahkan sharing types antara frontend dan backend
- Deployment tetap terpisah (PM2 menjalankan backend, Vite build untuk frontend)

**ADR-05: Integrasi Tools AI (Function Calling)**
- Menggunakan OpenAI Function Calling agar AI bisa berinteraksi dengan sistem CRM (misal: mematikan bot untuk kontak tertentu, mengecek ongkir, menambahkan label, dan mengirim media katalog).
- Tools dieksekusi di backend (sebagai TypeScript functions), lalu hasilnya dikembalikan ke AI untuk merespon pengguna.

---

# BAGIAN 3: FOLDER STRUCTURE & CODING CONVENTION

## 3.1 Struktur Folder Lengkap

```
crm-wa-ai/
├── 📁 apps/
│   ├── 📁 backend/
│   │   ├── 📁 src/
│   │   │   ├── 📁 config/           # Env config, constants
│   │   │   │   ├── index.ts
│   │   │   │   └── database.ts
│   │   │   ├── 📁 modules/          # Feature modules
│   │   │   │   ├── 📁 auth/
│   │   │   │   │   ├── auth.controller.ts
│   │   │   │   │   ├── auth.service.ts
│   │   │   │   │   ├── auth.routes.ts
│   │   │   │   │   └── auth.schema.ts   # Zod schemas
│   │   │   │   ├── 📁 stores/           # Manajemen toko
│   │   │   │   ├── 📁 chats/            # Chat & messages
│   │   │   │   ├── 📁 agents/           # CS/Agent management
│   │   │   │   ├── 📁 broadcast/        # Blast pesan
│   │   │   │   ├── 📁 reports/          # Laporan & statistik
│   │   │   │   └── 📁 whatsapp/         # Baileys engine
│   │   │   │       ├── wa.manager.ts    # Multi-session manager
│   │   │   │       ├── wa.handler.ts    # Event handlers
│   │   │   │       └── wa.service.ts    # Send message, etc
│   │   │   ├── 📁 shared/
│   │   │   │   ├── 📁 middleware/
│   │   │   │   │   ├── auth.middleware.ts
│   │   │   │   │   ├── error.middleware.ts
│   │   │   │   │   └── rateLimit.middleware.ts
│   │   │   │   ├── 📁 utils/
│   │   │   │   │   ├── logger.ts
│   │   │   │   │   ├── response.ts      # Standard API response helper
│   │   │   │   │   └── pagination.ts
│   │   │   │   └── 📁 types/
│   │   │   │       └── index.ts         # Shared TypeScript types
│   │   │   ├── 📁 socket/               # Socket.IO handlers
│   │   │   │   └── socket.gateway.ts
│   │   │   ├── 📁 ai/                   # OpenAI integration
│   │   │   │   ├── ai.service.ts
│   │   │   │   ├── ai.queue.ts          # Redis queue handler
│   │   │   │   └── 📁 tools/            # OpenAI Function Call handlers
│   │   │   │       ├── index.ts
│   │   │   │       ├── cekOngkir.ts
│   │   │   │       └── waTools.ts       # matikan_bot, kirim_media, set_label
│   │   │   └── app.ts                   # Express app setup
│   │   ├── 📁 prisma/
│   │   │   ├── schema.prisma
│   │   │   └── 📁 migrations/
│   │   ├── 📁 wa-sessions/          # Folder auth Baileys (di-ignore git)
│   │   ├── 📁 uploads/              # Folder penyimpanan media lokal
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── .env
│   │
│   └── 📁 frontend/
│       ├── 📁 src/
│       │   ├── 📁 components/       # Reusable UI components
│       │   │   ├── 📁 ui/           # shadcn/ui base components
│       │   │   ├── 📁 chat/
│       │   │   │   ├── ChatSidebar.tsx
│       │   │   │   ├── ChatWindow.tsx
│       │   │   │   ├── ChatBubble.tsx
│       │   │   │   └── ChatInput.tsx
│       │   │   ├── 📁 layout/
│       │   │   │   ├── AppShell.tsx
│       │   │   │   ├── Sidebar.tsx
│       │   │   │   └── Header.tsx
│       │   │   └── 📁 shared/
│       │   │       ├── LoadingSpinner.tsx
│       │   │       ├── ErrorBoundary.tsx
│       │   │       └── EmptyState.tsx
│       │   ├── 📁 pages/            # Route-level components
│       │   │   ├── LoginPage.tsx
│       │   │   ├── DashboardPage.tsx
│       │   │   ├── ChatPage.tsx
│       │   │   ├── BroadcastPage.tsx
│       │   │   ├── ReportsPage.tsx
│       │   │   ├── AgentsPage.tsx
│       │   │   └── SettingsPage.tsx
│       │   ├── 📁 stores/           # Zustand stores
│       │   │   ├── auth.store.ts
│       │   │   ├── chat.store.ts
│       │   │   └── ui.store.ts
│       │   ├── 📁 hooks/            # Custom React hooks
│       │   │   ├── useSocket.ts
│       │   │   ├── useAuth.ts
│       │   │   └── useChat.ts
│       │   ├── 📁 services/         # API call layer
│       │   │   ├── api.client.ts    # Axios instance + interceptors
│       │   │   ├── auth.service.ts
│       │   │   ├── chat.service.ts
│       │   │   └── store.service.ts
│       │   ├── 📁 types/            # Frontend TypeScript types
│       │   │   └── index.ts
│       │   ├── 📁 utils/
│       │   │   ├── format.ts        # Date, number formatting
│       │   │   └── constants.ts
│       │   ├── App.tsx
│       │   ├── main.tsx
│       │   └── router.tsx           # React Router config
│       ├── index.html
│       ├── vite.config.ts
│       ├── tailwind.config.ts
│       ├── tsconfig.json
│       └── package.json
│
├── 📁 shared-types/                 # Types shared antara FE & BE
│   └── index.ts
├── .gitignore
├── ecosystem.config.js              # PM2 config
└── README.md
```

## 3.2 Coding Conventions

### Naming
```typescript
// Files: kebab-case
auth.service.ts
chat.controller.ts

// React Components: PascalCase
ChatBubble.tsx
UserAvatar.tsx

// Variables & Functions: camelCase
const chatMessages = []
function handleSendMessage() {}

// Constants: UPPER_SNAKE_CASE
const MAX_RETRY_COUNT = 3
const AI_COOLDOWN_MS = 30000

// Types & Interfaces: PascalCase dengan prefix I untuk interface
type MessageStatus = 'sent' | 'delivered' | 'read'
interface IUser { id: string; email: string }

// Prisma models: PascalCase (otomatis dari schema)
```

### API Response Format (WAJIB KONSISTEN)
```typescript
// Success
{
  "success": true,
  "data": { ... },
  "meta": { "page": 1, "total": 100 }  // untuk list
}

// Error
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Email tidak valid",
    "details": [ ... ]  // optional, dari Zod
  }
}
```

### Error Handling Pattern
```typescript
// Backend: Semua error dilempar ke error middleware
// Gunakan custom AppError class
class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string
  ) {
    super(message)
  }
}

// Contoh penggunaan di service
if (!store) throw new AppError(404, 'STORE_NOT_FOUND', 'Toko tidak ditemukan')
```

### Environment Variables
```bash
# apps/backend/.env

# Server
PORT=3001
NODE_ENV=production

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/crm_wa"

# Redis
REDIS_URL="redis://localhost:6379"

# JWT
JWT_SECRET="your-super-secret-key-min-32-chars"
JWT_REFRESH_SECRET="your-refresh-secret-key"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"

# OpenAI
OPENAI_API_KEY="sk-..."
OPENAI_MODEL="gpt-4o-mini"

# Frontend URL (untuk CORS)
FRONTEND_URL="https://crm.datasdm.com"
```

---

# BAGIAN 4: DATABASE SCHEMA (Prisma)

```prisma
// apps/backend/prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String    @id @default(cuid())
  email        String    @unique
  passwordHash String
  name         String
  role         UserRole  @default(CS)
  isActive     Boolean   @default(true)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  storeAssignments StoreAgent[]
  messages         Message[]    @relation("SentByAgent")

  @@map("users")
}

enum UserRole {
  ADMIN
  CS
}

model Store {
  id           String       @id @default(cuid())
  name         String
  phoneNumber  String?
  waStatus     WAStatus     @default(DISCONNECTED)
  aiEnabled    Boolean      @default(false)
  aiSystemPrompt String?    @db.Text
  aiModel      String       @default("gpt-4o-mini")
  aiCooldownMs Int          @default(30000)
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt

  agents       StoreAgent[]
  contacts     Contact[]
  broadcasts   Broadcast[]

  @@map("stores")
}

enum WAStatus {
  CONNECTED
  DISCONNECTED
  CONNECTING
  QR_READY
}

model StoreAgent {
  storeId   String
  userId    String
  store     Store  @relation(fields: [storeId], references: [id])
  user      User   @relation(fields: [userId], references: [id])

  @@id([storeId, userId])
  @@map("store_agents")
}

model Contact {
  id          String    @id @default(cuid())
  storeId     String
  phoneNumber String
  name        String?
  pushName    String?
  labels      String[]  @default([])
  isBotActive Boolean   @default(true)
  isBlocked   Boolean   @default(false)
  lastSeenAt  DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  store       Store     @relation(fields: [storeId], references: [id])
  messages    Message[]

  @@unique([storeId, phoneNumber])
  @@map("contacts")
}

model Message {
  id          String        @id @default(cuid())
  contactId   String
  storeId     String
  content     String        @db.Text
  mediaUrl    String?
  mediaType   String?
  direction   Direction
  status      MessageStatus @default(SENT)
  isAI        Boolean       @default(false)
  agentId     String?
  waMessageId String?
  replyToId   String?       // ID untuk fitur quote message
  createdAt   DateTime      @default(now())

  contact     Contact       @relation(fields: [contactId], references: [id])
  agent       User?         @relation("SentByAgent", fields: [agentId], references: [id])
  aiLog       AILog?

  @@index([contactId, createdAt])
  @@index([storeId, createdAt])
  @@map("messages")
}

enum Direction {
  INBOUND
  OUTBOUND
}

enum MessageStatus {
  SENT
  DELIVERED
  READ
  FAILED
}

model AILog {
  id           String   @id @default(cuid())
  messageId    String   @unique
  prompt       String   @db.Text
  response     String   @db.Text
  toolCalls    Json?    // Menyimpan rekam jejak function calling
  model        String
  promptTokens Int
  totalTokens  Int
  latencyMs    Int
  createdAt    DateTime @default(now())

  message      Message  @relation(fields: [messageId], references: [id])

  @@map("ai_logs")
}

model Broadcast {
  id          String          @id @default(cuid())
  storeId     String
  message     String          @db.Text
  scheduledAt DateTime?
  sentAt      DateTime?
  status      BroadcastStatus @default(DRAFT)
  createdAt   DateTime        @default(now())

  store       Store           @relation(fields: [storeId], references: [id])
  recipients  BroadcastRecipient[]

  @@map("broadcasts")
}

enum BroadcastStatus {
  DRAFT
  SCHEDULED
  SENDING
  DONE
  FAILED
}

model BroadcastRecipient {
  id          String            @id @default(cuid())
  broadcastId String
  phoneNumber String
  status      RecipientStatus   @default(PENDING)
  sentAt      DateTime?
  error       String?

  broadcast   Broadcast         @relation(fields: [broadcastId], references: [id])

  @@map("broadcast_recipients")
}

enum RecipientStatus {
  PENDING
  SENT
  FAILED
}
```

---

# BAGIAN 5: MASTER PROMPT UNTUK CLAUDE AGENT

## 5.1 SYSTEM CONTEXT PROMPT
> **Paste ini di awal SETIAP sesi baru dengan Claude sebelum memberi instruksi apapun.**

```
Kamu adalah senior full-stack engineer yang sedang membangun ulang (rewrite) sistem CRM WhatsApp AI dari nol.

KONTEKS PROYEK:
- Nama: CRM WhatsApp AI (crm.datasdm.com)
- Deployment: Windows laptop sebagai server lokal, Cloudflare Tunnel, PM2
- Users: Owner/Admin dan CS/Agent
- Fitur: Multi-toko WA, AI auto-reply (OpenAI), Chat real-time, Broadcast, Laporan

TECH STACK YANG SUDAH DITETAPKAN (TIDAK BOLEH DIUBAH):
- Frontend: React 18 + Vite + TypeScript + shadcn/ui + TailwindCSS + Zustand
- Backend: Node.js + Express + TypeScript
- WA Engine: Baileys
- Database: PostgreSQL + Prisma
- Cache/Queue: Redis (ioredis)
- Real-time: Socket.IO
- Auth: JWT + bcrypt
- Validation: Zod
- Logger: Winston
- Process: PM2

FOLDER STRUCTURE: [paste struktur folder dari Bagian 3.1]
CODING CONVENTIONS: [paste konvensi dari Bagian 3.2]
DATABASE SCHEMA: [paste Prisma schema dari Bagian 4]

PRINSIP YANG WAJIB DIIKUTI:
1. SEMUA file menggunakan TypeScript strict mode - TIDAK ADA 'any' kecuali terpaksa
2. SEMUA API endpoint punya Zod validation
3. SEMUA error dihandle lewat error middleware, tidak ada try/catch yang diam-diam
4. SEMUA response API mengikuti format standar {success, data, error}
5. SEMUA business logic ada di Service, bukan di Controller
6. TIDAK ADA logic di route file selain memanggil controller
7. Setiap file maksimal 200 baris - kalau lebih, pecah jadi file terpisah
8. Tulis komentar untuk logic yang tidak obvious
9. Gunakan async/await, BUKAN callback atau .then().catch()
10. Handle Windows path compatibility (pakai path.join, bukan hardcode slash)

Saat aku memintamu mengerjakan sebuah fitur, kamu akan:
1. Sebutkan file apa saja yang akan dibuat/dimodifikasi
2. Buat semua file tersebut secara lengkap dan siap pakai
3. Berikan instruksi instalasi/command yang perlu dijalankan
4. Beritahu aku apa yang perlu ditest setelah implementasi

Mulai sekarang, tunggu instruksiku untuk mengerjakan fitur pertama.
```

---

## 5.2 PROMPT PER FASE EKSEKUSI

### FASE 0 — Project Setup (Estimasi: 30 menit)
```
Kerjakan FASE 0: Project Setup

Buat struktur folder monorepo lengkap sesuai spesifikasi, lalu:
1. Setup apps/backend: init TypeScript project, install semua dependencies, konfigurasi tsconfig.json, setup Prisma dengan schema yang sudah ditetapkan, setup Winston logger, buat apps/backend/src/app.ts dasar dengan Express + CORS + error middleware
2. Setup apps/frontend: init Vite + React + TypeScript, install TailwindCSS + shadcn/ui, install Zustand + React Router + Axios + Socket.IO client
3. Buat ecosystem.config.js untuk PM2 (backend dev & production)
4. Buat .env.example untuk backend

Hasilkan semua file lengkap. Di akhir, berikan command lengkap untuk:
- Install dependencies
- Setup database (prisma migrate)
- Jalankan development
```

### FASE 1 — Auth System (Estimasi: 45 menit)
```
Kerjakan FASE 1: Authentication System

Backend:
- apps/backend/src/modules/auth/auth.schema.ts (Zod schemas untuk login, register)
- apps/backend/src/modules/auth/auth.service.ts (login, refresh token, logout logic)
- apps/backend/src/modules/auth/auth.controller.ts
- apps/backend/src/modules/auth/auth.routes.ts
- apps/backend/src/shared/middleware/auth.middleware.ts (verify JWT)
- apps/backend/src/shared/utils/response.ts (standard response helper)
- Seed file untuk create admin user pertama

Frontend:
- apps/frontend/src/pages/LoginPage.tsx (form login yang clean & professional)
- apps/frontend/src/stores/auth.store.ts (Zustand)
- apps/frontend/src/services/auth.service.ts
- apps/frontend/src/hooks/useAuth.ts
- apps/frontend/src/components/layout/ProtectedRoute.tsx
- apps/frontend/src/router.tsx

Pastikan: JWT disimpan di httpOnly cookie (bukan localStorage), refresh token flow berjalan, redirect ke /login jika tidak authenticated.
```

### FASE 2 — Store Management & WA Connection (Estimasi: 60 menit)
```
Kerjakan FASE 2: Store Management & WhatsApp Connection

Backend:
- apps/backend/src/modules/stores/ (CRUD store, full module)
- apps/backend/src/modules/whatsapp/wa.manager.ts (class yang manage multiple Baileys sessions)
- apps/backend/src/modules/whatsapp/wa.handler.ts (handle events: message, qr, connection)
- apps/backend/src/modules/whatsapp/wa.service.ts (sendMessage, getQR, disconnect)
- apps/backend/src/socket/socket.gateway.ts (emit events ke frontend via Socket.IO)

Frontend:
- apps/frontend/src/pages/SettingsPage.tsx (daftar toko, tambah toko, status koneksi)
- apps/frontend/src/components/store/StoreCard.tsx (card dengan status badge & tombol QR)
- apps/frontend/src/components/store/QRModal.tsx (modal tampilkan QR code untuk scan)
- apps/frontend/src/hooks/useSocket.ts

Pastikan: QR code auto-refresh, status koneksi real-time via Socket.IO, session Baileys tersimpan di folder /wa-sessions/ agar tidak perlu scan ulang setelah restart.
```

### FASE 3 — Chat System (Estimasi: 90 menit)
```
Kerjakan FASE 3: Chat System (Fitur Utama)

Backend:
- apps/backend/src/modules/chats/ (get conversations, get messages, send message, mark read)
- Update wa.handler.ts: simpan pesan masuk ke database, emit ke Socket.IO

Frontend:
- apps/frontend/src/pages/ChatPage.tsx (layout utama: sidebar + chat window)
- apps/frontend/src/components/chat/ChatSidebar.tsx (list kontak, search, filter toko, unread badge, indikator label/bot status)
- apps/frontend/src/components/chat/ChatWindow.tsx (area pesan + input + header dengan toggle AI & Label)
- apps/frontend/src/components/chat/ChatBubble.tsx (bubble masuk/keluar, timestamp, status, support media render)
- apps/frontend/src/components/chat/ChatInput.tsx (textarea + send button)
- apps/frontend/src/stores/chat.store.ts (Zustand: conversations, active contact, messages)
- apps/frontend/src/hooks/useChat.ts

Pastikan: Virtual scrolling untuk ribuan pesan (pakai react-window atau intersection observer), pesan baru langsung muncul tanpa refresh, input tidak hilang saat ada pesan masuk.
```

### FASE 4 — AI Auto-Reply (Estimasi: 45 menit)
```
Kerjakan FASE 4: AI Auto-Reply & Function Calling System

Backend:
- apps/backend/src/ai/ai.service.ts (call OpenAI dengan dukungan `tools` / function calling, handle error, retry logic)
- apps/backend/src/ai/tools/ (implementasi tools: `matikan_bot_kontak`, `cek_ongkir_jne`, `kirim_media_katalog`, `set_label`)
- apps/backend/src/ai/ai.queue.ts (Redis queue agar tidak rate limit, max concurrent 5)
- Update wa.handler.ts: setelah pesan masuk → cek `store.aiEnabled` & `contact.isBotActive` → push ke queue → jalankan AI (termasuk loop eksekusi tool jika diminta)
- Cooldown logic: AI tidak reply jika ada agent yang sudah reply dalam X menit terakhir
- Log setiap AI interaction (termasuk data `toolCalls`) ke tabel ai_logs

Frontend:
- Update SettingsPage.tsx: tambah section konfigurasi AI per toko
  - Toggle on/off AI
  - System prompt textarea
  - Model selector
  - Cooldown setting
- apps/frontend/src/components/chat/AIIndicator.tsx (badge kecil di bubble yang dikirim AI)
- apps/frontend/src/components/chat/ContactLabels.tsx (UI untuk melihat/edit label kontak)
- Update ChatSidebar.tsx & ChatWindow.tsx: Tampilkan tombol toggle "Bot Active" per kontak agar CS manusia bisa ambil alih.

Pastikan: Flow function calling (AI minta tool -> Backend jalankan -> AI beri respon final) berjalan mulus. Jika OpenAI error (rate limit, timeout), pesan error di-log tapi tidak crash sistem. Queue dibersihkan jika store disconnect.
```

### FASE 5 — Broadcast (Estimasi: 45 menit)
```
Kerjakan FASE 5: Broadcast System

Backend:
- apps/backend/src/modules/broadcast/ (create, list, send now, schedule)
- Broadcast worker: ambil recipients dari queue Redis, kirim dengan delay 2-5 detik antar pesan (anti-spam WA), update status per recipient

Frontend:
- apps/frontend/src/pages/BroadcastPage.tsx
  - Form: pilih toko, compose pesan, input nomor (textarea atau upload CSV)
  - Tabel history broadcast dengan status & progress
- apps/frontend/src/components/broadcast/RecipientUpload.tsx (parse CSV, validasi nomor)

Pastikan: Broadcast tidak bisa dikirim ke nomor yang sama 2x dalam 1 broadcast, ada konfirmasi sebelum kirim, bisa dibatalkan jika belum selesai.
```

### FASE 6 — Reports & Polish (Estimasi: 45 menit)
```
Kerjakan FASE 6: Reports, Agent Management & Final Polish

Backend:
- apps/backend/src/modules/reports/ (statistik harian, token usage, response time)
- apps/backend/src/modules/agents/ (CRUD agent, assign ke toko)

Frontend:
- apps/frontend/src/pages/ReportsPage.tsx (grafik menggunakan recharts: line chart pesan per hari, pie chart AI vs manual)
- apps/frontend/src/pages/AgentsPage.tsx (tabel agent, tambah/edit/hapus, assign toko)
- apps/frontend/src/components/layout/AppShell.tsx (sidebar navigasi utama yang rapi)
- apps/frontend/src/components/layout/Header.tsx (nama toko aktif, user menu, logout)

Final:
- Tambahkan loading skeleton di semua halaman yang fetch data
- Tambahkan error boundary global
- Pastikan semua halaman responsive (mobile-friendly)
- Review semua console.log → ganti dengan logger.debug atau hapus
- Buat README.md dengan instruksi setup lengkap
```

---

# BAGIAN 6: CHECKLIST QA MANUAL

Jalankan checklist ini setelah setiap fase selesai sebelum lanjut ke fase berikutnya.

## ✅ Checklist Fase 0 (Setup)
- [ ] `npm run dev` di backend tidak error
- [ ] `npm run dev` di frontend tidak error, tampil di browser
- [ ] Prisma schema berhasil di-migrate (`npx prisma migrate dev`)
- [ ] File `.env` sudah diisi semua variable

## ✅ Checklist Fase 1 (Auth)
- [ ] Login dengan email/password yang benar → dapat JWT → redirect ke dashboard
- [ ] Login dengan password salah → tampil pesan error yang jelas
- [ ] Akses halaman protected tanpa login → redirect ke /login
- [ ] Refresh halaman saat sudah login → tetap login (token masih valid)
- [ ] Logout → redirect ke /login, tidak bisa back ke dashboard

## ✅ Checklist Fase 2 (WA Connection)
- [ ] Tambah toko baru → muncul di daftar
- [ ] Klik "Connect" → QR Code muncul dalam < 5 detik
- [ ] Scan QR dengan WhatsApp → status berubah ke "Connected" tanpa refresh halaman
- [ ] Restart PM2 backend → sesi WA tidak perlu scan ulang (session tersimpan)
- [ ] Toko yang disconnect → status berubah otomatis di UI

## ✅ Checklist Fase 3 (Chat)
- [ ] Kirim pesan dari HP ke nomor WA toko → muncul di dashboard dalam < 3 detik
- [ ] Balas dari dashboard → pesan terkirim ke HP
- [ ] Buka 2 tab browser → pesan muncul di kedua tab (real-time sync)
- [ ] Search kontak → filter berjalan
- [ ] Filter per toko → hanya tampilkan chat dari toko tersebut
- [ ] Scroll ke atas chat panjang → tidak lag

## ✅ Checklist Fase 4 (AI)
- [ ] Toggle AI ON di settings toko → AI aktif
- [ ] Kirim pesan dari HP → AI auto-reply dalam < 10 detik
- [ ] Bubble AI reply punya badge "AI" di dashboard
- [ ] CS balas manual → AI tidak reply selama cooldown period
- [ ] Nonaktifkan AI → AI tidak reply lagi
- [ ] Cek ai_logs di database → ada record untuk setiap AI reply

## ✅ Checklist Fase 5 (Broadcast)
- [ ] Buat broadcast dengan 3 nomor → semua terkirim dengan jeda
- [ ] Status per nomor terupdate (Sent/Failed)
- [ ] Upload CSV nomor → berhasil di-parse dan tampil list
- [ ] Broadcast ke nomor tidak valid → status Failed, tidak crash

## ✅ Checklist Fase 6 (Reports)
- [ ] Grafik pesan per hari tampil dengan data yang benar
- [ ] Token usage terakumulasi dari ai_logs
- [ ] Tambah agent baru → bisa login dengan akun agent tersebut
- [ ] Agent tidak bisa akses halaman Settings (role restriction)

---

# BAGIAN 7: KONFIGURASI DEPLOYMENT

## 7.1 PM2 Config (ecosystem.config.js)
```javascript
module.exports = {
  apps: [
    {
      name: 'crm-backend',
      script: './apps/backend/dist/app.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      },
      error_file: './logs/backend-error.log',
      out_file: './logs/backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
}
```

## 7.2 Cloudflare Tunnel Config
```yaml
# ~/.cloudflared/config.yml
tunnel: <your-tunnel-id>
credentials-file: C:\Users\<user>\.cloudflared\<tunnel-id>.json

ingress:
  - hostname: crm.datasdm.com
    service: http://localhost:5173  # Vite preview atau serve -s dist
  - hostname: api.datasdm.com       # Opsional: pisah subdomain untuk API
    service: http://localhost:3001
  - service: http_status:404
```

> **Catatan:** Untuk production, build frontend dulu (`npm run build`) lalu serve folder `dist/` dengan `serve` package atau langsung dari Express sebagai static files.

## 7.3 Command Cheat Sheet
```bash
# Development
cd apps/backend && npm run dev
cd apps/frontend && npm run dev

# Build Production
cd apps/backend && npm run build
cd apps/frontend && npm run build

# Database
npx prisma migrate dev --name <nama_migration>
npx prisma studio                    # GUI database browser
npx prisma db seed                   # Jalankan seed (admin user)

# PM2
pm2 start ecosystem.config.js
pm2 restart crm-backend
pm2 logs crm-backend
pm2 monit

# Redis (Windows) — pakai WSL atau Docker
wsl redis-server
# atau
docker run -d -p 6379:6379 redis:alpine

# PostgreSQL (Windows)
# Install via https://www.postgresql.org/download/windows/
# Atau via Docker:
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=password -e POSTGRES_DB=crm_wa postgres:15
```

---

# BAGIAN 8: TIPS EKSEKUSI 1 HARI

## Urutan Kerja yang Efisien
```
08:00 - 08:30  →  Fase 0: Setup project & install dependencies
08:30 - 09:15  →  Fase 1: Auth system
09:15 - 10:15  →  Fase 2: Store & WA Connection (test QR scan!)
10:15 - 12:00  →  Fase 3: Chat system (fase terberat)
12:00 - 13:00  →  ISTIRAHAT
13:00 - 13:45  →  Fase 4: AI auto-reply
13:45 - 14:30  →  Fase 5: Broadcast
14:30 - 15:30  →  Fase 6: Reports & polish
15:30 - 17:00  →  Buffer: bug fix, QA manual, deploy ke PM2
```

## Cara Efektif Bekerja dengan Claude Agent
1. **Satu fase = satu sesi Claude** jika memungkinkan — konteks tetap fresh
2. **Jika Claude berhenti di tengah file** → ketik "lanjutkan" atau "continue from [nama file]"
3. **Jika ada error** → paste error message lengkap ke Claude, jangan parafrase
4. **Jangan skip QA checklist** → lebih baik ketahuan error di fase 2 daripada di fase 6
5. **Simpan setiap file yang dibuat Claude** sebelum lanjut ke file berikutnya
6. **Commit ke git setelah setiap fase** → `git commit -m "feat: phase-X complete"`

## Hal yang Sering Bikin Stuck di Windows
- **Baileys path**: gunakan `path.join()` untuk semua path file session
- **Redis di Windows**: pakai WSL2 atau Docker Desktop (Redis tidak native Windows)
- **PostgreSQL port**: pastikan port 5432 tidak diblok Windows Firewall
- **PM2 di Windows**: gunakan `pm2 start` bukan `pm2 start ecosystem.config.js --env production` untuk development

---

*Dokumen ini adalah sumber kebenaran tunggal (single source of truth) untuk rewrite CRM WhatsApp AI.*
*Versi: 1.0 | Dibuat untuk eksekusi 1 hari dengan Claude Agent*
