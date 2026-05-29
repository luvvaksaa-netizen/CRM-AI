# 06 — Tech Stack ADR (Architecture Decision Records)

> **Versi:** 1.0 | **Tanggal:** 2026-05-29

---

## ADR-001: WhatsApp Channel — Cloud API vs WWebJS

### Status: ACCEPTED

### Context
Sistem saat ini menggunakan whatsapp-web.js (WWebJS) + WPPConnect WA-JS untuk automasi WhatsApp Web via headless browser (Puppeteer/Chromium). Pendekatan ini telah menyebabkan:
- 2 nomor WhatsApp kantor **terbanned**
- 1 nomor dalam **status ditinjau**
- Risiko permanen kehilangan akses WhatsApp untuk bisnis

### Decision
**Migrasi ke WhatsApp Business Platform (Cloud API)** sebagai primary channel, dengan WWebJS dipertahankan sebagai development/testing adapter saja.

### Rationale

| Kriteria | WWebJS | Cloud API |
|----------|--------|-----------|
| Compliance | ❌ Melanggar ToS | ✅ Resmi dari Meta |
| Ban Risk | ❌ Sangat tinggi | ✅ Minimal |
| Reliability | ❌ Browser restart, session loss | ✅ Webhook-based, stateless |
| Resource | ❌ 1 Chromium per nomor (~200MB RAM) | ✅ HTTP API, ~0 resource |
| Template | ❌ Tidak ada | ✅ Approved templates |
| Features | ✅ Full WA features (labels, etc.) | ⚠️ Subset fitur |
| Cost | ✅ Gratis (tapi banned) | ⚠️ Per-conversation pricing |
| Multi-device | ❌ Butuh session per device | ✅ Native multi-device |

### Consequences
- Memerlukan pendaftaran Meta Business (1-4 minggu)
- Biaya per-conversation (1.000 gratis/bulan, lalu ~$0.05-0.08/conv)
- Beberapa fitur WWebJS (live labels, read receipts) hanya tersedia di API terbatas
- Perlu message template approval untuk outbound

### Alternatives Considered
1. **BSP Resmi (Twilio, WATI, MessageBird)** — Lebih mudah setup tapi lebih mahal, vendor lock-in
2. **WPPConnect Server** — Masih automasi, tetap berisiko banned
3. **Hybrid (WWebJS + Cloud API)** — Selected as transition strategy

---

## ADR-002: Backend Runtime — Node.js (Retained)

### Status: ACCEPTED

### Context
Sistem saat ini menggunakan Node.js 20 dengan Express.js. Apakah perlu beralih ke runtime lain?

### Decision
**Tetap menggunakan Node.js 20 LTS** dengan Express.js.

### Rationale
- Tim sudah familiar dengan JavaScript/Node.js
- WWebJS hanya tersedia untuk Node.js (legacy adapter)
- Ekosistem npm mature untuk kebutuhan proyek (openai, sequelize, socket.io)
- Event-driven model cocok untuk real-time chat application
- Performance Node.js cukup untuk skala target (5.000 pesan/hari)

### Consequences
- Tetap single-threaded (gunakan PM2 cluster untuk scale)
- Tidak ada type safety native (pertimbangkan TypeScript di masa depan)

---

## ADR-003: Database — PostgreSQL (Migrasi dari SQLite)

### Status: ACCEPTED

### Context
SQLite saat ini digunakan untuk production. Masalah:
- Tidak mendukung concurrent writes dengan baik
- File-based — sulit di-replicate/backup secara atomic
- Tidak ada connection pooling
- Limit pada complex queries dan joins

### Decision
**Migrasi ke PostgreSQL** untuk production. SQLite tetap digunakan untuk development/testing.

### Rationale

