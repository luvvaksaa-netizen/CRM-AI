# 00 — AUDIT REPORT: WA-AI-CS CRM

> **Status Dokumen:** Draft v1.0 | **Tanggal:** 2026-05-29
> **Auditor:** Principal PM / Senior Architect / Security Reviewer
> **Scope:** Full repository audit — arsitektur, keamanan, compliance, scalability, maintainability

---

## Ringkasan Eksekutif

Proyek WA-AI-CS adalah CRM-AI WhatsApp Customer Service yang sudah berjalan ~1 bulan sebagai aplikasi eksperimental. Audit ini menemukan **23 temuan kritis (P0)**, **18 temuan tinggi (P1)**, dan **31 temuan sedang (P2)** yang harus ditangani sebelum sistem dapat dianggap production-ready.

**Kondisi kritis saat ini:**
- 2 nomor WhatsApp kantor sudah **TERBANNED**
- 1 nomor sedang **ditinjau/under review**
- Sistem **sepenuhnya bergantung** pada whatsapp-web.js (WWebJS) + WPPConnect WA-JS — dua library yang melanggar WhatsApp Terms of Service
- **API keys terekspos** di file `.env` (meskipun belum ter-commit ke git)
- **Database backups (SQLite snapshots) tersimpan di repo** — berisi data pelanggan
- **Executable biner (cloudflared.exe, 62MB)** ada di root repo
- Frontend adalah **monolith HTML tunggal 183KB / 3.289 baris** — unmaintainable

**Rekomendasi utama:** Migrasi incremental ke WhatsApp Business Platform resmi (Cloud API) sebagai fondasi channel adapter, dengan arsitektur domain-driven yang terpisah.

---

## 1. WHATSAPP ENGINE & RISIKO BANNED [P0]

### 1.1 Temuan Kritis

| # | Temuan | Severity | File |
|---|--------|----------|------|
| 1 | **WWebJS menggunakan Puppeteer/Chromium headless** untuk mengotomasi WhatsApp Web — ini secara eksplisit **melanggar WhatsApp ToS Section 4** | P0 | `src/whatsapp_service.js` |
| 2 | **WPPConnect WA-JS diinjeksi langsung ke halaman WA Web** via `window.eval(code)` — teknik reverse-engineering yang sangat agresif | P0 | `src/services/wajs_bridge.js:48-52` |
| 3 | **Setiap Store/nomor WA = 1 instance Chromium browser** — resource-intensive dan mudah terdeteksi sebagai automation | P0 | `src/whatsapp_service.js:228-255` |
| 4 | **Health check + auto-restart browser** setiap 10 menit — pola ini memperkuat fingerprint bot | P0 | `src/whatsapp_service.js:764-798` |
| 5 | **Follow-up otomatis 4 tahap tanpa opt-in** — bisa dianggap spam oleh WhatsApp | P0 | `src/services/followup_service.js` |
| 6 | **Template follow-up hardcoded dengan pola identik** — mudah terdeteksi sebagai template spam oleh ML anti-spam WhatsApp | P0 | `src/services/followup_service.js:25-72` |
| 7 | **Label management via WA-JS injection** (create/edit/delete/addOrRemove) — fungsi yang seharusnya hanya tersedia via WhatsApp Business API | P1 | `src/services/wajs_bridge.js:254-383` |
| 8 | **Auto-inject media "ghost media prevention"** — bot mengirim media tanpa kontrol pengguna | P1 | `src/ai_service.js:74-124` |

### 1.2 Analisis Root Cause Banned

**Mengapa nomor-nomor terbanned:**

1. **Automation Detection:** WhatsApp memiliki ML classifier yang mendeteksi pola headless browser (user-agent, timing pattern, lack of human interaction signals)
2. **Outbound Spam Pattern:** Follow-up otomatis ke banyak kontak tanpa opt-in = broadcast spam behavior
3. **WA-JS Injection:** WhatsApp secara aktif mendeteksi dan memblokir injeksi kode pihak ketiga ke halaman web mereka
4. **No Message Template Approval:** Pesan outbound dikirim tanpa melalui sistem template WhatsApp resmi
5. **No 24-Hour Window Compliance:** Tidak ada mekanisme yang menghormati 24-hour customer service window
6. **Unnatural Messaging Patterns:** Typing delay artificial, bubble splitting, media scheduling — semua terdeteksi karena bukan perilaku manusia organik

