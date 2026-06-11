# 01 — Setup & Konfigurasi

> **Cara instalasi, konfigurasi, dan menjalankan V2-Core dari awal.**

---

## Prasyarat

| Requirement | Versi Minimal | Cek |
|-------------|--------------|-----|
| Node.js | 18.x+ | `node --version` |
| npm | 9.x+ | `npm --version` |
| Database | SQLite (built-in) | File `.sqlite` akan dibuat otomatis |

---

## 1. Clone & Install

```bash
# Backend
cd D:\CRM-AI\v2-core\backend
npm install

# Frontend
cd D:\CRM-AI\v2-core\frontend
npm install
```

## 2. Konfigurasi Environment

Buat file `.env` di `backend/` (copy dari `.env.example`):

```env
# ====== Server ======
PORT=3002
NODE_ENV=development
CORS_ORIGINS=http://localhost:5173

# ====== Database ======
DB_PATH=data/database.sqlite

# ====== Auth ======
JWT_SECRET=ubah_ke_string_acak_kuat
SESSION_SECRET=ubah_juga_ini
ADMIN_USER=admin
ADMIN_PASS=admin123

# ====== Optional: Multi-user ======
# ADMIN_USERS_JSON=[{"user":"operator1","pass":"pass123","role":"operator"},{"user":"viewer1","pass":"pass456","role":"viewer"}]

# ====== AI / LLM ======
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk-...
AI_MODEL=groq
AI_GROQ_MODEL=llama-3.3-70b-versatile

# ====== WhatsApp ======
# Default: wwebjs. Alternatif: roketchat
WHATSAPP_MODE=wwebjs
```

### Penjelasan Variabel

| Variabel | Wajib | Default | Fungsi |
|----------|-------|---------|--------|
| `PORT` | Tidak | 3002 | Port backend |
| `CORS_ORIGINS` | Ya | localhost:5173 | Domain yang diizinkan CORS |
| `JWT_SECRET` | Ya | - | Secret key JWT token |
| `ADMIN_USER` | Ya | admin | Username admin default |
| `ADMIN_PASS` | Ya | admin123 | Password admin (seed otomatis) |
| `OPENAI_API_KEY` | Tidak | - | API key OpenAI (untuk AI) |
| `GROQ_API_KEY` | Tidak | - | API key Groq (alternatif) |
| `AI_MODEL` | Tidak | groq | Pilihan model: 'groq' atau 'openai' |
| `DB_PATH` | Tidak | data/database.sqlite | Path file database |

## 3. Jalankan Development

```bash
# Terminal 1 — Backend (port 3002, auto-reload)
cd D:\CRM-AI\v2-core\backend
npm run dev

# Terminal 2 — Frontend (port 5173, HMR)
cd D:\CRM-AI\v2-core\frontend
npm run dev
```

### Cek Status

```bash
# Health check backend
curl http://localhost:3002/health

# Response sukses:
# {"status":"ok","version":"2.0.0","database":"connected"}
```

## 4. Login

Buka `http://localhost:5173/login` di browser.

**Credential default:**
| Username | Password | Role |
|----------|----------|------|
| `admin` | `admin123` | Admin (full access) |

> ⚠️ **Wajib ganti password default** sebelum production!

## 5. Build Production

```bash
# Backend
cd D:\CRM-AI\v2-core\backend
npm run build           # tsc -> dist/

# Frontend
cd D:\CRM-AI\v2-core\frontend
npm run build           # vite build
```

### Start Production

```bash
cd D:\CRM-AI\v2-core\backend
npm run start:prod      # node dist/app.js
```

## 6. Struktur File Penting

| Path | Fungsi |
|------|--------|
| `backend/.env` | Environment variables (JANGAN di-commit) |
| `backend/data/database.sqlite` | Database SQLite (auto-create) |
| `backend/data/uploads/` | File upload (gambar, video) |
| `backend/.wwebjs_auth/` | WhatsApp session storage |
| `backend/logs/` | Log file |

## 7. Database

V2-Core menggunakan **SQLite** via Sequelize ORM.

- File database: `backend/data/database.sqlite`
- WAL mode aktif (Write-Ahead Logging)
- Pool size: 1 koneksi (SQLite hanya support 1 writer)
- Auto-sync: tabel dibuat otomatis saat pertama jalan
- **TIDAK** menggunakan `force: true` — aman untuk data produksi

## 8. Credential Multi-User

Untuk menambah user selain admin, set environment variable:

```env
ADMIN_USERS_JSON=[{"user":"operator1","pass":"pass123","role":"operator"},{"user":"viewer1","pass":"pass456","role":"viewer"}]
```

Role yang tersedia: `admin`, `operator`, `viewer`.
