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

> Update 2026-05-22: response latency diturunkan lewat debounce/typing yang lebih pendek dan WA-JS typing fallback yang tidak menunggu reinjection. Sanitizer diperbaiki agar brand domain valid tidak hilang. Identitas kontak LID tidak lagi regresi ke `Kontak WA #xxxxxx` jika sebelumnya sudah ada nomor/nama yang lebih stabil. Auto-label AI dari `BotAgent.auto_labels` dan label manager dashboard sudah ditambahkan.

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
| — | WA-JS Message Sync (waitForChatLoading) | ✅ | **FIXED 2026-05-23** — `WPP.chat.list()` + `getMessages` defensive quoted parsing |
| — | AI tidak kirim media katalog (hanya teks) | ✅ | **FIXED 2026-05-23** — Tool `kirim_media_katalog` mendukung `label_names` |
| — | Pesan dihapus tidak sinkron ke web | ✅ | **FIXED 2026-05-23** — `message_revoke_everyone` event + Socket.IO emit |
| — | Bot balasan terlalu lambat | ✅ | **FIXED 2026-05-23** — Typing dekat momen kirim, hard-stop 7 detik, media-only tool bisa skip second AI call |
| — | Media gambar/video tidak tampil di chat CRM | ✅ | **VERIFIED** — `parseMediaMsg()` merender `[MEDIA:/path]` dan `[VIDEO:/path]` sebagai tag HTML |
| — | Pesan dobel di CRM (race condition dedup) | ✅ | **FIXED 2026-05-23** — Dedup guard di `addToChatHistory` + in-memory `botSentMessageIds` tracker |
| — | AI reply deadlock (infinite spin loop) | ✅ | **FIXED 2026-05-23** — Timeout 3 menit di `_processAIReply` agar tidak stuck selamanya |
| — | Hapus riwayat chat dari CRM | ✅ | **ADDED 2026-05-23** — `DELETE /api/chat/:store/:contact` + tombol 🗑️ di header + Socket chatCleared |
| — | Label media matching terlalu strict | ✅ | **FIXED 2026-05-23** — Fuzzy contains match + error menampilkan label tersedia |
| — | Opening flow bot salah (tanya nomor pesanan) | ✅ | **FIXED 2026-05-23** — System prompt cek `interactionCount === 1` dan mengikuti label media agent aktif, tidak hardcode DTF |
 
## Update 2026-05-23 - Media, Latency, Reply Context

| Issue | Status | Catatan |
|---|---|---|
| Whisper gagal transkripsi video 20MB karena upload MP4 penuh | Fixed | ffmpeg ekstrak audio MP3 16k/48kbps dulu + retry koneksi OpenAI. |
| Opening lambat karena video katalog besar dikirim sebelum teks | Fixed | Video besar dikompresi untuk WA + teks dikirim lebih awal jika respons mengandung video. |
| Batch AI per kontak antre serial sampai 2-5 menit | Fixed | Active reply lock diganti coalescing queue per kontak. |
| Dashboard tidak tahu pesan reply mengacu ke chat yang mana | Fixed | ChatMessages menyimpan quoted context dan UI bisa manual quoted reply. |
| WA-JS sync gagal pada pesan non-reply (`does not have a reply`) | Fixed | Adapter tidak lagi membaca `quotedMsg` langsung tanpa safe getter. |
| Health check menghapus sesi ketika browser detached | Fixed | Recovery runtime sekarang destroy/relaunch browser tanpa clean slate `.wwebjs_auth`. |
| Prompt meminta bot dimatikan tapi engine tidak punya tool pause | Fixed | Tool internal `matikan_bot_kontak` ditambahkan dan dieksekusi downstream. |

## Update 2026-05-24 — Stability, Typing, Follow-Up & Media Reliability