### 1.3 Rekomendasi

- **SEGERA:** Hentikan semua follow-up otomatis sampai migrasi ke WhatsApp Cloud API selesai
- **JANGKA PENDEK:** Implementasi adapter pattern — abstract WhatsApp engine di balik interface agar mudah swap ke Cloud API
- **JANGKA MENENGAH:** Daftar sebagai WhatsApp Business Solution Provider atau gunakan BSP resmi (Twilio, MessageBird, WATI, dll)
- **JANGKA PANJANG:** WWebJS/WA-JS hanya sebagai development/testing adapter, TIDAK untuk production

---

## 2. AUTH / SESSION / SECURITY [P0]

### 2.1 Temuan Kritis

| # | Temuan | Severity | File |
|---|--------|----------|------|
| 9 | **Password disimpan plaintext** di env (`ADMIN_PASS=KirimFotoSecure99!`) dan di-compare langsung tanpa hashing | P0 | `src/services/dashboard_service.js:197`, `src/config.js:60` |
| 10 | **Session secret hardcoded** (`rekapoin-crm-xyz-secret-2025`) — bisa diprediksi | P0 | `src/services/dashboard_service.js:155` |
| 11 | **CORS origin = '*'** pada Socket.IO — memungkinkan koneksi dari domain manapun | P0 | `src/services/dashboard_service.js:255` |
| 12 | **Tidak ada CSRF protection** pada form login dan API mutating | P0 | Seluruh dashboard_service.js |
| 13 | **Tidak ada helmet/security headers** — rentan terhadap XSS, clickjacking, MIME sniffing | P1 | dashboard_service.js |
| 14 | **File upload tanpa validasi konten** — hanya cek ekstensi, tidak validasi MIME type sebenarnya | P1 | `src/services/dashboard_service.js:242-249` |
| 15 | **API key Groq x3 dan OpenAI x1 terekspos di `.env`** — meskipun gitignored, file `.env` ada di working directory dan bisa ter-leak | P0 | `.env` |
| 16 | **`settings.json` berisi data bisnis** (system prompt, product knowledge, pricing) dan ter-track di git | P1 | `settings.json` |
| 17 | **Socket.IO tidak ada autentikasi** — siapapun yang tahu URL bisa listen semua event real-time | P0 | dashboard_service.js |

### 2.2 Rekomendasi

- Implementasi password hashing (bcrypt/argon2)
- Generate session secret secara random dari environment
- Tambahkan Socket.IO middleware autentikasi
- Implementasi CSRF token (csurf/double-submit cookie)
- Tambahkan helmet.js untuk security headers
- Validasi MIME type file upload dengan magic bytes
- Restrict CORS ke domain yang diizinkan

---

## 3. DATABASE SCHEMA & MIGRASI [P1]

### 3.1 Temuan

| # | Temuan | Severity | File |
|---|--------|----------|------|
| 18 | **SQLite untuk production** — tidak mendukung concurrent writes dengan baik, tidak ada connection pooling | P1 | `src/database/index.js:7-11` |
| 19 | **Migrasi database manual** menggunakan `safeAddColumn` satu per satu — tidak ada versioning, tidak bisa rollback | P1 | `src/database/index.js:286-356` |
| 20 | **`backfillContactIdentity()` memuat SEMUA ChatMessage** (`findAll()` tanpa limit) saat startup — O(n) memory | P0 | `src/database/index.js:211` |
| 21 | **Tidak ada index** pada kolom yang sering di-query (`contact_id`, `store_wa_id`, `wa_message_id`, `timestamp`) | P1 | database/index.js |
| 22 | **Duplikat `safeAddColumn` untuk `wa_labels`** — dipanggil 2x di line 318 dan 339 | P2 | `src/database/index.js:318,339` |
| 23 | **Legacy columns di Store model** (`connection_mode`, `roketchat_*`) — dead code yang membingungkan | P2 | `src/database/index.js:38-41` |
| 24 | **Database SQLite file di root repo** (`database.sqlite`, 110KB) — kemungkinan data test/development yang ter-commit | P1 | root directory |
| 25 | **Backups directory berisi 9 SQLite snapshots** (total ~1.8MB) — data pelanggan potensial di repo public | P0 | `backups/` |

