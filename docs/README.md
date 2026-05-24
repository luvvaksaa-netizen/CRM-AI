# WA-AI-CS Documentation Index

> **Platform:** WhatsApp AI Customer Service & CRM  
> **Version:** 1.7+  
> **Dianalisis:** 2026-05-20  
> **Status:** Production Running, hybrid WWebJS + WA-JS

---

## Navigasi Dokumen

| # | Dokumen | Deskripsi |
|---|---------|-----------|
| 01 | [Project Overview](./01_PROJECT_OVERVIEW.md) | Tujuan, arsitektur, tech stack, struktur folder, alur data |
| 02 | [Database Schema](./02_DATABASE_SCHEMA.md) | ERD dan semua model database |
| 03 | [AI Engine](./03_AI_ENGINE.md) | Cara kerja AI, tool calling, sanitizer, prompt strategy |
| 04 | [API Reference](./04_API_REFERENCE.md) | REST API + Socket.io events |
| 05 | [Uncommitted Changes](./05_UNCOMMITTED_CHANGES.md) | Analisis perubahan lokal |
| 06 | [Gaps & Upgrades](./06_GAPS_AND_UPGRADES.md) | Celah, prioritas, dan status perbaikan |
| 07 | [Development Rules](./07_DEVELOPMENT_RULES.md) | Aturan coding dan standar arsitektur |
| 08 | [WA-JS Integration Plan](./08_WAJS_INTEGRATION_PLAN.md) | Integrasi WA-JS/WPPConnect dan roadmap migrasi |
| 09 | [Operations Guide](./09_OPERATIONS_GUIDE.md) | `.env`, deployment, troubleshooting, backup/recovery |
| 10 | [User Guide](./10_USER_GUIDE.md) | Panduan pengguna dashboard |
| 11 | [Implementation Update 2026-05-19](./11_IMPLEMENTATION_UPDATE_2026-05-19.md) | Catatan implementasi terbaru |

---

## Quick Reference

```bash
npm start
# Dashboard: http://localhost:3000/login.html
```

File kunci:
- `src/whatsapp_service.js` - multi-session WA client manager.
- `src/events/message_handler.js` - pipeline pesan masuk, debouncer, media, auto-label.
- `src/services/dashboard_service.js` - Express dashboard + REST API.
- `src/services/wajs_bridge.js` - adapter hybrid WA-JS.
- `src/database/index.js` - schema, migrasi, dan backfill.
- `public/index.html` - CRM web app.

---

## Status Bug

- [x] Double `/api/login` route fixed.
- [x] Session cookie secure otomatis di production.
- [x] RocketChat code dibersihkan.
- [x] `pausedContacts` persisten di SQLite.
- [x] Format nomor manual divalidasi.
- [x] Kontak `@lid` tidak lagi ditampilkan sebagai nomor telepon palsu; sistem mencoba resolve nomor asli via `WPP.contact.getPnLidEntry`.
- [x] Broadcast/newsletter/group chat diabaikan dari CRM customer list.
- [x] Port `3000` error `EADDRINUSE` teridentifikasi sebagai proses server lama yang masih hidup.

---

## Roadmap

### Jangka Pendek
- [x] Fix double `/api/login` route.
- [x] Persist `pausedContacts` ke SQLite.
- [x] Set `session.secure` otomatis via `NODE_ENV`.
- [x] Hapus RocketChat integration.
- [x] Tambah endpoint `/api/send`, `/api/send-media`, dan pause API.
- [x] Fix contact identity untuk `@lid`.

### Jangka Menengah
- [x] Integrasi hybrid WA-JS (`@wppconnect/wa-js`) di atas WWebJS.
- [x] Reaksi emoji via `WPP.chat.sendReactionToMessage` jika WA-JS aktif.
- [x] Chat history pagination / infinite scroll.
- [x] Log rotation otomatis.
- [x] WA-JS bridge untuk request phone, labels, reaction by message id, dan forward message.
- [ ] Migrasi penuh ke `@wppconnect-team/wppconnect` sebagai replacement WWebJS.

### Jangka Panjang
- [x] Multi-user admin berbasis env dengan role `admin` / `operator` / `viewer`.
- [x] Auto-label pelanggan via `WPP.labels.*` (non-blocking, fallback aman).
- [ ] Integrasi WhatsApp Business API resmi untuk skala enterprise.

Catatan: migrasi penuh ke package wrapper WPPConnect dan WhatsApp Business API resmi tetap belum dieksekusi karena menyentuh strategi koneksi/akun dan perlu soak test WA nyata.

---

## Status WA-JS

