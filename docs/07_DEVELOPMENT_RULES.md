# Aturan Pengembangan & Development Rules

> **WAJIB DIBACA** sebelum melakukan perubahan apapun pada proyek ini.  
> Dokumen ini adalah "konstitusi" pengembangan — semua developer (manusia maupun AI) harus mematuhinya.

---

## 🧠 Prinsip Utama

### 1. Data Integrity di Atas Segalanya
- **TIDAK BOLEH** ada operasi yang bisa menyebabkan pesan pelanggan hilang
- Database harus selalu dalam keadaan konsisten
- Setiap perubahan schema DB harus melalui `safeAddColumn()` — JANGAN pakai `sync({ force: true })`
- Backup otomatis adalah required, bukan opsional

### 2. Graceful Error Recovery
- Setiap fungsi yang memanggil API eksternal (OpenAI, Komerce, RocketChat) HARUS punya try/catch
- Kegagalan satu komponen TIDAK BOLEH menghentikan seluruh sistem
- Gunakan `finally()` untuk melepas resource (slot queue, file temp, dll)

### 3. Non-Blocking sebisa Mungkin
- Analisis AI pada media yang diupload: background, non-blocking
- Update ChatSummary: background, non-blocking
- Webhook RocketChat: respond 200 dulu, proses kemudian

### 4. Tidak Ada Magic Numbers
- Semua konstanta konfigurasi (timeout, limit, delay) harus diberi nama dan komentar
- Contoh yang BENAR:
```javascript
const DEBOUNCE_MS = 3500; // 3.5 detik — sweet spot antara responsif dan anti-spam
const MAX_CONCURRENCY = 3; // Maks 3 request AI serentak (balance speed vs cost)
```

---

## 📐 Standar Kode

### Naming Convention
```
Files: snake_case (message_handler.js)
Functions: camelCase (handleMessage, _processAIReply)
Private functions: _camelCase (diawali underscore)
Constants: UPPER_SNAKE_CASE (DEBOUNCE_MS, MAX_CONCURRENCY)
DB Models: PascalCase (ChatMessage, BotAgent)
```

### Struktur File
Setiap file harus memiliki:
```javascript
/**
 * @file nama_file.js
 * @description Deskripsi singkat fungsi file ini.
 * 
 * KEY FEATURES:
 *  - Fitur 1
 *  - Fitur 2
 */
```

### Comment Guidelines
- **Wajib** untuk: logika bisnis kompleks, workaround bug, security concern
- **Tidak perlu** untuk: kode yang sudah self-explanatory
- Gunakan Bahasa Indonesia untuk komentar bisnis, Bahasa Inggris untuk komentar teknis

### Error Handling Pattern
```javascript
// ✅ BENAR
try {
    const result = await riskyOperation();
    return result;
} catch (error) {
    logger.error(`[ServiceName] Operasi gagal: ${error.message}`);
    return fallbackValue; // atau throw untuk propagate
} finally {
    cleanupResource(); // SELALU
}

// ❌ SALAH
const result = await riskyOperation(); // Unhandled promise rejection
```

---

## 🏗️ Aturan Arsitektur

### Prinsip Separation of Concerns

```
index.js           → Hanya orchestration (inisialisasi service, tidak ada logic)
whatsapp_service   → Hanya manage WhatsApp client lifecycle
message_handler    → Hanya handle incoming messages, tidak ada business logic berat
ai_service         → Hanya AI processing, tidak ada WA sending
dashboard_service  → Hanya HTTP/Socket handling + semua REST routes
```

### Rule: Tidak Ada Cross-Dependency Maju
```
# DIIZINKAN (dependency mengalir ke bawah)
dashboard_service → whatsapp_service (untuk sendManualMessage)
message_handler → ai_service (untuk getAIResponse)
ai_service → media_service (untuk getKnowledgeMedia)

# DILARANG (circular dependency)
ai_service → dashboard_service → ai_service ❌
```