| Kriteria | SQLite | PostgreSQL |
|----------|--------|-----------|
| Concurrent writes | ❌ Lock seluruh DB | ✅ Row-level locking |
| Connection pooling | ❌ Tidak ada | ✅ pgBouncer / native |
| Replication | ❌ Manual copy | ✅ Streaming replication |
| Backup | ❌ File copy | ✅ pg_dump, WAL archiving |
| Hosting | ✅ Zero config | ⚠️ Perlu server |
| Free tier | ✅ Gratis | ✅ Supabase/Neon gratis |
| Sequelize support | ✅ | ✅ |

### Implementation
- Gunakan Supabase (free tier: 500MB, 2 projects) atau Neon (free tier: 512MB)
- Sequelize dialect switch: `dialect: 'postgres'` (minimal code change)
- Migration via Sequelize CLI (umzug)

### Consequences
- Sedikit peningkatan complexity deployment
- Perlu manage connection string secara aman
- Data migration dari SQLite → PostgreSQL perlu script khusus

---

## ADR-004: AI Provider — Groq Primary + OpenAI Fallback (Retained)

### Status: ACCEPTED

### Context
Sistem menggunakan dual-engine: Groq (Llama) sebagai primary dan OpenAI (GPT-4o-mini) sebagai fallback.

### Decision
**Pertahankan arsitektur dual-engine** dengan perbaikan:
- Groq (Llama 3.3 70B) → Primary (gratis, cepat)
- OpenAI (GPT-4o-mini) → Fallback (lebih reliable, berbayar)
- Whisper (OpenAI) → Voice note transcription
- Vision (GPT-4o-mini) → Image analysis

### Rationale
- Groq gratis tier cukup untuk mayoritas traffic
- OpenAI fallback menjamin 0 downtime
- Round-robin Groq key rotation sudah terimplementasi dan efektif
- Biaya OpenAI fallback minimal (~$0.001/request)

### Improvements Needed
1. **Prompt optimization per model** — Llama dan GPT punya behavior berbeda
2. **Token counting** — Monitor usage dan cost per provider
3. **Quality metrics** — Track response quality per model
4. **Model version pinning** — Jangan gunakan `latest`, pin ke versi spesifik

---

## ADR-005: Frontend Framework — React + Vite (Migrasi dari Monolith HTML)

### Status: PROPOSED

### Context
Frontend saat ini adalah single HTML file (183KB, 3.289 baris) dengan inline CSS/JS. Unmaintainable dan tidak scalable.

### Decision
**Migrasi ke React + Vite** (atau Next.js jika SSR dibutuhkan).

### Options Considered

| Framework | Pros | Cons |
|-----------|------|------|
| React + Vite | ✅ Fast HMR, simple, well-known | ⚠️ No SSR out of box |
| Next.js | ✅ SSR, API routes, file-routing | ⚠️ Overkill for dashboard |
| Vue + Vite | ✅ Simpler learning curve | ⚠️ Smaller ecosystem |
| Svelte | ✅ Small bundle, reactive | ⚠️ Less talent pool |
| Vanilla JS refactor | ✅ No framework overhead | ❌ Still unmaintainable |

### Rationale
- React adalah framework paling popular — mudah hire/onboard developer
- Vite lebih cepat dari CRA/webpack
- Component model cocok untuk dashboard (reusable widgets)
- State management dengan Zustand (simple, lightweight)
- Shadcn/ui atau Radix untuk component library

### Consequences
- Perlu belajar React jika belum familiar
- Build step diperlukan (tapi Vite sangat cepat)
- API harus dipisahkan jelas dari frontend (sudah terpisah sekarang)

---

## ADR-006: Real-Time Communication — Socket.IO (Retained)

### Status: ACCEPTED

### Context
Socket.IO digunakan untuk real-time updates (new messages, status changes, system logs). Apakah perlu diganti?

### Decision
**Pertahankan Socket.IO** dengan perbaikan keamanan.

### Rationale
- Sudah terimplementasi dan berjalan
- WebSocket dengan fallback ke long-polling cocok untuk dashboard
- Event-based model cocok untuk real-time chat
- Library mature dan well-maintained

