# 05 — Task Breakdown & Sprint Plan

> **Versi:** 1.0 | **Tanggal:** 2026-05-29
> **Durasi Total:** ~12 minggu (6 sprint × 2 minggu)

---

## Sprint Overview

| Sprint | Minggu | Fokus | Deliverables |
|--------|--------|-------|-------------|
| 1 | 1-2 | Security Hardening & Repo Cleanup | Auth fix, gitignore, secrets rotation |
| 2 | 3-4 | Adapter Pattern & Message Pipeline Refactor | Channel interface, WWebJS wrapper |
| 3 | 5-6 | WhatsApp Cloud API Integration | Webhook, sender, template system |
| 4 | 7-8 | Compliance & Policy Guard | Opt-in/out, 24h window, audit log |
| 5 | 9-10 | Frontend Rewrite & Database Migration | React SPA, PostgreSQL |
| 6 | 11-12 | Testing, CI/CD & Production Readiness | Jest suite, GitHub Actions, monitoring |

---

## Sprint 1: Security Hardening & Repo Cleanup (Minggu 1-2)

### Minggu 1

- [ ] **T1.1** Rotate semua API keys (OpenAI, Groq) yang terekspos
  - Waktu: 30 menit
  - File: `.env` (lokal), OpenAI dashboard, Groq dashboard
  
- [ ] **T1.2** Update `.gitignore` — tambahkan patterns yang hilang
  - Waktu: 1 jam
  - Tambahkan: `*.exe`, `backups/`, `*.sqlite`, `settings.json`, `*.mp4`, `logs/`, `chat_history.json`, `komerce_cache.json`
  - File: `.gitignore`

- [ ] **T1.3** Remove tracked files yang seharusnya gitignored
  - Waktu: 1 jam
  - Command: `git rm --cached cloudflared.exe database.sqlite backups/ settings.json logs/ *.mp4 komerce_cache.json`
  - Buat commit: "chore: remove sensitive and binary files from tracking"

- [ ] **T1.4** Implementasi password hashing (bcrypt)
  - Waktu: 3 jam
  - File: `src/services/dashboard_service.js`
  - Detail:
    - Install bcrypt: `npm install bcrypt`
    - Buat utility: `src/utils/password.js` (hashPassword, comparePassword)
    - Update login route untuk compare hash
    - Buat migration script untuk hash existing passwords
    - Update `ADMIN_USERS_JSON` format untuk accept hashed passwords

- [ ] **T1.5** Generate random session secret
  - Waktu: 30 menit
  - File: `src/services/dashboard_service.js:155`
  - Hapus hardcoded secret, require `SESSION_SECRET` dari env
  - Buat startup validation: fail jika `SESSION_SECRET` tidak di-set

- [ ] **T1.6** Restrict CORS origin
  - Waktu: 1 jam
  - File: `src/services/dashboard_service.js:255`
  - Ganti `origin: '*'` dengan whitelist dari env `ALLOWED_ORIGINS`

### Minggu 2

- [ ] **T1.7** Implementasi Socket.IO session auth
  - Waktu: 2 jam
  - File: `src/services/dashboard_service.js`
  - Detail: Share session middleware dengan Socket.IO, reject unauthenticated connections

- [ ] **T1.8** Tambahkan helmet.js security headers
  - Waktu: 1 jam
  - File: `src/services/dashboard_service.js`
  - Install: `npm install helmet`

- [ ] **T1.9** Implementasi CSRF protection
  - Waktu: 2 jam
  - File: `src/services/dashboard_service.js`, `public/login.html`
  - Detail: Double-submit cookie pattern atau csurf middleware

- [ ] **T1.10** File upload MIME validation
  - Waktu: 2 jam
  - File: `src/services/dashboard_service.js:242-249`
  - Install: `npm install file-type`
  - Validasi magic bytes setelah upload

- [ ] **T1.11** Tambahkan `/api/health` endpoint
  - Waktu: 1 jam
  - File: `src/services/dashboard_service.js`
  - Response: `{ status, uptime, database, wa_connections, timestamp }`

