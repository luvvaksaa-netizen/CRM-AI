# REST API Reference — WA-AI-CS Dashboard

> **Base URL:** `http://localhost:3000`  
> **Auth:** Session cookie (`ADMIN_USER` / `ADMIN_PASS` dari `.env`)  
> **Real-time:** Socket.io (`/socket.io`)

---

## Autentikasi

### POST `/api/login`
Login ke dashboard.
```json
// Request
{ "user": "admin", "pass": "admin123" }

// Response (200)
{ "success": true, "message": "Login berhasil!" }

// Response (401)
{ "success": false, "message": "Username atau password salah." }
```

### GET `/api/logout`
Logout dan redirect ke `/login.html`.

---

## Agent APIs

### GET `/api/agents`
Ambil semua Bot Agent.
```json
// Response
[
  {
    "id": 1,
    "name": "Agen Toko A",
    "bot_name": "Reza CS",
    "system_prompt": "...",
    "product_knowledge": "..."
  }
]
```

### POST `/api/agents`
Buat Agent baru.
```json
// Request
{
  "name": "Agen Baru",
  "bot_name": "CS Bot",
  "system_prompt": "Kamu adalah CS yang ramah...",
  "product_knowledge": "Kami menjual..."
}
```

### PUT `/api/agents/:id`
Update Agent.

### DELETE `/api/agents/:id`
Hapus Agent + semua media + unbind Stores.

---

## Store APIs

### GET `/api/stores`
Ambil semua Store dengan status real-time.
```json
// Response
[
  {
    "wa_id": "toko-a-1234",
    "name": "Toko A",
    "agent_id": 1,
    "is_bot_active": true,
    "connection_mode": "wwebjs",
    "status": "Dihubungkan (Online)"
  }
]
```

### POST `/api/stores`
Tambah Store baru (otomatis launch WA client browser).
```json
// Request
{
  "name": "Toko Baru",
  "agent_id": 1
}
```

### DELETE `/api/stores/:id`
Hapus Store + semua histori chat + logout sesi WA.

### POST `/api/stores/:id/logout`
Putuskan koneksi WA tanpa hapus data.

### GET `/api/settings/:storeId`
Ambil konfigurasi lengkap satu Store.

### POST `/api/settings/:storeId`
Update konfigurasi Store (agent binding, bot toggle).
```json
// Request
{
  "agent_id": "1",
  "is_bot_active": true
}

// Response (200)
{
  "success": true,
  "store": {
    "wa_id": "dhea-6466",
    "name": "Dhea",
    "agent_id": 1,
    "is_bot_active": true
  }
}

// Response (403 — role bukan admin)
{ "success": false, "message": "Akses ditolak untuk role ini." }
```
Server me-log detail perubahan: `[Settings] dhea-6466 updated: {"is_bot_active":true}`

---

## Human Override (Pause Control)

### GET `/api/stores/:id/contacts/:contactId/pause`
Cek apakah bot sedang di-pause untuk kontak ini.
```json
{ "isPaused": false }
```

### POST `/api/stores/:id/contacts/:contactId/pause`
Toggle pause bot untuk satu kontak.
```json
// Request
{ "isPaused": true }

// Response
{ "success": true, "isPaused": true }
```

---

## Chat APIs

### GET `/api/chat/:storeId`
Ambil histori chat. Tambahkan `?contactId=6281xxx@s.whatsapp.net` untuk filter per kontak.
```json
// Response
[
  {
    "id": 1,
    "store_wa_id": "toko-a-1234",
    "contact_id": "6281234567890@s.whatsapp.net",
    "sender_name": "Budi",
    "body": "Halo, mau tanya soal harga",
    "is_from_me": false,
    "timestamp": "2026-05-19T10:00:00Z"
  }
]
```
Limit default: 50 pesan jika ada filter `contactId`, 100 jika tidak.

Pagination/infinite scroll:
```
GET /api/chat/:storeId?contactId=6281xxx@s.whatsapp.net&paginated=true&limit=50&before=2026-05-19T10:00:00.000Z
```

Response paginated:
```json
{
  "messages": [],
  "pagination": {
    "limit": 50,
    "hasMore": true,
    "nextBefore": "2026-05-19T10:00:00.000Z"
  }
}
```

### GET `/api/summaries`
Ambil semua rekap percakapan (long-term memory AI).

### POST `/api/send`
Kirim pesan teks manual dari dashboard.
```json
{ "storeId": "toko-a-1234", "to": "6281234567890@c.us", "body": "Halo kak!" }
```
Catatan:
- `to` boleh berupa `628xxx`, `08xxx`, `628xxx@c.us`, `628xxx@s.whatsapp.net`, atau existing chat id `xxxxx@lid`.
- Endpoint memakai rate limit 30 request/menit dan menolak pesan di atas 4000 karakter.