| Issue | Status | Catatan |
|---|---|---|
| Detached Frame error spam (18+ WARN) saat Health Check restart | ✅ Fixed | `_markTyping` sekarang diam (return false) jika frame detached, bukan log WARNING berulang |
| Bot gagal kirim balasan setelah browser restart (detached Frame) | ✅ Fixed | `_sendActiveMessage` gunakan `waitForActiveClient` bukan client lama dari closure |
| Health Check terlalu agresif (5 menit, timeout 30 detik) | ✅ Fixed | Interval 10 menit, timeout 10 detik; skip restart jika ada AI reply aktif (guard `getActiveAIRepliesCount`) |
| Follow-up crash (`Cannot read null.evaluate`) setelah restart | ✅ Fixed | `executeFollowUp` retry 15 detik jika error restart; reschedule +5 menit daripada cancel |
| Bot typing muncul lalu hilang (POV customer) | ✅ Fixed | Hard cap typing delay 4500ms agar total typing + kirim < 7 detik |
| Media tidak terkirim meski AI "bilang" sudah kirim | ✅ Fixed | `_sendMediaToChat` retry 1x setelah 2 detik; hapus fallback teks membingungkan |
| Log spam WARN WA-JS getMessages fallback (normal behavior) | ✅ Fixed | Downgrade ke `logger.info` untuk fallback yang expected |
| Browser "already running" saat Health Check restart | ✅ Fixed | Tambah `sleep(3000)` + `sleep(2000)` setelah `client.destroy()` untuk release OS Chromium lock |

## Update 2026-05-24 (Sesi 2) — Smart Bot Re-Activation & CS Manual Awareness

| Issue | Status | Catatan |
|---|---|---|
| Bot ON setelah 1 hari OFF langsung spam follow-up ke semua kontak | ✅ Fixed | `onBotActivated()` scan summary per-kontak; skip closing, batalkan yang sudah dibalas CS |
| AI tidak tau bahwa CS sudah balas customer saat bot OFF | ✅ Fixed | `message_create` trigger `triggerCsManualSummaryUpdate()` (debounced 30s) → OpenAI update rekap |
| Follow-up terkirim meski percakapan sudah closing | ✅ Fixed | `executeFollowUp` cek `ChatSummary` terbaru sebelum kirim; batalkan jika `STATUS: closing` |
| Follow-up terkirim meski CS sudah balas manual dari HP | ✅ Fixed | Guard baru: cek `sender_name = 'CS (dari HP)'` setelah `createdAt` follow-up → cancel |
| Tidak ada rekap saat bot di-toggle ON | ✅ Fixed | `bot_activation_service.js` perbarui rekap kontak yang dibalas CS; hasilnya jadi konteks AI |
| Reschedule follow-up saat bot ON tapi tidak tahu mana yang relevan | ✅ Fixed | Hanya jadwal ulang kontak yang customer-nya masih menunggu jawaban (belum dibalas) |

### File Baru
- `src/services/bot_activation_service.js` — Smart re-activation engine
- `docs/18_BOT_TOGGLE_BEHAVIOR.md` — Dokumentasi lengkap behavior toggle

## Update 2026-05-24 (Sesi 3) — Always-On Summary + Bulletproof Bot-OFF + Audit Konflik

| Issue | Status | Catatan |
|---|---|---|
| Summary tidak diperbarui saat customer chat ketika bot OFF | ✅ Fixed | `_triggerBackgroundSummaryIfNeeded()` dipanggil setiap pesan masuk (debounced 60s) |
| Bot tidak punya early check sebelum debouncer (buang CPU) | ✅ Fixed | FIREWALL 3 ditambah sebelum debouncer — cek `is_bot_active` dari DB lebih awal |
| Reaction 👍 dikirim ke foto meski bot OFF (leaking bot presence) | ✅ Fixed | Reaction hanya dikirim setelah FIREWALL 3 lolos (bot aktif confirmed) |
| Konflik antar komponen (summary update ganda, double-cancel, dsb) | ✅ Diaudit | Semua debounce terpisah, semua operasi idempotent — tidak ada konflik |
| Bot OFF guarantee: hanya 3 layer (rentan edge case) | ✅ Upgraded | Kini ada **4 lapisan FIREWALL** — defense-in-depth yang tidak bisa dilewati |
| Master Agent Prompt tidak diikuti (reaction, summary, context) | ✅ Aligned | System prompt + summary context + opening flow sesuai dokumen 17 |

### Ringkasan Arsitektur Akhir Bot-OFF Safety

```
Customer kirim pesan
  │
  ├─ STEP 1: Download & analisis media (Vision/Whisper) — SELALU
  ├─ STEP 2: Log ke DB + Dashboard — SELALU
  ├─ Background: Cancel follow-up — SELALU
  ├─ Background: Update summary (debounced 60s) — SELALU ← BARU
  │
  ├─ FIREWALL 1: shouldAIReply=false? → STOP
  ├─ FIREWALL 2: Kontak dipause? → STOP
  ├─ FIREWALL 3: is_bot_active=false? (DB check) → STOP ← BARU
  ├─ FIREWALL 4: is_bot_active=false? (di AI reply) → STOP
  │
  └─ AI membalas (hanya jika semua 4 FIREWALL lolos)
```