- [ ] **T1.12** Cleanup debug files dari root directory
  - Waktu: 1 jam
  - Pindahkan ke `scripts/debug/` atau hapus: `debug_*.js`, `test_*.js`, `update_*.js`, `extract_*.js`, `check_*.js`

**Sprint 1 Total Effort: ~16 jam**

---

## Sprint 2: Adapter Pattern & Pipeline Refactor (Minggu 3-4)

### Minggu 3

- [ ] **T2.1** Buat Channel Adapter interface
  - Waktu: 2 jam
  - File: `src/adapters/interface.js` [NEW]
  - Method: sendTextMessage, sendMediaMessage, sendTemplate, markAsRead, getStatus, onMessage

- [ ] **T2.2** Wrap WWebJS di WWebJSAdapter
  - Waktu: 8 jam
  - Files: `src/adapters/wwebjs/client.js` [NEW], `src/adapters/wwebjs/bridge.js` [NEW]
  - Extract logic dari `src/whatsapp_service.js` ke adapter class
  - Implement IChannelAdapter interface

- [ ] **T2.3** Refactor whatsapp_service.js sebagai adapter registry
  - Waktu: 4 jam
  - File: `src/whatsapp_service.js` [MODIFY]
  - Convert ke adapter factory: `getAdapter(storeWaId) → IChannelAdapter`
  - Store adapter type per store (`adapter_type: 'wwebjs' | 'cloud_api'`)

### Minggu 4

- [ ] **T2.4** Decompose message_handler.js
  - Waktu: 8 jam
  - Split menjadi:
    - `src/domain/conversation/message-pipeline.js` [NEW] — orchestrator
    - `src/domain/conversation/debouncer.js` [NEW] — message batching
    - `src/domain/conversation/summary-engine.js` [NEW] — background summary
  - Hapus circular dependencies
  - Pindahkan require() ke top-level

- [ ] **T2.5** Extract AI service ke domain layer
  - Waktu: 4 jam
  - Files:
    - `src/domain/ai/orchestrator.js` [NEW] — main AI logic
    - `src/domain/ai/prompt-builder.js` [NEW] — prompt assembly
    - `src/domain/ai/tool-executor.js` [NEW] — tool calling
    - `src/domain/ai/model-router.js` [NEW] — Groq/OpenAI routing

- [ ] **T2.6** Fix circular dependencies
  - Waktu: 3 jam
  - Audit semua require() paths
  - Implement dependency injection di adapter level
  - Remove all lazy requires (require inside functions)

**Sprint 2 Total Effort: ~29 jam**

---

## Sprint 3: WhatsApp Cloud API Integration (Minggu 5-6)

### Minggu 5

