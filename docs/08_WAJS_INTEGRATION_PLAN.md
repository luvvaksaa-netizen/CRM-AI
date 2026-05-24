# Rencana Integrasi WA-JS (wppconnect-team/wa-js)

> **Tujuan:** Menggantikan atau menambah kapabilitas `whatsapp-web.js` dengan WA-JS  
> **Referensi:** https://github.com/wppconnect-team/wa-js  
> **Status:** Hybrid Integration Implemented (2026-05-19)

---

## Apa itu WA-JS?

WA-JS adalah library JavaScript yang **mengekspos fungsi internal WhatsApp Web** ke dalam variabel global `WPP`. Cara kerjanya:

1. Build dari source → `dist/wppconnect-wa.js`
2. File tersebut di-**inject** ke dalam halaman WhatsApp Web yang berjalan di browser (Puppeteer/Playwright)
3. Setelah inject, kita memiliki akses ke `WPP.*` yang memuat ratusan fungsi WA

```javascript
// Setelah inject, akses dari Puppeteer page context:
const waState = await page.evaluate(() => WPP.conn.isAuthenticated());
await page.evaluate((phone, msg) => WPP.chat.sendTextMessage(phone, msg), '62xxx', 'Halo!');
```

---

## Ekosistem WA-JS

```
wppconnect-wa.js (wa-js)
    ↑ inject ke
WhatsApp Web Browser
    ↑ dikendalikan oleh
wppconnect (Node.js wrapper dengan Playwright/Puppeteer)
    ↑ dipakai oleh
wppconnect-server (REST API siap pakai)
```

**Relevansi untuk kita:**
- Saat ini kita pakai `whatsapp-web.js` yang juga inject ke WA Web tapi dengan pendekatan berbeda
- WA-JS lebih rendah level → lebih banyak kontrol, lebih banyak fitur
- wppconnect (layer di atas WA-JS) bisa menjadi drop-in replacement yang lebih powerful

---

## Kapabilitas WA-JS vs whatsapp-web.js Saat Ini

| Fitur | whatsapp-web.js | WA-JS |
|-------|-----------------|-------|
| Kirim teks | ✅ | ✅ |
| Kirim media (foto/video/doc) | ✅ | ✅ |
| Kirim voice note | ✅ | ✅ |
| Kirim stiker | ✅ | ✅ |
| Kirim lokasi | ✅ | ✅ |
| Kirim kontak | ✅ | ✅ |
| **Kirim reaksi emoji** | ❌ | ✅ `WPP.chat.sendReactionToMessage()` |
| **Quote/Reply specific message** | Parsial | ✅ Full control |
| **Forward pesan** | ❌ | ✅ `WPP.chat.forwardMessage()` |
| **Delete pesan (untuk semua)** | ✅ | ✅ |
| **Status Typing (simulasi)** | ✅ | ✅ (lebih stabil) |
| **Baca pesan (sendSeen)** | ✅ | ✅ |
| **Manajemen grup** | Terbatas | ✅ Full (add/remove/promote/demote) |
| **Label bisnis (WA Business)** | ❌ | ✅ `WPP.labels.*` |
| **List pesan (pengelompokan)** | ❌ | ✅ `WPP.lists.*` |
| **Story/Status viewer** | ❌ | ✅ |
| **Community management** | ❌ | ✅ `WPP.community.*` |
| **Presisi LID (new WA network)** | Partial | ✅ Native support |

---

## Skenario Integrasi

### Opsi A: wppconnect sebagai Replacement (Recommended)
Ganti `whatsapp-web.js` dengan `wppconnect` (yang secara internal menggunakan WA-JS).

**Kelebihan:**
- API yang mature dan production-ready
- Sudah handle LID (new WhatsApp network ID format)
- Dukungan fitur yang jauh lebih kaya
- Active maintenance

**Cara implementasi:**
```javascript
// Sebelum (whatsapp-web.js)
const { Client, LocalAuth } = require('whatsapp-web.js');
const client = new Client({ authStrategy: new LocalAuth({ clientId }) });

// Sesudah (wppconnect)
const wppconnect = require('@wppconnect-team/wppconnect');
const client = await wppconnect.create({
    session: clientId,
    headless: true,
    devtools: false,
    useChrome: true,
    puppeteerOptions: {
        args: ['--no-sandbox', '--single-process', ...]
    }
});
```

**Files yang perlu diubah:**
- `src/whatsapp_service.js` — ganti Client class
- `src/events/message_handler.js` — sesuaikan event names dan message API
- `package.json` — ganti dependency

