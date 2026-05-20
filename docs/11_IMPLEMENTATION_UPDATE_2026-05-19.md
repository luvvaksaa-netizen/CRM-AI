# Implementation Update 2026-05-19

Dokumen ini mencatat pekerjaan lanjutan dari roadmap `docs/README.md`, gap list `docs/06_GAPS_AND_UPGRADES.md`, dan rencana `docs/08_WAJS_INTEGRATION_PLAN.md`.

## Selesai

- [x] Install dependency resmi `@wppconnect/wa-js`.
- [x] Tambah hybrid WA-JS bridge di `src/services/wajs_bridge.js`.
- [x] Inject WA-JS saat WhatsApp client `ready`; jika gagal, sistem tetap fallback ke WWebJS.
- [x] Tambah endpoint `GET /api/system/wa-js` untuk cek status package/injection/runtime.
- [x] Implementasi reaksi emoji melalui `WPP.chat.sendReactionToMessage` jika `WPP` aktif, fallback ke `message.react()` jika tersedia.
- [x] Hapus route duplikat `/api/send`, `/api/send-media`, dan pause API.
- [x] Validasi dan normalisasi nomor WA/JID untuk manual send.
- [x] Rate limiting untuk `/api/send` dan `/api/send-media`.
- [x] Chat history pagination + infinite scroll di dashboard.
- [x] Startup sweeper untuk file/folder sementara lama.
- [x] Video frame extraction memakai `DATA_DIR/tmp/`.
- [x] Cache RajaOngkir memakai TTL dan disimpan di `DATA_DIR/komerce_cache.json`.
- [x] Log rotation otomatis untuk `logs/app.log`.
- [x] Baseline multi-user RBAC via `ADMIN_USERS_JSON`.
- [x] Local running test: server berhasil start di `http://localhost:3000`, API test 28/28 passed, dan store `sampel-1761` + `dhea-6466` masuk status `Menunggu Scan QR`.
- [x] Startup multi-store diperkeras dengan `CLIENT_LAUNCH_TIMEOUT_MS` agar satu sesi WA yang macet tidak memblokir store berikutnya.
- [x] Recovery logout membersihkan marker event listener supaya restart client tidak skip event QR/ready.
- [x] Fix identitas kontak `@lid`: tidak lagi ditampilkan sebagai nomor palsu di CRM.
- [x] Tambah kolom identitas kontak di `ChatMessages` + backfill startup untuk histori lama.
- [x] Abaikan `@broadcast`, `@newsletter`, dan group chat dari daftar customer.
- [x] Manual reply/media mendukung existing chat id `@lid`.
- [x] Tambah WA-JS CRM actions: request phone, labels, reaction by message id, dan forward message.
- [x] Auto-label non-blocking via `WPP.labels.*` (`AI Lead Baru`, `Kontak LID`) dengan fallback aman.
- [x] Tambah test utilitas untuk validasi `@lid`, normalisasi WA ID, dan ignore broadcast/newsletter.

## Status WA-JS

Sistem sekarang **menggunakan WA-JS secara hybrid**, bukan migrasi penuh:

- WWebJS tetap menjadi core session manager untuk QR, auth, event message, dan send text/media.
- WA-JS diinjeksi ke Puppeteer page untuk membuka akses `window.WPP`.
- Fitur yang sudah memakai jalur WA-JS: reaksi emoji, request phone untuk `@lid`, label bisnis, dan forward pesan.
- Cek runtime: `GET /api/system/wa-js`.
- Sebelum QR discan, status `injected=false` normal karena client belum `ready`; injeksi WA-JS dijalankan setelah WA online.

## Belum Selesai / Butuh Keputusan

- Migrasi penuh ke `@wppconnect-team/wppconnect` sebagai replacement WWebJS.
- Integrasi WhatsApp Business API resmi Meta.

Dua item di atas sengaja belum dipaksakan karena punya risiko operasional/credential eksternal dan perlu uji sesi WA nyata sebelum production switch.

## Update 2026-05-20

Implementasi tambahan berfokus pada readiness real test WA:

- Screenshot menunjukkan angka `@lid` tampil seperti nomor internasional. Root cause: sistem lama memformat local part `@lid` sebagai nomor. Sekarang identity layer membedakan `phone`, `lid`, `broadcast`, `newsletter`, dan `group`.
- Tombol request phone muncul hanya untuk kontak `@lid`, mencoba `WPP.contact.getPnLidEntry` untuk mendapatkan nomor asli dari cache, lalu memanggil `WPP.chat.requestPhoneNumber` jika belum tersedia.
- Endpoint WA-JS baru tidak memblokir core WWebJS; jika `window.WPP` belum ready, API memberi error aman.
- Error `EADDRINUSE` saat `npm start` bukan bug aplikasi utama; itu terjadi karena proses `node index.js` lama masih mendengar port 3000.
- Anti-spam reply diperkuat dengan lock per kontak dan typing heartbeat agar customer melihat status mengetik selama AI memproses.