- [ ] **T3.1** Daftar WhatsApp Business Platform
  - Waktu: 2 jam (+ menunggu approval 1-4 minggu)
  - Detail:
    - Buat/verifikasi Meta Business account
    - Buat WhatsApp Business app di Meta for Developers
    - Setup Phone Number ID dan Access Token
    - Catat: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`

- [ ] **T3.2** Implementasi webhook receiver
  - Waktu: 4 jam
  - File: `src/adapters/wa-cloud-api/webhook.js` [NEW]
  - Detail:
    - `GET /api/webhook` — verification challenge
    - `POST /api/webhook` — incoming messages
    - Signature validation (HMAC-SHA256)
    - Parse message types: text, image, video, audio, document, location

- [ ] **T3.3** Implementasi message sender
  - Waktu: 4 jam
  - File: `src/adapters/wa-cloud-api/sender.js` [NEW]
  - Detail:
    - sendTextMessage
    - sendMediaMessage (upload + send)
    - sendTemplate
    - markAsRead
    - Error handling + retry logic

- [ ] **T3.4** Implementasi WACloudAPIAdapter
  - Waktu: 4 jam
  - File: `src/adapters/wa-cloud-api/adapter.js` [NEW]
  - Implement IChannelAdapter interface
  - Wire webhook → message pipeline

### Minggu 6

- [ ] **T3.5** Register message templates di Meta
  - Waktu: 2 jam
  - Template: follow_up_greeting, follow_up_reminder, follow_up_promo
  - Submit untuk approval (1-7 hari)

- [ ] **T3.6** Implementasi template manager
  - Waktu: 3 jam
  - File: `src/domain/notification/template-manager.js` [NEW]
  - CRUD templates from database
  - Map template name → WhatsApp template

- [ ] **T3.7** Store configuration update
  - Waktu: 2 jam
  - File: `src/infrastructure/database/models/Store.js`
  - Tambah fields: `adapter_type`, `phone_number_id`, `wa_access_token` (encrypted)

- [ ] **T3.8** Parallel run test — 1 nomor test
  - Waktu: 4 jam
  - Setup 1 nomor WA test dengan Cloud API
  - Verify: receive, send text, send media, templates
  - Compare behavior dengan WWebJS adapter

**Sprint 3 Total Effort: ~25 jam (+ menunggu Meta approval)**

---

## Sprint 4: Compliance & Policy Guard (Minggu 7-8)

### Minggu 7

- [ ] **T4.1** Buat ConsentRegistry model
  - Waktu: 2 jam
  - File: `src/infrastructure/database/models/ConsentRegistry.js` [NEW]
  - Fields: customer_id, channel, opted_in, opt_in_at, opt_out_at, opt_out_reason

- [ ] **T4.2** Implementasi opt-in/opt-out handler
  - Waktu: 4 jam
  - File: `src/domain/policy/consent-registry.js` [NEW]
  - Detect "STOP"/"BERHENTI" keyword → auto opt-out
  - Detect "MULAI"/"START" → opt-in kembali
  - Block semua outbound ke opted-out customers

- [ ] **T4.3** Implementasi 24-hour window enforcer
  - Waktu: 4 jam
  - File: `src/domain/policy/twenty-four-hour-window.js` [NEW]
  - Cek last incoming message timestamp sebelum kirim outbound
  - Jika > 24 jam → hanya template yang diizinkan
  - Wire ke follow-up scheduler dan manual send

- [ ] **T4.4** Refactor follow-up service (compliant)
  - Waktu: 6 jam
  - File: `src/domain/notification/followup-scheduler.js` [NEW]
  - Perubahan:
    - Cek consent sebelum kirim
    - Gunakan approved templates di luar 24h window
    - Rate limit: max 1 follow-up / 24 jam / customer
    - Remove hardcoded copy, use template manager

### Minggu 8

- [ ] **T4.5** Implementasi audit logger
  - Waktu: 4 jam
  - File: `src/domain/policy/audit-logger.js` [NEW]
  - Log: message_sent, message_received, bot_toggled, agent_updated, consent_changed
  - Store di database, queryable via API

- [ ] **T4.6** Policy Guard middleware
  - Waktu: 3 jam
  - File: `src/domain/policy/policy-guard.js` [NEW]
  - Middleware yang meng-enforce semua policy checks sebelum outbound

- [ ] **T4.7** Update dashboard API dengan consent info
  - Waktu: 2 jam
  - Tambah consent_status ke customer view
  - Tambah opt-in/opt-out toggle di UI

**Sprint 4 Total Effort: ~25 jam**

---

## Sprint 5: Frontend Rewrite & Database Migration (Minggu 9-10)

### Minggu 9

- [ ] **T5.1** Setup React/Next.js project
  - Waktu: 2 jam
  - Directory: `frontend/`
  - Setup: Vite + React + TypeScript
  - UI Library: shadcn/ui atau Radix + custom CSS

- [ ] **T5.2** Implementasi Login page
  - Waktu: 2 jam
  - Dark theme, modern design
  - CSRF token support

- [ ] **T5.3** Implementasi Dashboard overview
  - Waktu: 4 jam
  - KPI cards, funnel chart, trend line
  - Real-time via Socket.IO

- [ ] **T5.4** Implementasi Chat list + Detail view
  - Waktu: 8 jam
  - 3-column layout (list, chat, customer panel)
  - Real-time message updates
  - Message sender indicators (AI/CS/Customer)
  - Media display (images, videos)
  - Manual send input

### Minggu 10

- [ ] **T5.5** Implementasi Agent management UI
  - Waktu: 4 jam
  - CRUD agent, prompt editor, media catalog

- [ ] **T5.6** Implementasi Follow-up management UI
  - Waktu: 3 jam
  - Pending list, cancel, stats

- [ ] **T5.7** PostgreSQL migration
  - Waktu: 6 jam
  - Setup Sequelize CLI migrations
  - Convert SQLite schema → PostgreSQL
  - Data migration script
  - Update connection config

- [ ] **T5.8** Wire frontend ke new backend API
  - Waktu: 4 jam
  - API client layer
  - Socket.IO connection
  - Error handling

**Sprint 5 Total Effort: ~33 jam**

---

## Sprint 6: Testing, CI/CD & Production Readiness (Minggu 11-12)

### Minggu 11

- [ ] **T6.1** Setup Jest test framework
  - Waktu: 2 jam
  - Jest config, test utilities, mock factories

- [ ] **T6.2** Unit tests — AI Orchestrator
  - Waktu: 4 jam
  - Test: prompt building, model routing, tool execution, fallback

- [ ] **T6.3** Unit tests — Message Pipeline
  - Waktu: 4 jam
  - Test: debouncing, dedup, enrichment, policy check

- [ ] **T6.4** Unit tests — Policy Guard
  - Waktu: 3 jam
  - Test: consent check, 24h window, rate limiting

- [ ] **T6.5** Integration tests — Webhook → Response
  - Waktu: 4 jam
  - Test: webhook receive → pipeline → AI → send → log

### Minggu 12

- [ ] **T6.6** Setup GitHub Actions CI
  - Waktu: 2 jam
  - Workflow: lint → test → build on PR

- [ ] **T6.7** Structured logging (pino)
  - Waktu: 3 jam
  - Replace custom logger with pino
  - JSON format, request tracing

- [ ] **T6.8** Docker Compose update
  - Waktu: 3 jam
  - Services: app, postgres, redis (optional)
  - Fix permissions (no more chmod 777)
  - Health check in compose

- [ ] **T6.9** Production deployment checklist
  - Waktu: 2 jam
  - Document: env vars, secrets, domains, SSL, backup schedule
  - Runbook for common operations

- [ ] **T6.10** Final security review
  - Waktu: 2 jam
  - Re-run audit checklist dari `08_SECURITY_CHECKLIST.md`
  - Fix any remaining issues

**Sprint 6 Total Effort: ~29 jam**

---

## Total Effort Summary

| Sprint | Focus | Est. Hours |
|--------|-------|:---:|
| 1 | Security Hardening & Cleanup | 16 |
| 2 | Adapter Pattern & Refactor | 29 |
| 3 | WhatsApp Cloud API | 25 |
| 4 | Compliance & Policy Guard | 25 |
| 5 | Frontend & DB Migration | 33 |
| 6 | Testing & CI/CD | 29 |
| **Total** | | **~157 jam** |

**Estimasi durasi:** Dengan 1 developer full-time (6-8 jam/hari), ~20-26 hari kerja = **5-6 minggu**. Dengan part-time (~3-4 jam/hari), ~8-12 minggu.

---

## Dependencies & Blockers

| Task | Blocked By | Note |
|------|-----------|------|
| T3.1-T3.8 | Meta Business verification | Bisa 1-4 minggu |
| T3.5 | Meta template approval | Bisa 1-7 hari |
| T5.7 | PostgreSQL instance available | Setup Supabase/Neon gratis |
| T6.6 | GitHub repo accessible | Sudah public |

---

## Acceptance Criteria Dokumen Task Breakdown

- [x] Setiap sprint memiliki scope yang jelas
- [x] Setiap task memiliki estimasi waktu
- [x] File yang dimodifikasi/dibuat teridentifikasi
- [x] Dependencies dan blockers terdokumentasi
- [x] Total effort summary tersedia