### Opsi B: Inject WA-JS ke Instance whatsapp-web.js (Advanced)
Tetap pakai `whatsapp-web.js`, tapi inject `wppconnect-wa.js` ke instance Puppeteer yang sudah berjalan untuk akses fitur tambahan.

**Kelebihan:** Minimal perubahan pada kode existing
**Kekurangan:** Dua library bersamaan → lebih complex, potensi conflict

### Opsi C: wppconnect-server sebagai Backend (Paling Cepat)
Pakai `wppconnect-server` yang sudah jadi (REST API) sebagai backend WA, mirip cara kita pakai RocketChat tapi dengan kapabilitas penuh.

**Kelebihan:** Zero code change untuk core logic
**Kekurangan:** Satu server lagi yang harus dikelola

---

## Fitur WA-JS yang Akan Diintegrasikan

Berdasarkan analisis proyek ini, berikut fitur WA-JS yang **paling relevan** dan **berdampak tinggi**:

### Priority 1 — Langsung Berguna
1. **Reaksi Emoji** → AI bisa kasih 👍 atau ❤️ sebagai acknowledgment ringan tanpa reply teks
2. **Label Bisnis** → AI bisa auto-label customer berdasarkan status (new, follow-up, done)
3. **LID Support** → Fix masalah nomor WA yang gagal teridentifikasi pada network baru

### Priority 2 — Enhancement Signifikan
4. **Forward Pesan** → Operator bisa forward pesan ke tim internal langsung dari dashboard
5. **Grup Management** → Auto-add customer yang deal ke grup komunitas/promo
6. **Quote Reply yang Presisi** → AI bisa reply spesifik ke pesan tertentu, bukan hanya pesan terakhir

### Priority 3 — Masa Depan
7. **Community Management** → Kelola komunitas WA (jika bisnis skala lebih besar)
8. **Story Viewer** → Monitor story pelanggan untuk insight market

---

## Langkah Migrasi ke wppconnect

### Fase 1: Research & Testing (Minggu 1-2)
- [x] Install `@wppconnect/wa-js` di environment lokal
- [x] Test koneksi dasar lokal sampai server ready; scan QR/traffic WA nyata tetap perlu diuji pengguna pada perangkat aktif
- [x] Verifikasi event-event yang dipakai (`message`, `qr`, `authenticated`, `ready`, `disconnected`) tetap memakai WWebJS bridge
- [x] Test path kode fitur baru: reaksi emoji via `WPP.chat.sendReactionToMessage` dengan fallback WWebJS
- [x] Implementasi path label WA-JS; uji label pada sesi WA Business nyata tetap menjadi checklist operasional

### Fase 2: Adapter Layer (Minggu 3)
- [x] Buat `src/services/wajs_bridge.js` sebagai adapter hybrid WA-JS
- [x] Integrasikan ke `src/whatsapp_service.js` saat client `ready`
- [x] Tambah endpoint observability `GET /api/system/wa-js`
- [x] Tambah action bridge `requestPhoneNumber`, labels, reaction by id, dan forward message
- [ ] Buat `src/whatsapp_service_v2.js` jika diputuskan migrasi penuh ke `@wppconnect-team/wppconnect`

### Fase 3: Migration (Minggu 4)
- [ ] Switch `index.js` ke pakai v2
- [ ] Hapus whatsapp-web.js dari dependencies
- [ ] Update `package.json`
- [ ] Test menyeluruh dengan traffic nyata (minimal 1 hari)

### Fase 4: Feature Unlocking (Setelah stabil)
- [x] Implementasikan reaksi emoji di `message_handler.js`
- [x] Implementasikan auto-label non-blocking via `WPP.labels.*`
- [x] Implementasikan LID support: safe display name + request phone action
- [ ] Implementasikan fitur grup management (jika dibutuhkan)

---

## Implementasi Aktual 2026-05-19

Dipilih jalur **Opsi B: Inject WA-JS ke instance WWebJS** untuk meminimalkan risiko regresi.

Files:
- `package.json` / `package-lock.json`: tambah `@wppconnect/wa-js`.
- `src/services/wajs_bridge.js`: inject bundle, cek status, helper reaction, request phone, label CRUD, apply/remove labels, dan forward message.
- `src/whatsapp_service.js`: inject WA-JS setelah client `ready`.
- `src/events/message_handler.js`: reaksi emoji non-blocking untuk media/sticker dan auto-label inbound.
- `src/services/dashboard_service.js`: endpoint `GET /api/system/wa-js` dan endpoint WA-JS CRM.
- `src/utils/contact_identity.js`: identitas kontak aman untuk `@lid` dan tipe chat non-customer.