### 3.2 Rekomendasi

- Migrasi ke PostgreSQL untuk production (Supabase/Neon gratis untuk start)
- Implementasi migration framework (Sequelize CLI / Umzug)
- Tambahkan database indexes pada kolom pencarian utama
- Hapus database files dan backups dari repo, tambahkan ke .gitignore
- Batch processing untuk backfill operations

---

## 4. AI PROMPT ARCHITECTURE [P1]

### 4.1 Temuan

| # | Temuan | Severity | File |
|---|--------|----------|------|
| 26 | **System prompt ~2000+ kata** dikirim setiap request — token-intensive dan mahal | P1 | `src/ai_service.js:264-476` |
| 27 | **Dual system message** (fullSystemInstruction + draconianRules) — bisa membingungkan model | P2 | `src/ai_service.js:479-503` |
| 28 | **Hardcoded business logic di prompt** ("bunda/bun", harga promo 37rb, bank Mandiri) — tidak configurable per-tenant | P1 | ai_service.js dan settings.json |
| 29 | **Model fallback chain** (Groq Llama → OpenAI GPT-4o-mini) tanpa perbedaan prompt optimization per model | P2 | ai_service.js |
| 30 | **Concurrency limiter** di-set ke MAX_CONCURRENCY=10 tapi comment bilang "3 proses serentak" — inconsistency | P2 | `src/ai_service.js:163-164` |
| 31 | **Tool definition `cek_ongkir` hardcoded** ke "dari Kediri" — tidak configurable per-store | P1 | `src/ai_service.js:353` |
| 32 | **Summary generation menggunakan model berbeda** (llama-3.1-8b-instant) tanpa alignment dengan model utama | P2 | `src/ai_service.js:755` |

### 4.2 Rekomendasi

- Pisahkan prompt menjadi: base personality, product knowledge, business rules, tools definition
- Buat prompt configurable per-agent/per-store dari database
- Implementasi prompt versioning untuk A/B testing
- Optimasi token usage dengan context windowing yang lebih cerdas

---

## 5. MESSAGE PIPELINE [P1]

### 5.1 Temuan

| # | Temuan | Severity | File |
|---|--------|----------|------|
| 33 | **Message handler monolith** — 1.075 baris dalam 1 file, menangani debounce, AI, media, labels, summary, follow-up | P1 | `src/events/message_handler.js` |
| 34 | **Circular dependency** antara `message_handler.js` ↔ `whatsapp_service.js` ↔ `dashboard_service.js` | P1 | Multiple files |
| 35 | **`require()` di dalam fungsi** (lazy loading) — anti-pattern yang mempersulit dependency tracking | P2 | Seluruh codebase |
| 36 | **In-memory sets** (`processedIncomingMsgIds`, `botSentMessageIds`, `pausedContacts`) — hilang saat restart, potensi duplicate messages | P1 | Multiple files |
| 37 | **Race condition di `_processAIReply`** — `while(activeAIReplies.has(replyKey))` loop + sleep tanpa proper mutex | P1 | `message_handler.js:492-501` |
| 38 | **`identity` digunakan sebelum didefinisikan** di line 292, tapi deklarasi di line 338 | P0 | `message_handler.js:292,338` |

### 5.2 Rekomendasi

- Decompose message handler menjadi pipeline steps (Receive → Validate → Enrich → Process → Respond → Log)
- Gunakan event emitter atau message queue untuk decouple komponen
- Implementasi proper mutex/semaphore untuk concurrent access
- Pindahkan in-memory state ke Redis atau persistent store

---

## 6. FOLLOW-UP & OUTBOUND COMPLIANCE [P0]

### 6.1 Temuan