### Rule: Database Access via Model, Bukan Raw SQL
```javascript
// ✅ BENAR
const store = await Store.findOne({ where: { wa_id: storeWaId } });

// ❌ SALAH (kecuali untuk PRAGMA)
await sequelize.query("SELECT * FROM Stores WHERE wa_id = ?", ...);
```

### Rule: Semua Config dari `.env`, Tidak Ada Hardcode di Logic
```javascript
// ✅ BENAR
const apiKey = config.OPENAI_API_KEY;

// ❌ SALAH
const apiKey = "sk-proj-xxx..."; // JANGAN PERNAH!
```

---

## 🔒 Aturan Keamanan

1. **Session Secret** — HARUS di-set via `SESSION_SECRET` env, jangan pakai default di production
2. **Admin Password** — HARUS di-set via `ADMIN_PASS` env, jangan pakai `admin123` di production
3. **File Upload** — Selalu validasi tipe dan ukuran file sebelum proses
4. **Token Logging** — JANGAN pernah log API token/secret di logger (redact sebelum log)
5. **HTTPS** — Di production, set `NODE_ENV=production` agar session cookie secure otomatis aktif

---

## 🗄️ Aturan Database

1. **JANGAN** pakai `sequelize.sync({ force: true })` di production → hapus semua data!
2. **SELALU** gunakan `safeAddColumn()` untuk menambah kolom baru
3. **SELALU** test migration di local sebelum push ke production
4. **BACKUP** sebelum setiap perubahan schema yang signifikan
5. WAL mode HARUS aktif: `PRAGMA journal_mode=WAL`

---

## 🤖 Aturan untuk AI Coding Agent (Claude/Gemini/dll)

Saat mengerjakan task di proyek ini:

### SEBELUM mulai:
1. Baca file yang akan dimodifikasi PENUH terlebih dahulu
2. Pahami dependency (siapa yang pakai function/class ini)
3. Cek apakah ada celah yang relevan di `06_GAPS_AND_UPGRADES.md`

### SAAT coding:
1. Jangan ubah behavior yang sudah berjalan kecuali memang diminta
2. Ikuti naming convention yang sudah ada di file tersebut
3. Tambahkan komentar untuk setiap logic baru yang non-trivial
4. Jangan hapus kode yang lama kecuali memang harus diganti

### SETELAH selesai:
1. Verifikasi tidak ada circular import baru
2. Pastikan setiap async function punya error handling
3. Update dokumentasi di folder `/docs` jika ada perubahan arsitektur

### DILARANG KERAS:
- Mengubah nama function/variable yang sudah dipakai di banyak tempat tanpa update semua referensi
- Menambahkan dependency npm baru tanpa alasan yang jelas
- Mengubah schema database tanpa migration yang aman
- Menghapus error handling yang sudah ada

---

## 📊 Standar Commit Message

```
Format: type: deskripsi singkat (bahasa Inggris)

Types:
  feat:     Fitur baru
  fix:      Perbaikan bug
  perf:     Optimasi performa
  refactor: Refactoring tanpa perubahan behavior
  docs:     Perubahan dokumentasi saja
  chore:    Maintenance (update deps, cleanup, dll)
  test:     Penambahan/perbaikan test

Contoh:
  feat: implement RocketChat hybrid mode (no-browser integration)
  fix: AI queue stale pruning to prevent late replies
  perf: optimize Chromium memory with flags + cache cleanup
  docs: add WA-JS integration plan to docs folder
```

---

## 🚀 Deployment Checklist

Sebelum deploy ke production/VPS:

- [ ] `.env` sudah diset lengkap (`OPENAI_API_KEY`, `SESSION_SECRET`, `ADMIN_PASS`)
- [ ] `NODE_ENV=production` di-set
- [ ] `session.cookie.secure = true` jika menggunakan HTTPS
- [ ] Rate limiter aktif (tidak ada route `/api/login` double registration)
- [ ] Backup database terakhir sudah diambil
- [ ] Log file tidak melebihi 100MB (manual rotation jika perlu)
- [ ] Test koneksi WA berhasil (scan QR atau RocketChat token valid)
- [ ] Cloudflare tunnel aktif jika webhook RocketChat dipakai