Catatan: core masih WWebJS. Migrasi penuh ke WPPConnect wrapper tetap menjadi item terpisah karena perlu uji QR/session nyata dan soak test produksi.

## Update 2026-05-20

- LID support sekarang mencoba resolve nomor asli dengan `WPP.contact.getPnLidEntry`.
- Jika mapping LID -> phone belum ada di cache WhatsApp lokal, tombol telepon memanggil `WPP.chat.requestPhoneNumber`.
- Adapter WA-JS punya fallback inline injection jika `addScriptTag` gagal pada WhatsApp Web tertentu.
- Typing indicator diperkuat dengan heartbeat: WWebJS `sendStateTyping()` tetap dipakai, dan WA-JS `WPP.chat.markIsComposing` dicoba hanya jika `WPP` sudah ready agar tidak menunggu injeksi ulang saat membalas customer.
- Dashboard sekarang punya pengelola label WhatsApp: list label, buat label, edit, hapus, serta tempel/lepas label pada chat aktif.
- AI auto-label dari `BotAgent.auto_labels` dieksekusi via `tambahkan_label_chat` dengan urutan parameter WA-JS yang benar dan fallback non-blocking.

## Update 2026-05-23

- Memigrasikan fungsi inti *message syncing* dari `whatsapp-web.js` ke WA-JS sepenuhnya untuk menghindari error `waitForChatLoading` yang sering membuat web dashboard menjadi kosong.
- `wajs_bridge.js` sekarang memiliki implementasi API `getChats` dan `getMessages` yang membungkus pemanggilan dari internal `window.WPP.chat`. 
- `whatsapp_service.js` diperbarui untuk memanfaatkan WA-JS sebagai layer primer dalam proses inisialisasi awal (startup) sinkronisasi history pesan, dengan WWebJS digunakan murni sebagai *fallback* jika `WA-JS` tidak merespon/aktif.
- Modifikasi objek message WA-JS agar kompatibel 100% dengan kebutuhan `message_handler.js`, termasuk bypassing `downloadMedia` otomatis pada saat startup syncing.
- Metadata quoted reply dari WA-JS/WWebJS sekarang dipetakan ke `ChatMessages`, sehingga dashboard bisa menampilkan pesan asal yang sedang dibalas.
- Manual reply dashboard mengirim `quotedMessageId` saat operator memilih pesan asal, jadi konteks reply tetap terbaca di WhatsApp dan CRM.

## Update 2026-05-23 Malam

- `getChats` disesuaikan dengan WA-JS v4.2.0: adapter memakai `WPP.chat.list()` sebagai jalur utama, bukan `WPP.chat.getChats` yang tidak selalu tersedia.
- Mapping pesan WA-JS sekarang membungkus akses `quotedMsg`, `quotedMsgObj`, `quotedMsgId`, dan `quotedStanzaID` dengan safe getter. Pesan non-reply tidak boleh melempar `Message ... does not have a reply`.
- Fallback WWebJS `fetchMessages()` hanya dipakai jika WA-JS benar-benar kosong/gagal, sehingga risiko `waitForChatLoading` jauh lebih kecil.
- Recovery browser dipisah dari logout manual: health check hanya destroy/relaunch runtime dan mempertahankan sesi login.

---

## Perhatian Keamanan (ToS Risk)

> ⚠️ **WA-JS bukan produk resmi Meta.** Penggunaan berada di area abu-abu dari segi Terms of Service WhatsApp.

### Mitigasi Risiko:
1. **Delay antar pesan** — selalu ada typing delay + jeda natural (sudah implementasi)
2. **Volume kontrol** — jangan blast ke ribuan nomor sekaligus
3. **Nomor yang "hangat"** — nomor yang sudah lama dipakai lebih aman dari baru
4. **Avoid suspicious patterns** — jangan kirim pesan identik ke banyak nomor
5. **Fokus inbound** — sistem kita lebih banyak terima & balas (lebih aman dari outbound blast)

### Untuk skala besar, pertimbangkan WhatsApp Business API (resmi Meta):
- Berbayar (per message/per conversation)
- Perlu verifikasi bisnis
- Aman secara legal
- Cocok untuk pengiriman notifikasi massal terverifikasi
