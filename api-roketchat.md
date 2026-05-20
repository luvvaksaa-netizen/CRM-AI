# API Kirim Pesan (Unofficial WhatsApp)

Layanan kirim pesan via WhatsApp (unofficial). Semua request **POST** dengan body JSON. Autentikasi via API key dari Sessions.

---

## Base URL

`https://roketchat.com/api/v1/messages`

---

## Autentikasi

- **Format token:** `deviceId.secret` (dari Sessions → API Keys).
- **Cara kirim:** header `token` **atau** key `token` di body JSON.
- **401 Unauthorized:** body `{ "error": "Invalid token" }`. Jangan log atau expose API key.

Contoh header:
```
token: <deviceId>.<secret>
```

Contoh di body:
```json
{ "phone": "6281234567890", "body": "Halo", "token": "<deviceId>.<secret>" }
```

---

## Aturan umum

- **Content-Type:** `application/json`
- **Response 200:** sukses, body `{ "code": 200, "success": true, "data": { "Details": "Sent", "Id": "...", "Timestamp": "..." } }`
- **Response 400:** body `{ "error": "Invalid JSON" }` atau `{ "error": "..." }` (gagal fetch URL media)
- **Response 401:** body `{ "error": "Invalid token" }`
- **Response 422:** body `{ "error": "Validation failed", "details": { ... } }`
- **Nomor telepon:** `phone` selalu tanpa tanda + (contoh: `6281234567890`)

---

## Media (image, document, video, audio, sticker)

- **Format:** base64 data URI (`data:<mime>;base64,...`) **atau** URL publik (http/https).
- **Maksimal ukuran:** 16MB.
- **Timeout fetch URL:** 30 detik (untuk image).

---

## Endpoint lengkap

### 1. Kirim teks — POST `https://roketchat.com/api/v1/messages/text`

| Field   | Type   | Wajib | Keterangan        |
|---------|--------|-------|--------------------|
| phone   | string | ya    | Nomor tanpa +      |
| body    | string | ya    | Isi pesan teks    |
| token   | string | ya*   | *Bisa di header    |

---

### 2. Kirim gambar — POST `https://roketchat.com/api/v1/messages/image`

| Field   | Type   | Wajib | Keterangan                    |
|---------|--------|-------|-------------------------------|
| phone   | string | ya    | Nomor tanpa +                 |
| image   | string | ya    | base64 data URI atau URL      |
| caption | string | tidak | Teks di bawah gambar         |
| token   | string | ya*   | *Bisa di header               |

Format image: JPEG/PNG dll. Maks 16MB, timeout fetch URL 30s.

---

### 3. Kirim dokumen — POST `https://roketchat.com/api/v1/messages/document`

| Field     | Type   | Wajib | Keterangan               |
|-----------|--------|-------|--------------------------|
| phone     | string | ya    | Nomor tanpa +            |
| document  | string | ya    | base64 data URI atau URL |
| fileName  | string | ya    | Nama file (contoh: file.pdf) |
| token     | string | ya*   | *Bisa di header          |

Maks 16MB.

---

### 4. Kirim video — POST `https://roketchat.com/api/v1/messages/video`

| Field   | Type   | Wajib | Keterangan               |
|---------|--------|-------|--------------------------|
| phone   | string | ya    | Nomor tanpa +            |
| video   | string | ya    | base64 data URI atau URL (mp4/3gpp) |
| caption | string | tidak | Teks di bawah video      |
| token   | string | ya*   | *Bisa di header          |

Maks 16MB.

---

### 5. Kirim audio — POST `https://roketchat.com/api/v1/messages/audio`

| Field   | Type   | Wajib | Keterangan               |
|---------|--------|-------|--------------------------|
| phone   | string | ya    | Nomor tanpa +            |
| audio   | string | ya    | base64 data URI atau URL (Opus/ogg) |
| token   | string | ya*   | *Bisa di header          |

Maks 16MB.

---

### 6. Kirim stiker — POST `https://roketchat.com/api/v1/messages/sticker`

| Field   | Type   | Wajib | Keterangan               |
|---------|--------|-------|--------------------------|
| phone   | string | ya    | Nomor tanpa +            |
| sticker | string | ya    | base64 data URI atau URL (image/webp atau video/mp4 untuk animasi) |
| token   | string | ya*   | *Bisa di header          |

Maks 16MB.

---

### 7. Kirim lokasi — POST `https://roketchat.com/api/v1/messages/location`

| Field     | Type   | Wajib | Keterangan      |
|-----------|--------|-------|-----------------|
| phone     | string | ya    | Nomor tanpa +   |
| latitude  | number | ya    | Koordinat       |
| longitude | number | ya    | Koordinat       |
| name      | string | tidak | Label lokasi    |
| token     | string | ya*   | *Bisa di header |

---

### 8. Kirim kontak — POST `https://roketchat.com/api/v1/messages/contact`

| Field   | Type   | Wajib | Keterangan           |
|---------|--------|-------|----------------------|
| phone   | string | ya    | Nomor tujuan tanpa + |
| name    | string | tidak | Nama tampilan        |
| vcard   | string | ya    | Format VCARD 3.0     |
| token   | string | ya*   | *Bisa di header      |

Contoh vcard:
```
BEGIN:VCARD
VERSION:3.0
FN:Nama
TEL;type=CELL:6281234567890
END:VCARD
```

---

# Webhook Pesan Masuk

Setiap pesan WhatsApp yang masuk ke sesi dapat diteruskan secara real-time ke URL eksternal (server, n8n, Make, dsb.) melalui HTTP POST.

## Cara Konfigurasi

1. Buka halaman **Sessions**
2. Klik ikon **Webhook** pada baris sesi
3. Isi **Webhook URL** — endpoint yang akan menerima notifikasi
4. *(Opsional)* Isi **HMAC Secret** untuk verifikasi keaslian request

## Format Payload

Request dikirim sebagai `POST` dengan `Content-Type: application/json`.

```json
{
  "event": "message",
  "deviceId": "<deviceId>",
  "jid": "628xxx@s.whatsapp.net",
  "from": "6281234567890@s.whatsapp.net",
  "chat_id": "6281234567890@s.whatsapp.net",
  "body": "Halo, saya ingin bertanya tentang produk",
  "waMessageId": "ABCDEF1234",
  "timestamp": "2025-04-17T10:00:00.000Z"
}
```

| Field        | Type   | Keterangan                            |
|--------------|--------|---------------------------------------|
| event        | string | Selalu `"message"`                  |
| deviceId     | string | ID device/sesi penerima               |
| jid          | string | JID WhatsApp sesi (nomor bot)         |
| from         | string | JID pengirim pesan                    |
| chat_id      | string | JID chat (sama dengan from untuk DM)  |
| body         | string | Isi teks pesan (atau `[media]`)     |
| waMessageId  | string | ID unik pesan dari WhatsApp           |
| timestamp    | string | Waktu pengiriman (ISO 8601)           |

## Verifikasi HMAC (opsional)

Jika HMAC Secret dikonfigurasi, setiap request menyertakan header:

```
X-Hub-Signature-256: sha256=<hex-digest>
```

Contoh verifikasi di Node.js:

```js
const crypto = require('crypto')

function verifySignature(rawBody, signature, secret) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex')
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  )
}
```

## Catatan Pengiriman

- Webhook dikirim secara **fire-and-forget** — tidak ada retry jika URL tidak merespons.
- Server harus membalas dengan status **2xx**.
- Hanya pesan **masuk** yang dikirim — pesan dari dirimu sendiri diabaikan.
- Pesan **grup** dan **broadcast** tidak dikirim ke webhook.
