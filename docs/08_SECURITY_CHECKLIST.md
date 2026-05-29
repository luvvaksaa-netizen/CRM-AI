# 08 — Security & Compliance Checklist

> **Versi:** 1.0 | **Tanggal:** 2026-05-29

---

## Cara Menggunakan Dokumen Ini

Checklist ini harus di-review pada setiap milestone/sprint. Tandai item dengan:
- ✅ Sudah diimplementasi dan diverifikasi
- ⚠️ Partially implemented
- ❌ Belum diimplementasi
- N/A Tidak berlaku

---

## 1. Authentication & Session Security

| # | Item | Status | Sprint | File/Notes |
|---|------|--------|--------|-----------|
| 1.1 | Password di-hash dengan bcrypt (cost ≥ 12) atau argon2 | ❌ | 1 | `dashboard_service.js:197` — saat ini plaintext compare |
| 1.2 | Session secret dari environment variable (random, ≥ 32 chars) | ❌ | 1 | `dashboard_service.js:155` — hardcoded |
| 1.3 | Cookie flags: HttpOnly, Secure (production), SameSite=Strict | ⚠️ | 1 | HttpOnly ✅, Secure ⚠️ (hanya prod), SameSite ❌ |
| 1.4 | Session regeneration setelah login | ❌ | 1 | Prevent session fixation |
| 1.5 | Session expiry < 24 jam | ✅ | - | 24 jam sudah di-set |
| 1.6 | Logout menghapus session dari store | ✅ | - | `session.destroy()` ✅ |
| 1.7 | Brute force protection (rate limiting login) | ✅ | - | 12 attempts / 15 min ✅ |
| 1.8 | Account lockout setelah N kali gagal | ❌ | 2 | Belum ada |
| 1.9 | Password complexity requirements | ❌ | 2 | Belum ada validation |

---

## 2. API Security

| # | Item | Status | Sprint | File/Notes |
|---|------|--------|--------|-----------|
| 2.1 | CSRF protection pada semua mutating endpoints | ❌ | 1 | Tidak ada CSRF token |
| 2.2 | CORS restricted ke allowed origins | ❌ | 1 | Socket.IO `origin: '*'` |
| 2.3 | Helmet.js security headers | ❌ | 1 | Tidak ada security headers |
| 2.4 | Content-Type validation pada API requests | ⚠️ | 1 | Hanya express.json() |
| 2.5 | Input validation/sanitization | ❌ | 2 | Tidak ada joi/zod validation |
| 2.6 | SQL injection prevention (parameterized queries) | ✅ | - | Sequelize parameterized ✅ |
| 2.7 | Rate limiting pada API endpoints | ⚠️ | 1 | Hanya login + manual send |
| 2.8 | API versioning (v1/) | ❌ | 3 | Belum ada |
| 2.9 | Error messages tidak expose internal details | ⚠️ | 1 | Beberapa `e.message` langsung |

---

## 3. Socket.IO / WebSocket Security

| # | Item | Status | Sprint | File/Notes |
|---|------|--------|--------|-----------|
| 3.1 | Session authentication sebelum connect | ❌ | 1 | Siapapun bisa connect |
| 3.2 | Room-based events (bukan global broadcast) | ❌ | 2 | Semua events broadcast |
| 3.3 | Connection rate limiting | ❌ | 2 | Tidak ada |
| 3.4 | Input validation pada client→server events | ❌ | 2 | Tidak ada |
| 3.5 | Reconnection limit | ❌ | 2 | Tidak ada |

---

## 4. Data Protection

| # | Item | Status | Sprint | File/Notes |
|---|------|--------|--------|-----------|
| 4.1 | API keys TIDAK ada di git history | ✅ | - | `.env` never committed |
| 4.2 | `.env` di `.gitignore` | ✅ | - | ✅ |
| 4.3 | Database files TIDAK di repo | ❌ | 1 | `database.sqlite` ada di root |
| 4.4 | Backup files TIDAK di repo | ❌ | 1 | `backups/` ada di repo |
| 4.5 | Binary files TIDAK di repo | ❌ | 1 | `cloudflared.exe` 62MB |
| 4.6 | Log files TIDAK di repo | ❌ | 1 | `logs/` ada |
| 4.7 | Settings/config TIDAK di repo | ❌ | 1 | `settings.json` tracked |
| 4.8 | Encryption at rest (database) | ❌ | 3 | SQLite tidak encrypted |
| 4.9 | Encryption in transit (HTTPS) | ⚠️ | - | Tergantung reverse proxy |
| 4.10 | PII minimization | ❌ | 4 | Chat history full plaintext |
| 4.11 | Data retention policy enforcement | ❌ | 4 | Tidak ada auto-cleanup |
| 4.12 | Sensitive fields encrypted (API keys in DB) | ❌ | 3 | Jika Cloud API token di DB |

---

## 5. File Upload Security

| # | Item | Status | Sprint | File/Notes |
|---|------|--------|--------|-----------|
| 5.1 | Ekstensi file divalidasi | ✅ | - | Regex ALLOWED_TYPES |
| 5.2 | MIME type divalidasi (magic bytes) | ❌ | 1 | Hanya cek extension |
| 5.3 | File size limit | ✅ | - | 100MB |
| 5.4 | Filename sanitization | ✅ | - | Random name generated |
| 5.5 | Uploaded files disimpan di luar webroot | ✅ | - | UPLOADS_DIR |
| 5.6 | Anti-virus scanning | ❌ | 6 | Opsional |
| 5.7 | Access control pada files | ✅ | - | `/uploads` behind auth |

---

## 6. WhatsApp Compliance (Business Policy)