| # | Temuan | Severity | File |
|---|--------|----------|------|
| 39 | **Tidak ada mekanisme opt-in/opt-out** — customer tidak bisa memilih untuk tidak menerima follow-up | P0 | followup_service.js |
| 40 | **Tidak ada 24-hour customer service window enforcement** — pesan bisa dikirim kapan saja | P0 | followup_service.js |
| 41 | **Follow-up stage 3 dan 4** dijadwalkan ke jam 19:00 dan 06:00 — bisa mengganggu customer di luar jam kerja | P1 | `followup_service.js:48-71` |
| 42 | **Tidak ada rate limiting per-customer** — customer bisa menerima 4 follow-up dalam 24 jam | P1 | followup_service.js |
| 43 | **Template follow-up tidak melalui approval process** (WhatsApp Cloud API requirement) | P0 | followup_service.js |

### 6.2 Rekomendasi

- Implementasi opt-in registry dan unsubscribe command ("STOP")
- Enforce 24-hour service window (hanya bisa proactive message via approved templates)
- Implementasi rate limiting: max 1 follow-up per 24 jam per customer
- Migrasi template ke WhatsApp Message Templates (memerlukan approval Meta)

---

## 7. DASHBOARD UI/UX [P2]

### 7.1 Temuan

| # | Temuan | Severity | File |
|---|--------|----------|------|
| 44 | **Monolith HTML file** — 3.289 baris, 183KB, inline CSS + JS + HTML | P1 | `public/index.html` |
| 45 | **Login page terpisah** — duplikasi styling tanpa shared design system | P2 | `public/login.html` |
| 46 | **Tidak ada SPA framework** — semua state management manual via DOM manipulation | P2 | index.html |
| 47 | **Socket.IO event handling inline** — tidak ada state management yang terstruktur | P2 | index.html |
| 48 | **Tidak ada lazy loading** untuk chat history — semua dimuat sekaligus | P2 | index.html |
| 49 | **`patch_html.js`** (10KB) — script untuk memodifikasi HTML secara programatik, indicator of "spaghetti development" | P2 | `scripts/patch_html.js` |

### 7.2 Rekomendasi

- Rewrite frontend menggunakan React/Next.js atau Vue/Nuxt
- Implementasi component-based architecture
- State management dengan Zustand/Pinia
- API client layer yang terpisah dari UI logic

---

## 8. REPO HYGIENE [P1]

### 8.1 Temuan

| # | Temuan | Severity | File |
|---|--------|----------|------|
| 50 | **`cloudflared.exe` (62MB)** ada di root repo — binary executable tidak boleh di-commit | P0 | `cloudflared.exe` |
| 51 | **`database.sqlite` (110KB)** di root repo — database file | P1 | root |
| 52 | **`backups/` directory** berisi 9 SQLite snapshots — data production | P0 | `backups/` |
| 53 | **15+ file debug/test** di root (`debug_*.js`, `test_*.js`, `update_*.js`, `extract_*.js`, `check_*.js`) | P2 | root |
| 54 | **`settings.json`** dan `komerce_cache.json` di root — configuration leak | P1 | root |
| 55 | **`.wwebjs_auth/` dan `.wwebjs_cache/`** — WhatsApp session data directories (gitignored tapi ada di working directory) | P2 | root |
| 56 | **`chat_history.json` (14KB)** — riwayat chat terekspos (gitignored tapi terlihat di dir listing) | P1 | root |
| 57 | **Video file (10MB)** di docs — `WhatsApp Video 2026-05-25 at 22.07.59.mp4` | P2 | `docs/` |
| 58 | **`.gitignore` tidak mencakup** `cloudflared.exe`, `backups/`, `*.sqlite` di root, `settings.json` | P0 | `.gitignore` |
| 59 | **`install_and_run.bat`** — Windows batch script yang mungkin berisi path/config lokal | P2 | root |
| 60 | **`mengantar_endpoints.txt` dan `mengantar_paths.txt`** — API endpoint dumps yang seharusnya tidak di-commit | P2 | root |

### 8.2 Rekomendasi

- Tambahkan ke `.gitignore`: `*.exe`, `backups/`, `*.sqlite`, `settings.json`, `*.mp4`, `scratch/`, `tmp/`
- Gunakan `git rm --cached` untuk menghapus file yang sudah ter-track
- Pindahkan semua debug scripts ke `scripts/debug/` dan gitignore
- Gunakan BFG Repo Cleaner jika ada history sensitive data