### Improvements Needed
1. **Authentication middleware** — Validasi session sebelum connect
2. **Room-based events** — Emit per-store, bukan broadcast
3. **Event schema validation** — Type-safe events
4. **Connection rate limiting** — Prevent abuse

---

## ADR-007: Session Store — Sequelize Session Store (Retained, with Improvements)

### Status: ACCEPTED

### Context
Session disimpan di SQLite via `connect-session-sequelize`. Ini sudah lebih baik dari MemoryStore default.

### Decision
**Pertahankan Sequelize session store**, migrasi ke PostgreSQL bersama database utama.

### Improvements Needed
1. **Session secret dari environment** — Bukan hardcoded
2. **Session rotation** — Regenerate session ID setelah login
3. **Cookie security** — SameSite=Strict, Secure in production, HttpOnly

---

## ADR-008: Deployment — Docker Compose (Improved)

### Status: ACCEPTED

### Context
Dockerfile ada tapi menggunakan `chmod -R 777`, hanya 1 container, dan tidak ada orchestration.

### Decision
**Perbaiki Docker setup** dengan Docker Compose multi-service.

### Target docker-compose.yml
```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgres://user:pass@db:5432/crm
    depends_on:
      - db
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
  
  db:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      - POSTGRES_USER=crm
      - POSTGRES_PASSWORD=${DB_PASSWORD}
      - POSTGRES_DB=crm_ai
    restart: unless-stopped

volumes:
  pgdata:
```

### Consequences
- Lebih complex deployment tapi lebih robust
- Need docker-compose pada server
- Easier to add Redis/MinIO later

---

## ADR-009: Logging — Pino (Migrasi dari Custom Logger)

### Status: PROPOSED

### Context
Logger saat ini adalah custom module dengan ANSI colors. Tidak structured, tidak queryable.

### Decision
**Migrasi ke Pino** untuk structured JSON logging.

### Rationale
- Pino: fastest Node.js logger
- JSON format — queryable dengan ELK/Grafana Loki
- Built-in request serialization
- Pino-pretty untuk development (human-readable)
- Native Express integration via pino-http

---

## ADR-010: Testing — Jest (New)

### Status: PROPOSED

### Context
Tidak ada test framework. Test coverage ~0%.

### Decision
**Implementasi Jest** sebagai test framework utama.

### Rationale
- Most popular JS test framework
- Built-in mocking, assertions, coverage
- Good Sequelize testing patterns
- Snapshot testing for API responses
- Watch mode untuk development

### Target Coverage
- Core services (AI, message pipeline, policy): ≥80%
- API routes: ≥60%
- Utils: ≥90%
- Overall: ≥60%

---

## Tech Stack Summary (Current → Target)

| Layer | Current | Target | ADR |
|-------|---------|--------|-----|
| WA Channel | WWebJS + WA-JS | WhatsApp Cloud API | ADR-001 |
| Runtime | Node.js 20 + Express | Node.js 20 + Express | ADR-002 |
| Database | SQLite (WAL) | PostgreSQL | ADR-003 |
| AI Provider | Groq + OpenAI | Groq + OpenAI (improved) | ADR-004 |
| Frontend | Monolith HTML | React + Vite | ADR-005 |
| Real-time | Socket.IO | Socket.IO (secured) | ADR-006 |
| Session | Sequelize Store | Sequelize Store (PG) | ADR-007 |
| Deployment | Dockerfile | Docker Compose | ADR-008 |
| Logging | Custom | Pino (JSON) | ADR-009 |
| Testing | None | Jest | ADR-010 |

---

## Acceptance Criteria Dokumen ADR

- [x] Setiap keputusan memiliki context, decision, rationale
- [x] Alternatif yang dipertimbangkan terdokumentasi
- [x] Consequences dari setiap keputusan jelas
- [x] Status (Accepted/Proposed/Deprecated) tercantum
- [x] Tech stack mapping current → target