| # | Item | Status | Sprint | File/Notes |
|---|------|--------|--------|-----------|
| 6.1 | Menggunakan API resmi (Cloud API / BSP) | ❌ | 3 | Masih WWebJS |
| 6.2 | Message templates approved oleh Meta | ❌ | 3 | Tidak ada template system |
| 6.3 | 24-hour customer service window dihormati | ❌ | 4 | Tidak ada enforcement |
| 6.4 | Opt-in registry sebelum outbound messaging | ❌ | 4 | Tidak ada consent tracking |
| 6.5 | Opt-out mechanism ("STOP" command) | ❌ | 4 | Tidak ada |
| 6.6 | No broadcast tanpa opt-in | ⚠️ | 4 | Follow-up = pseudo-broadcast |
| 6.7 | Human takeover tersedia | ✅ | - | Pause bot per kontak ✅ |
| 6.8 | Audit log untuk setiap outbound message | ❌ | 4 | Hanya chat history |
| 6.9 | Rate limiting outbound per customer | ❌ | 4 | Tidak ada |
| 6.10 | Tidak ada scraping/data mining | ✅ | - | Hanya proses incoming |

---

## 7. Infrastructure Security

| # | Item | Status | Sprint | File/Notes |
|---|------|--------|--------|-----------|
| 7.1 | Node.js LTS version | ✅ | - | Node 20 |
| 7.2 | Dependencies audit clean | ⚠️ | 1 | Belum di-check |
| 7.3 | Docker: non-root user | ❌ | 6 | `chmod -R 777` |
| 7.4 | Docker: minimal image | ❌ | 6 | node:20-bookworm (besar) |
| 7.5 | Secrets management (env vars, not files) | ⚠️ | 1 | API keys di .env file |
| 7.6 | Health check endpoint | ❌ | 1 | Tidak ada |
| 7.7 | Graceful shutdown | ⚠️ | 1 | Hanya WA clients |
| 7.8 | Log rotation | ⚠️ | 6 | File-based, 5MB rotation |
| 7.9 | Backup encryption | ❌ | 6 | SQLite snapshots plaintext |
| 7.10 | Network isolation (DB not public) | ⚠️ | 6 | Tergantung deployment |

---

## 8. Webhook Security (Cloud API)

| # | Item | Status | Sprint | File/Notes |
|---|------|--------|--------|-----------|
| 8.1 | Webhook verification challenge | N/A | 3 | Belum implementasi Cloud API |
| 8.2 | Signature validation (HMAC-SHA256) | N/A | 3 | |
| 8.3 | IP whitelist (optional) | N/A | 3 | Meta IP ranges |
| 8.4 | Webhook URL HTTPS only | N/A | 3 | Requirement dari Meta |
| 8.5 | Idempotency handling (dedup webhook) | N/A | 3 | |
| 8.6 | Webhook timeout handling (< 15s) | N/A | 3 | |

---

## 9. Monitoring & Incident Response

| # | Item | Status | Sprint | File/Notes |
|---|------|--------|--------|-----------|
| 9.1 | Error alerting (email/webhook) | ❌ | 6 | |
| 9.2 | Uptime monitoring | ❌ | 6 | |
| 9.3 | Performance metrics (response times) | ❌ | 6 | |
| 9.4 | Audit trail queryable | ❌ | 4 | |
| 9.5 | Incident response plan documented | ❌ | 6 | |
| 9.6 | Runbook untuk common scenarios | ❌ | 6 | |

---

## 10. Scoring Summary

| Category | Total | ✅ | ⚠️ | ❌ | Score |
|----------|:---:|:---:|:---:|:---:|:---:|
| Authentication | 9 | 3 | 1 | 5 | 33% |
| API Security | 9 | 1 | 3 | 5 | 11% |
| WebSocket | 5 | 0 | 0 | 5 | 0% |
| Data Protection | 12 | 2 | 2 | 8 | 17% |
| File Upload | 7 | 5 | 0 | 2 | 71% |
| WA Compliance | 10 | 2 | 1 | 7 | 20% |
| Infrastructure | 10 | 1 | 4 | 5 | 10% |
| Webhook (N/A) | 6 | 0 | 0 | 0 | N/A |
| Monitoring | 6 | 0 | 0 | 6 | 0% |
| **TOTAL** | **74** | **14** | **11** | **43** | **19%** |

**Current Security Posture: 19% — CRITICAL**

Target: ≥ 80% setelah Sprint 4

---

## Immediate Actions Required

### 🔴 DO NOW (Hari ini)

1. **Rotate semua API keys** — OpenAI dan Groq keys yang ada di `.env`
2. **Update `.gitignore`** — Tambahkan `*.exe`, `backups/`, `*.sqlite`, `settings.json`
3. **Remove tracked sensitive files** — `git rm --cached`

### 🟡 DO THIS SPRINT (Sprint 1)

4. Implementasi password hashing
5. Generate random session secret
6. Restrict CORS
7. Add Socket.IO auth
8. Add helmet.js
9. Add CSRF protection
10. MIME type validation

### 🟢 PLAN FOR NEXT SPRINTS

11. Cloud API webhook security (Sprint 3)
12. Consent management (Sprint 4)
13. Audit logging (Sprint 4)
14. Docker hardening (Sprint 6)

---

## Acceptance Criteria Dokumen Security Checklist

- [x] Semua kategori security ter-cover
- [x] Setiap item memiliki status (✅/⚠️/❌/N/A)
- [x] Sprint target untuk setiap item
- [x] File references untuk items yang sudah ada
- [x] Scoring summary dengan persentase
- [x] Immediate actions terdefinisi
