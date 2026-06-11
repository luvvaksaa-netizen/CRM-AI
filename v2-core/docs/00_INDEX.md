# 📚 Dokumentasi V2-Core — CRM WhatsApp AI

> **Versi:** 2.0.0
> **Terakhir diperbarui:** 2026-06-08
> **Status:** ✅ Production Ready (Phase 6)

---

## Daftar Dokumen

| # | Dokumen | Deskripsi |
|---|---------|-----------|
| 00 | [INDEX.md](./00_INDEX.md) | **Kamu di sini** — daftar isi & arsitektur |
| 01 | [SETUP.md](./01_SETUP.md) | Instalasi, konfigurasi, cara jalanin |
| 02 | [ARCHITECTURE.md](./02_ARCHITECTURE.md) | Arsitektur backend & frontend |
| 03 | [API.md](./03_API.md) | Dokumentasi API endpoint |
| 04 | [DEPLOYMENT.md](./04_DEPLOYMENT.md) | Panduan deployment & rollback |
| 05 | [SECURITY.md](./05_SECURITY.md) | Security checklist & hardening |
| 06 | [AI_ENGINE.md](./06_AI_ENGINE.md) | Konfigurasi AI engine |
| 07 | [SOCKET_EVENTS.md](./07_SOCKET_EVENTS.md) | Semua socket event |
| 08 | [TROUBLESHOOTING.md](./08_TROUBLESHOOTING.md) | Common issues & solusi |
| 09 | [TESTING_CHECKLIST.md](./09_TESTING_CHECKLIST.md) | Regression testing matrix |

---

## Arsitektur Ringkas

```
v2-core/
├── backend/                    # Express + TypeScript + Socket.IO
│   ├── src/
│   │   ├── app.ts              # Entry point, middleware, routes
│   │   ├── config/             # Database, paths, env
│   │   ├── controllers/        # Route handlers
│   │   ├── middlewares/        # Auth middleware (JWT)
│   │   ├── middleware/         # Error handler
│   │   ├── models/             # Sequelize models
│   │   └── services/           # Socket service
│   ├── dist/                   # Compiled JS (production)
│   ├── data/                   # SQLite DB + uploads
│   └── .env                    # Environment variables
├── frontend/                   # React + Vite + TailwindCSS
│   ├── src/
│   │   ├── App.tsx             # Router & global layout
│   │   ├── components/        # Reusable components
│   │   ├── contexts/          # Theme context
│   │   ├── pages/             # Page components (14 pages)
│   │   ├── services/          # API, Socket, Label services
│   │   └── stores/            # Zustand stores (auth)
│   └── dist/                   # Build output
└── docs/                       # Dokumentasi (kamu di sini)
```

## Tech Stack

| Layer | Teknologi |
|-------|-----------|
| Backend Runtime | Node.js + TypeScript + Express 5 |
| Database | SQLite (via Sequelize ORM) |
| Auth | JWT + bcrypt |
| Realtime | Socket.IO (server + client) |
| Frontend | React 19 + Vite + TypeScript |
| Styling | TailwindCSS + Framer Motion |
| Charts | Recharts |
| State | Zustand + Redux |
| WA Engine | whatsapp-web.js (WWebJS) |
| AI | OpenAI SDK + Groq |

## Yang sudah jalan

- ✅ Backend Express + TypeScript dengan JWT auth + rate limiting
- ✅ Frontend React + Vite + TailwindCSS dengan 14 halaman
- ✅ Auth: login/logout, session, role-based (admin/operator/viewer)
- ✅ Dashboard analytics real-time dari database
- ✅ Chat Management: read history, send messages via WhatsApp
- ✅ Follow-up: CRUD + scheduler otomatis
- ✅ Agent AI management (BotAgent CRUD)
- ✅ Store management (WhatsApp device management)
- ✅ Media Gallery: upload, analysis, labels
- ✅ Summaries (rekap percakapan per kontak)
- ✅ Closing patterns: CRUD + analytics
- ✅ Learning Center: training data management
- ✅ Smart Labels: auto-labeling management
- ✅ Bot Activation: WhatsApp QR scan + pairing
- ✅ Settings: admin & operator management
- ✅ WhatsApp engine terintegrasi penuh
- ✅ Socket.IO realtime events untuk semua fitur
- ✅ Graceful shutdown (SIGINT/SIGTERM)
- ✅ Follow-up scheduler (cron-based)
- ✅ Backup database via API
