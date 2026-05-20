# Analisis Celah & Potensi Upgrade

> **Status:** Analisis mendalam berbasis kode saat ini (2026-05-19)

---

## 🔴 Celah Kritis (Critical Issues)

### 1. ~~`double module.exports` di `video_analysis_service.js`~~ ✅ FIXED
Diperbaiki — hanya satu `module.exports` sekarang.

### 2. ~~Hardcoded `/api/login` Route Double Registration~~ ✅ FIXED
Diperbaiki — hanya satu definisi `/api/login` dengan `loginLimiter` yang aktif.

### 3. ~~`session.cookie.secure = false`~~ ✅ FIXED
Diperbaiki — sekarang `secure: process.env.NODE_ENV === 'production'` (otomatis true di production HTTPS).

### 4. Tidak Ada Input Validation pada Manual Send
**Lokasi:** `POST /api/send` — tidak ada validasi format nomor WA
```javascript
// `to` bisa berupa string apapun — tidak ada format check 62xxx@c.us
const { storeId, to, body } = req.body;
```
**Dampak:** Bot bisa crash atau kirim ke nomor tidak valid.

### 5. ~~In-Memory `pausedContacts` tidak persisten~~ ✅ FIXED
Diperbaiki — sekarang menggunakan model `PausedContact` di SQLite. Status pause **bertahan saat restart**.
Data di-cache di memory untuk performa, tapi selalu disinkronkan ke DB.

### 6. ~~RocketChat URL Hardcoded~~ ✅ REMOVED
Seluruh integrasi RocketChat sudah **dihapus** dari kode (file `roketchat_service.js` dan `webhook_handler.js` dihapus). Sistem sekarang menggunakan WWebJS saja.

---

## 🟡 Celah Sedang (Medium Issues)

### 7. Chat History Limit Terlalu Ketat (50 pesan)
Setelah perubahan terbaru, limit history dikurangi dari 300 ke 50 per kontak untuk menghindari lag browser.
**Dampak:** Operator tidak bisa melihat histori percakapan panjang di dashboard.
**Solusi:** Implementasi infinite scroll / pagination di frontend.

### 8. File Sementara Media Bisa Bocor jika Proses Crash
**Lokasi:** `src/events/message_handler.js`
Jika proses AI crash sebelum `_cleanupTempFile()` dipanggil, file customer (foto/VN) tertinggal di disk.
**Solusi:** Startup cleanup untuk file `customer_*` dan `voice_*` di UPLOADS_DIR yang berumur > 1 jam.

### 9. `rajaongkir_service.js` Cache File JSON Tidak Di-expire
**Lokasi:** `komerce_cache.json`
Cache origin ID Kediri tidak pernah invalid → jika Komerce mengubah ID, bot salah terus.
**Solusi:** Tambahkan TTL pada cache entry.

### 10. Dashboard Auth Tidak Support Multi-User
Saat ini hanya ada satu admin credential (`ADMIN_USER`/`ADMIN_PASS`).
**Dampak:** Tidak ada audit trail siapa yang kirim pesan manual.

### 11. Tidak Ada Rate Limiting untuk API Send
`POST /api/send` dan `POST /api/send-media` tidak dibatasi → bisa abuse oleh operator atau jika session bocor.

### 12. Video Analysis Menggunakan `/tmp` System
**Lokasi:** `video_analysis_service.js` baris 212
```javascript
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-frames-'));
```
Di beberapa VPS Linux, `/tmp` berada di RAM (tmpfs) → ekstrak frame video besar bisa habiskan RAM.
**Solusi:** Gunakan `DATA_DIR/tmp/` sebagai alternatif.

---

## 🟢 Celah Ringan / Enhancement (Low Priority)

### 13. `bot_name` di tabel Stores adalah Legacy Column
Masih ada di schema tapi tidak aktif dipakai (sudah pindah ke `BotAgents`). Membingungkan.

### 14. `settings.json` di Root Tidak Dipakai
File `settings.json` di root direktori tampaknya warisan konfigurasi lama dan tidak lagi dipakai oleh kode aktif.

### 15. `history_service.js` dan `settings_service.js` Kosong/Minimal
Dua service ini ada di direktori tapi kemungkinan belum dipakai penuh.

### 16. Logger Tidak Ada Log Rotation
`logs/app.log` akan terus membesar tanpa batas. Di produksi dengan traffic tinggi, bisa habiskan disk.

### 17. Tidak Ada Error Boundary di Socket.io
Jika `addToChatHistory()` gagal (DB error), pesan masuk tetap tidak tercatat tanpa notifikasi ke operator.

---

## Prioritas Perbaikan

> Update 2026-05-20: item #4, #8, #16, #7, dan #9 sudah selesai pada hardening terbaru. Gap tambahan dari real UI test juga sudah fixed: kontak `@lid` tidak lagi tampil sebagai nomor palsu, broadcast/newsletter/group chat diabaikan dari CRM, dan WA-JS bridge menambahkan request phone, label, reaction by id, serta forward message.

| # | Issue | Prioritas | Status |
|---|-------|-----------|--------|
| 1 | Double `module.exports` | ✅ | **FIXED** |
| 2 | Double `/api/login` route | ✅ | **FIXED** |
| 3 | `session.secure = false` | ✅ | **FIXED** |
| 5 | `pausedContacts` persistence | ✅ | **FIXED** |
| 6 | RocketChat code | ✅ | **REMOVED** |
| — | `/api/send` + `/api/send-media` endpoints | ✅ | **ADDED** |
| — | `/api/pause` endpoint | ✅ | **ADDED** |
| — | `is_bot_active` toggle tidak persist | ✅ | **FIXED** — Safe migration + frontend fallback |
| — | Settings API tidak return data terbaru | ✅ | **FIXED** — `store.reload()` + kirim `dataValues` |
| — | Socket `storeUpdated` tidak ditangani | ✅ | **FIXED** — Handler frontend sinkronkan data |
| — | SPA tanpa URL routing | ✅ | **ADDED** — Hash routing + popstate + deep link |
| 4 | Tidak ada validasi format nomor WA | 🟠 TODO | Rendah |
| 8 | File temp bocor saat crash | 🟠 TODO | Sedang |
| 16 | Log rotation | 🟠 TODO | Rendah |
| 7 | Chat history pagination | 🟢 Enhancement | Tinggi |
| 9 | Cache expiry RajaOngkir | 🟢 Enhancement | Rendah |
| — | Bug AI Silent Failure (Kosong) | ✅ | **FIXED** — Fallback text & Try-catch |
| — | Bug Centang Biru | ✅ | **FIXED** — `safeMarkIsRead` sebelum AI |
| — | Akses Publik (crm.datasdm.com) | ✅ | **SOLVED** — Cloudflare Tunnel Docs |
| — | AI Contextual Amnesia (Lupa Detail) | ✅ | **FIXED** — Draconian rules untuk Rekap, Tool Ongkir & Limit History 30 |
| — | Marketing Autopilot Salah Pemicu | ✅ | **FIXED** — Regex `\bkw\b` + Integrasi kontekstual ke AI |
