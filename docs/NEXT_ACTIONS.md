# NEXT_ACTIONS — Sprint 1 Stabilization Changelog

> **Tanggal:** 2026-05-29
> **Branch:** `stabilization/docs-and-architecture`
> **Commit:** `fix: add safety guards and dashboard security hardening`

---

## Perubahan yang Dilakukan

### 1. Follow-Up Scheduler Disabled ✅
- **File:** `src/services/dashboard_service.js`
- `initFollowUpScheduler(io)` sudah di-comment out dengan alasan jelas.
- Startup log warning ditambahkan:
  `⚠️ Automatic follow-up scheduler is DISABLED for safety until compliance layer is ready.`
- Follow-up manual (jika ada endpoint) tidak terdampak.

### 2. Opt-Out Detection ✅
- **File:** `src/events/message_handler.js`
- Keyword: `stop`, `berhenti`, `jangan chat lagi`, `jangan hubungi saya`, `unsubscribe`, `tidak mau`, `nggak mau`, `ga mau`, `gak mau`, `jangan kirim pesan`, `jangan ganggu`
- Jika terdeteksi: bot dipause untuk kontak, balasan sopan dikirim 1x, AI berhenti.
- Balasan bot di-track ID-nya agar tidak re-trigger AI.

### 3. Human Escalation Keywords ✅
- **File:** `src/events/message_handler.js`
- Keyword: `komplain`, `kecewa`, `marah`, `penipuan`, `refund`, `salah kirim`, `admin manusia`, `cs manusia`, `mau bicara admin`, `bicara orang`, `minta admin`, `operator manusia`
- Jika terdeteksi: bot dipause, balasan singkat dikirim, CS bisa lanjut manual.

### 4. Session Secret Hardened ✅
- **File:** `src/config.js`, `src/services/dashboard_service.js`
- `SESSION_SECRET` sekarang dibaca dari env melalui config.
- Jika `NODE_ENV=production` dan `SESSION_SECRET` kosong atau masih default → **server gagal start** (fail-fast).
- Di development, fallback digunakan dengan warning log.
- Hardcoded secret `'rekapoin-crm-xyz-secret-2025'` sudah dihapus dari dashboard_service.js.

### 5. Socket.IO CORS Restricted ✅
- **File:** `src/config.js`, `src/services/dashboard_service.js`
- `origin: '*'` diganti dengan `DASHBOARD_ALLOWED_ORIGINS` dari env.
- Default development: `http://localhost:3001, http://127.0.0.1:3001`.
- Socket.IO sekarang juga set `credentials: true` untuk cookie session.

### 6. Helmet Security Headers ✅
- **File:** `src/services/dashboard_service.js`
- **Dependency baru:** `helmet` (sudah di-install, tercatat di package.json)
- CSP di-disable agar inline scripts di dashboard HTML tidak rusak.
- `crossOriginEmbedderPolicy` di-disable agar Socket.IO dan media embed tetap berfungsi.

### 7. Health Endpoint ✅
- **File:** `src/services/dashboard_service.js`
- `GET /api/health` — tidak memerlukan autentikasi.
- Response: `{ success, status, service, time, uptime }`.
- Tidak membocorkan secret, API key, path, atau data sensitif.

### 8. .env.example ✅
- **File baru:** `.env.example`
- Berisi semua environment variables yang dibutuhkan.
- Aman untuk di-commit ke git.

---

## File yang Diubah

| File | Tipe | Perubahan |
|------|------|-----------|
| `src/config.js` | MODIFY | Tambah `SESSION_SECRET`, `DASHBOARD_ALLOWED_ORIGINS`, validasi production |
| `src/services/dashboard_service.js` | MODIFY | Helmet, CORS, session secret, follow-up warning, health endpoint |
| `src/events/message_handler.js` | MODIFY | Opt-out detection, human escalation, safety reply tracking |
| `.env.example` | NEW | Template environment variables |
| `package.json` | MODIFY | Tambah dependency `helmet` |
| `package-lock.json` | MODIFY | Lock file update |
| `docs/NEXT_ACTIONS.md` | NEW | Dokumentasi perubahan |

---

## Cara Test Manual

1. **Start server:**
   ```bash
   npm start
   ```
   Pastikan muncul log:
   - `[FollowUp] ⚠️ Automatic follow-up scheduler is DISABLED...`
   - `[Socket.IO] CORS allowed origins: http://localhost:3001, ...`
   - Jika tanpa SESSION_SECRET: `[Security] SESSION_SECRET tidak di-set...`

2. **Health endpoint:**
   ```bash
   curl http://localhost:3001/api/health
   ```
   Expected: `{"success":true,"status":"ok","service":"wa-ai-cs",...}`

3. **Security headers:**
   ```bash
   curl -I http://localhost:3001/api/health
   ```
   Expected: Ada header `X-Content-Type-Options`, `X-Frame-Options`, dll.

4. **Opt-out:** Kirim "stop" dari nomor customer → bot harus pause, balas 1x sopan.

5. **Eskalasi:** Kirim "saya kecewa" dari customer → bot pause, balas pendek.

6. **Production fail-fast:**
   ```bash
   NODE_ENV=production node index.js
   ```
   Tanpa SESSION_SECRET → server harus gagal start.

---

## Risiko Tersisa

| # | Risiko | Severity | Catatan |
|---|--------|----------|---------|
| 1 | Password admin masih plaintext compare | P1 | Belum di-hash bcrypt — scope Sprint 2 |
| 2 | CSRF protection belum ada | P1 | Scope Sprint 2 |
| 3 | Socket.IO belum auth per-session | P1 | Siapapun bisa connect jika tau URL — Sprint 2 |
| 4 | File upload MIME validation (magic bytes) | P2 | Hanya validasi extension — Sprint 2 |
| 5 | WWebJS masih digunakan | P0 | Risiko banned tetap ada — mitigasi via Cloud API di Sprint 3 |
| 6 | Opt-out hanya in-memory + pause table | P2 | Belum ada consent registry formal — Sprint 4 |

---

## Next Sprint Preview

Sprint 2 yang direkomendasikan:
- [ ] Password hashing (bcrypt)
- [ ] CSRF protection
- [ ] Socket.IO session authentication
- [ ] File upload MIME validation (magic bytes)
- [ ] Adapter pattern (decouple WWebJS)
- [ ] Structured logging (pino)