### POST `/api/send-media`
Kirim media katalog manual dari dashboard.
```json
{ "storeId": "toko-a-1234", "to": "6281234567890@c.us", "mediaId": 3 }
```
Endpoint memakai validasi nomor WA dan rate limit yang sama dengan `/api/send`.

---

## WA-JS CRM APIs

Endpoint berikut butuh session WA online dan WA-JS berhasil aktif. Jika akun bukan WhatsApp Business atau WhatsApp Web mengubah API internal, endpoint akan mengembalikan error aman tanpa mematikan bot.

### POST `/api/stores/:storeId/contacts/:contactId/request-phone`
Resolve nomor asli kontak `@lid`. Sistem mencoba `WPP.contact.getPnLidEntry` dulu; jika nomor belum ada di cache lokal, baru mengirim request lewat `WPP.chat.requestPhoneNumber`.
```json
{
  "success": true,
  "resolved": true,
  "requested": false,
  "phone": "6281234567890"
}
```
Endpoint ini boleh dipakai role `viewer`, `operator`, dan `admin` karena fungsinya enrichment identitas kontak; endpoint kirim pesan/media tetap dibatasi `operator`/`admin`.

### GET `/api/stores/:storeId/labels`
Ambil semua label WhatsApp Business via `WPP.labels.getAllLabels`.

### POST `/api/stores/:storeId/labels`
Buat label baru via `WPP.labels.addNewLabel`.
```json
{ "name": "Follow Up", "color": "#22c55e" }
```

### POST `/api/stores/:storeId/contacts/:contactId/labels`
Tambah atau hapus label pada chat via `WPP.labels.addOrRemoveLabels`.
```json
{ "labelId": "76", "type": "add" }
```
Atau batch:
```json
{
  "operations": [
    { "labelId": "76", "type": "add" },
    { "labelId": "75", "type": "remove" }
  ]
}
```

### POST `/api/stores/:storeId/messages/reaction`
Kirim/hapus reaksi pada pesan tersimpan via `WPP.chat.sendReactionToMessage`.
```json
{ "messageId": "false_628xxx@c.us_ABCDEF", "emoji": "👍" }
```

### POST `/api/stores/:storeId/messages/forward`
Forward satu atau banyak pesan via `WPP.chat.forwardMessages`.
```json
{
  "to": "6281234567890@c.us",
  "messageIds": ["false_628xxx@c.us_ABCDEF"],
  "displayCaptionText": true
}
```

---

## Media APIs

### GET `/api/media/:agentId`
Ambil semua media milik agen tertentu.

### POST `/api/media/:agentId`
Upload media baru (multipart/form-data).

| Field | Type | Keterangan |
|-------|------|------------|
| `file` | File | File gambar/video (max 16MB) |
| `label` | String | Nama/judul media |
| `description` | String | Deskripsi manual |
| `purpose` | String | `both`/`knowledge_only`/`send_only` |

Upload bersifat **non-blocking**: file langsung terdaftar, analisis AI berjalan di background.

### PUT `/api/media/:agentId/:id`
Update detail media (label, deskripsi, purpose, trigger_words, ai_analysis override).

### DELETE `/api/media/:agentId/:id`
Hapus media (DB record + file fisik).

---

## System APIs

### GET `/api/system/backups`
Daftar file backup SQLite yang tersedia.

### GET `/api/system/backups/:name`
Download backup SQLite tertentu.

### GET `/api/system/logs`
Download file `logs/app.log` untuk debugging.

### GET `/api/system/wa-js`
Cek status WA-JS hybrid runtime.
```json
{
  "packageInstalled": true,
  "stores": [
    {
      "storeId": "toko-a-1234",
      "enabled": true,
      "installed": true,
      "injected": true,
      "runtime": "WA-JS + WWebJS"
    }
  ]
}
```

### GET `/api/session`
Cek user session aktif dan role.
```json
{ "user": "admin", "role": "admin" }
```

---

## Socket.io Events

### Server → Client

| Event | Payload | Keterangan |
|-------|---------|------------|
| `newMessage` | `{ storeId, msg }` | Pesan baru masuk/keluar |
| `statusUpdate` | `{ storeId, status }` | Status koneksi WA berubah |
| `qrUpdate` | `{ storeId, qr }` | QR Code baru untuk di-scan |
| `allStatuses` | `{ storeId: status }` | Status semua store saat connect |
| `sysLog` | `{ type, msg, time }` | Log sistem real-time |
| `sysStats` | `{ ram, cpu }` | Statistik sistem (setiap 10 detik) |
| `mediaUpdated` | `{ agentId }` | Media library berubah |
| `mediaAnalysisReady` | `{ agentId, assetId }` | Analisis AI selesai |
| `typingStatus` | `{ storeId, contactId, isTyping }` | AI sedang mengetik |
| `storeUpdated` | `{ storeId }` | Konfigurasi store berubah |
