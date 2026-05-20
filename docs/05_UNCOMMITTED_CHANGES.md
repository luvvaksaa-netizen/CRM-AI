# Perubahan Belum Di-Commit (Uncommitted Changes)

> **Tanggal Analisis:** 2026-05-19 (Updated)  
> **Branch:** `main` (up to date with origin/main)

---

## Ringkasan Perubahan

Terdapat perubahan signifikan yang mencakup **penghapusan integrasi RocketChat** dan **perbaikan bug kritis** pada frontend/backend.

## Perubahan Terbaru (2026-05-20 — Dashboard Persistence & Routing)

### ✅ Bug Fixes
| Bug | File | Fix |
|-----|------|-----|
| `is_bot_active` toggle tidak tersimpan setelah refresh | `database/index.js` | Tambah `safeAddColumn` untuk kolom `is_bot_active` agar migrasi SQLite aman |
| `is_bot_active` undefined menyebabkan toggle selalu OFF | `index.html` | Gunakan `!== false` fallback di `switchStore()` |
| Frontend tidak verifikasi response API settings | `index.html` | `updateStoreAgentBinding()` sekarang parse JSON response dan revert UI jika gagal |
| Socket `storeUpdated` event tidak ditangani | `index.html` | Tambah `socket.on('storeUpdated')` handler yang reload data store dari server |
| Tidak ada logging detail saat update settings | `dashboard_service.js` | Tambah `logger.info` dengan JSON detail perubahan |
| API settings tidak return data terbaru | `dashboard_service.js` | `store.reload()` + kirim `store.dataValues` di response |

### ✅ New Features
| Fitur | File | Detail |
|-------|------|--------|
| URL Hash Routing | `index.html` | `switchView()` update `location.hash` (e.g. `#/chat`, `#/connect`) |
| Browser Back/Forward | `index.html` | `popstate` handler navigasi antar view tanpa reload |
| Deep Link Support | `index.html` | Buka langsung `http://localhost:3000/#/connect` ke halaman Koneksi |
| Revert UI on Failure | `index.html` | `reloadCurrentStoreSettings()` helper sinkronkan UI dengan server saat save gagal |
| AI Silent Failure Fix | `message_handler.js` | Try-Catch pada reply & Fallback Empty Content |
| Centang Biru (Read) | `wajs_bridge.js` | Implementasi `safeMarkIsRead` ke API internal WPPConnect |

---

## Perubahan Sebelumnya (Session Cleanup)

### ✅ File Dihapus
| File | Alasan |
|------|--------|
| `src/events/webhook_handler.js` | RocketChat webhook handler — fitur dihapus |
| `src/services/roketchat_service.js` | RocketChat API client — fitur dihapus |

### ✅ Bug Fixes
| Bug | File | Fix |
|-----|------|-----|
| Double `/api/login` route (rate limiter mati) | `dashboard_service.js` | Hapus definisi duplikat, rate limiter sekarang aktif |
| Double `module.exports` | `video_analysis_service.js` | Hapus duplikat |
| `session.cookie.secure = false` | `dashboard_service.js` | Sekarang `process.env.NODE_ENV === 'production'` |
| Duplikat `updateStoreAgentBinding()` di frontend | `index.html` | Hapus fungsi duplikat (yang tanpa `is_bot_active`) |
| Duplikat `socket.on('statusUpdate')` listener | `index.html` | Hapus listener duplikat |
| Status detection referensi "RocketChat API" | `index.html` | Bersihkan — sekarang hanya deteksi "Dihubungkan" |

### ✅ Code Cleanup
| File | Perubahan |
|------|-----------|
| `index.js` | Hapus hybrid mode logic, simplify ke WWebJS-only |
| `dashboard_service.js` | Hapus webhook route, RocketChat store fields, auth bypass |
| `public/index.html` | Hapus RocketChat toggle/fields di modal Add Store |
| `src/database/index.js` | Mark RocketChat columns sebagai legacy |
| `docs/*.md` | Update 5 file docs untuk reflect perubahan |

---

## File Termodifikasi Sebelumnya (Masih Uncommitted)

### `src/ai_service.js` — Queue Timeout & Stale Pruning
- `QUEUE_TIMEOUT_MS = 2 * 60 * 1000` (2 menit auto-expire)
- Mencegah balasan basi yang datang terlambat

### `src/database/index.js` — WAL Mode
- `PRAGMA journal_mode=WAL` untuk performa concurrent read/write
- `safeAddColumn()` untuk migrasi aman

### `src/events/message_handler.js` — Group Filter & Silent Mode
- Filter grup WA yang lebih tegas (`@g.us`)
- `shouldAIReply = false` sebagai Silent Mode
- Cleanup file media sementara setelah analisis

### `src/whatsapp_service.js` — Memory Optimization
- Cleanup cache Chromium saat startup
- Chromium flags: `--single-process`, `--disable-extensions`, dll
- Hemat ~100-200MB per instance

### `public/index.html` — UI Updates
- Typing indicator
- Agent management lengkap
- Chat history limit (50/100 messages)

---

## File Baru (Untracked)

| File/Folder | Keterangan |
|-------------|------------|
| `install_and_run.bat` | Script instalasi otomatis untuk Windows |
| `check_db.js` | Script debug database |
| `test_system.js` | Script pengujian sistem |
| `cloudflared.exe` | Binary Cloudflare tunnel (Windows) |
| `scratch/` | Folder file eksperimen/debug |
| `backups/*.sqlite` | Snapshot database |

---

## Rekomendasi Commit

```bash
# Commit 1: RocketChat Removal + Bug Fixes
git add index.js
git add src/services/dashboard_service.js
git add src/services/video_analysis_service.js
git add src/database/index.js
git add public/index.html
git rm src/events/webhook_handler.js
git rm src/services/roketchat_service.js
git commit -m "refactor: remove RocketChat integration, fix critical bugs (double login, session secure, duplicate functions)"

# Commit 2: WhatsApp Service Memory Optimization
git add src/whatsapp_service.js
git commit -m "perf: optimize Chromium memory usage with flags + cache cleanup"

# Commit 3: AI & Message Handler Hardening
git add src/ai_service.js
git add src/events/message_handler.js
git commit -m "fix: AI queue stale pruning, silent mode, typing status indicator"

# Commit 4: Documentation Update
git add docs/
git commit -m "docs: update all documentation to reflect RocketChat removal"
```

### Tambahkan ke `.gitignore`:
```
Transfer_Laptop_Baru.zip
cloudflared.exe
scratch/
backups/
*.sqlite
api-roketchat.md
update_to_roketchat.js
```