---

## 9. DEPLOYMENT & OBSERVABILITY [P1]

### 9.1 Temuan

| # | Temuan | Severity | File |
|---|--------|----------|------|
| 61 | **Dockerfile eksposes port 3000** tapi `.env` menggunakan port 3001 | P2 | `Dockerfile:42` vs `.env:11` |
| 62 | **Tidak ada health check endpoint** — hanya internal health check untuk WA client | P1 | - |
| 63 | **Log files di repo** (`logs/` directory, 10MB+) — seharusnya gitignored | P1 | `logs/` |
| 64 | **Tidak ada structured logging** (JSON) — log hanya console output dengan custom colors | P2 | `src/utils/logger.js` |
| 65 | **Tidak ada APM/tracing** — sulit debug production issues | P2 | - |
| 66 | **Tidak ada graceful shutdown handler untuk Express** — hanya SIGINT untuk WA clients | P1 | `index.js:94-107` |
| 67 | **`chmod -R 777`** di Dockerfile — security anti-pattern | P1 | `Dockerfile:39` |

### 9.2 Rekomendasi

- Tambahkan `/api/health` endpoint
- Implementasi structured logging (pino/winston JSON format)
- Tambahkan graceful shutdown untuk Express + DB
- Fix Dockerfile permissions (use specific user, not 777)
- Implementasi log rotation dan centralized logging

---

## 10. TESTING [P1]

### 10.1 Temuan

| # | Temuan | Severity | File |
|---|--------|----------|------|
| 68 | **Test coverage: ~0%** — hanya ada 2 test files (735 bytes + 10KB), keduanya manual/eval scripts | P1 | `tests/` |
| 69 | **`test_full_system.js` (22KB)** di root — integration test yang bukan proper test suite | P2 | root |
| 70 | **Tidak ada CI/CD pipeline** — tidak ada GitHub Actions, no automated testing | P1 | - |
| 71 | **Tidak ada test untuk message pipeline** — komponen paling kritis tanpa test | P1 | - |

### 10.2 Rekomendasi

- Setup Jest/Vitest sebagai test framework
- Prioritaskan unit test untuk: AI service, message handler, follow-up service
- Implementasi integration test untuk message pipeline
- Setup GitHub Actions untuk CI (lint + test)

---

## Matriks Risiko

| Kategori | P0 (Critical) | P1 (High) | P2 (Medium) |
|----------|:---:|:---:|:---:|
| WhatsApp Engine | 6 | 2 | 0 |
| Auth/Security | 5 | 3 | 0 |
| Database | 2 | 3 | 2 |
| AI Prompt | 0 | 3 | 4 |
| Message Pipeline | 1 | 3 | 2 |
| Compliance | 3 | 2 | 0 |
| UI/UX | 0 | 1 | 5 |
| Repo Hygiene | 3 | 3 | 5 |
| Deployment | 0 | 3 | 3 |
| Testing | 0 | 3 | 1 |
| **TOTAL** | **20** | **26** | **22** |

---

## Acceptance Criteria untuk Audit

- [x] Seluruh source code direview
- [x] Semua file konfigurasi dan environment diaudit
- [x] Git history diperiksa untuk secret leaks
- [x] Dependency tree dievaluasi
- [x] Database schema dianalisis
- [x] Security posture di-assess
- [x] Compliance gap diidentifikasi
- [x] Matriks risiko dibuat dengan prioritas

---

## Next Steps

1. **Immediate (Hari ini):** Rotate semua API keys yang terekspos di `.env`, update `.gitignore`
2. **Sprint 1 (Minggu 1-2):** Fix security P0 (password hashing, session, CORS, Socket.IO auth)
3. **Sprint 2 (Minggu 3-4):** Implementasi adapter pattern untuk WhatsApp engine
4. **Sprint 3 (Minggu 5-6):** Daftar WhatsApp Business Platform, mulai migrasi
5. **Sprint 4-6 (Minggu 7-12):** Rewrite frontend, database migration, testing

Lihat `05_TASK_BREAKDOWN.md` untuk detail implementasi per sprint.