Sistem memakai **hybrid WWebJS + WA-JS**:
- Core session, QR, send text/media, dan event message masih memakai `whatsapp-web.js`.
- Paket resmi `@wppconnect/wa-js` sudah terpasang.
- Saat client `ready`, sistem inject bundle WA-JS ke Puppeteer page dan mengaktifkan `window.WPP`.
- Jika injeksi gagal, bot tetap berjalan dengan WWebJS dan menulis warning ke log.
- Observability: `GET /api/system/wa-js`.

Fitur WA-JS yang sudah dibuka:
- `WPP.chat.sendReactionToMessage` untuk reaksi emoji.
- `WPP.contact.getPnLidEntry` untuk membaca mapping LID -> nomor telepon dari cache WhatsApp lokal.
- `WPP.chat.requestPhoneNumber` untuk meminta nomor asli kontak `@lid` jika belum ada di cache.
- `WPP.labels.getAllLabels`, `addNewLabel`, dan `addOrRemoveLabels`.
- `WPP.chat.forwardMessages` / `forwardMessage`.

---

## Hardening Update 2026-05-20

- `ChatMessages` sekarang menyimpan `wa_message_id`, `contact_display_name`, `contact_phone`, `contact_lid`, `contact_type`, dan `contact_source`.
- Backfill startup membersihkan histori lama yang sebelumnya menampilkan `+LID` sebagai nama customer.
- UI CRM menampilkan nomor asli `+62...` jika mapping LID -> phone tersedia; jika belum, baru fallback ke `Kontak WA #xxxxxx`.
- Tombol telepon muncul untuk kontak LID agar operator bisa resolve nomor dari cache lokal atau meminta nomor asli customer via WhatsApp.
- Endpoint request phone bisa dipakai role `viewer` untuk enrichment nomor, sementara kirim pesan/media tetap dibatasi `operator`/`admin`.
- Manual reply/media sekarang menerima chat id `@lid` yang sudah ada, sehingga operator tetap bisa membalas percakapan LID.
- Auto-label WA-JS mencoba memberi label `AI Lead Baru` dan `Kontak LID` tanpa memblokir pipeline chat.

## Response & Labeling Update 2026-05-22

- Debounce dan typing simulation dipercepat supaya balasan pendek terasa lebih natural.
- Output AI sekarang bisa dikirim sebagai beberapa bubble pendek; chat normal mengikuti batas 10 kata per bubble, sedangkan rekap/order tetap lengkap.
- Sanitizer tidak lagi menghapus brand/domain valid seperti `slaludiskon.com`.
- Identitas kontak tidak lagi turun dari nomor/nama nyata ke placeholder `Kontak WA #xxxxxx` ketika pesan LID terbaru belum membawa nomor asli.
- Label WA-JS diperluas menjadi label manager di dashboard: list, create, edit, delete, apply, remove.
- AI auto-label dari konfigurasi `BotAgent.auto_labels` diperbaiki agar benar-benar dieksekusi via WA-JS dan tetap non-blocking.

## Reliability Update 2026-05-23

- Upload video besar sekarang mengekstrak audio kecil via ffmpeg sebelum dikirim ke Whisper, lalu retry otomatis untuk error koneksi sementara.
- Video katalog di atas threshold dikompresi otomatis menjadi MP4 ringan saat analisis atau saat pertama kali dikirim, agar aset lama pun tidak tersangkut upload video 20MB.
- Lock AI per kontak sekarang memakai coalescing queue: pesan baru saat AI masih menjawab digabung ke satu batch lanjutan, bukan membuat banyak job menunggu serial.
- Jika balasan AI berisi video, teks dikirim lebih awal supaya customer cepat melihat respons walau media masih diunggah WhatsApp.
- `ChatMessages` menyimpan metadata quoted reply (`quoted_message_id`, `quoted_body`, `quoted_from_me`, `quoted_sender_name`) dan dashboard menampilkan konteks "membalas pesan yang mana".
- Manual reply di dashboard bisa memilih pesan asal dan mengirim WhatsApp quoted reply memakai `quotedMessageId`.
- WA-JS startup sync kini memakai `WPP.chat.list()` + defensive quoted parsing, sehingga pesan non-reply tidak lagi menjatuhkan sync ke error `does not have a reply` / `waitForChatLoading`.
- Health check browser sekarang restart runtime tanpa menghapus folder sesi login; pengiriman AI, manual, dan follow-up menunggu client siap sebelum `sendMessage`.
- Typing indicator hanya ditampilkan dekat momen kirim dan hard-stop default 7 detik, agar customer tidak melihat "sedang mengetik" lama lalu hilang.
- AI punya tool `matikan_bot_kontak` untuk benar-benar mem-pause kontak saat prompt agent mengalihkan kasus ke CS manusia.
