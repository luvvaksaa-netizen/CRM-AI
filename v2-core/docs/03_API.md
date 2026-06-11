# Dokumentasi API - v2-core

**Base URL:** `http://localhost:3002/api`  
**Port:** 3002  
**Format Respons:** JSON

---

## Daftar Isi

1. [Autentikasi](#1-autentikasi)
2. [Kesehatan (Public)](#2-kesehatan-public)
3. [Agen (Agents)](#3-agen-agents)
4. [Analitik (Analytics)](#4-analitik-analytics)
5. [Chat / Percakapan](#5-chat--percakapan)
6. [Toko (Stores)](#6-toko-stores)
7. [Tindak Lanjut (Follow-ups)](#7-tindak-lanjut-follow-ups)
8. [Media](#8-media)
9. [Ringkasan (Summaries)](#9-ringkasan-summaries)
10. [Penutupan (Closing)](#10-penutupan-closing)
11. [Pembelajaran (Learning)](#11-pembelajaran-learning)
12. [Label Cerdas (Smart Labels)](#12-label-cerdas-smart-labels)
13. [Aktivasi Bot (Bot Activation)](#13-aktivasi-bot-bot-activation)
14. [Pengaturan (Settings)](#14-pengaturan-settings)

---

## 1. Autentikasi

### POST /api/auth/login

Melakukan login pengguna. **Rate limited:** 10 permintaan per 15 menit.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | Tidak |
| **Role** | -- |
| **Rate Limit** | 10 req / 15 menit |

**Request Body:**

| Field | Tipe | Deskripsi |
|---|---|---|
| `user` | `string` | Nama pengguna |
| `pass` | `string` | Kata sandi |

**Contoh Request:**
```json
{
  "user": "admin",
  "pass": "secret123"
}
```

**Contoh Respons (200):**
```json
{
  "success": true,
  "token": "eyJhbG...NiIs...",
  "role": "admin"
}
```

**Contoh Respons (401):**
```json
{
  "success": false,
  "message": "Kredensial tidak valid"
}
```

**Contoh Respons (429 -- Rate Limit):**
```json
{
  "success": false,
  "message": "Terlalu banyak permintaan. Coba lagi nanti."
}
```

---

### GET /api/auth/session

Mendapatkan informasi sesi pengguna yang sedang login.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Contoh Respons (200):**
```json
{
  "user": "admin",
  "role": "admin"
}
```

---

## 2. Kesehatan (Public)

### GET /health

Pemeriksaan kesehatan server. Tidak memerlukan JWT.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | Tidak |
| **Role** | -- |

**Contoh Respons (200):**
```json
{
  "status": "ok",
  "timestamp": "2025-06-08T12:00:00.000Z"
}
```

---

### /uploads

Sajian file statis untuk berkas unggahan (media, dll). Akses langsung melalui URL.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | Tidak |
| **Role** | -- |

---

## 3. Agen (Agents)

Semua route di bawah ini memerlukan **JWT** di header `Authorization: Bearer ***`."

### GET /api/agents

Mendapatkan daftar semua agen.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Contoh Respons (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Agen 1",
      "phone": "628123456789",
      "is_active": true
    }
  ]
}
```

---

### POST /api/agents

Membuat agen baru. **Hanya admin.**

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `admin` |

**Request Body:**

| Field | Tipe | Deskripsi |
|---|---|---|
| `name` | `string` | Nama agen |
| `phone` | `string` | Nomor telepon |

**Contoh Request:**
```json
{
  "name": "Agen Baru",
  "phone": "628987654321"
}
```

**Contoh Respons (201):**
```json
{
  "success": true,
  "message": "Agen berhasil dibuat",
  "data": {
    "id": 2,
    "name": "Agen Baru",
    "phone": "628987654321",
    "is_active": true
  }
}
```

---

### PUT /api/agents/:id

Memperbarui data agen. **Hanya admin.**

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `admin` |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `id` | `integer` | ID agen |

**Request Body (sebagian atau seluruhnya):**

| Field | Tipe | Deskripsi |
|---|---|---|
| `name` | `string` | Nama agen (opsional) |
| `phone` | `string` | Nomor telepon (opsional) |
| `is_active` | `boolean` | Status aktif (opsional) |

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "Agen berhasil diperbarui",
  "data": {
    "id": 1,
    "name": "Agen Diperbarui",
    "phone": "628123456789",
    "is_active": false
  }
}
```

---

### DELETE /api/agents/:id

Menghapus agen beserta toko dan media terkait (cascade). **Hanya admin.**

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `admin` |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `id` | `integer` | ID agen |

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "Agen beserta data terkait berhasil dihapus"
}
```

---

## 4. Analitik (Analytics)

Semua route di bawah ini memerlukan **JWT**.

### GET /api/analytics/overview

Statistik dasbor secara keseluruhan.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Parameter Query:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `store_wa_id` | `string` | ID WhatsApp toko (opsional) |
| `startDate` | `string` | Tanggal awal (YYYY-MM-DD, opsional) |
| `endDate` | `string` | Tanggal akhir (YYYY-MM-DD, opsional) |

**Contoh Respons (200):**
```json
{
  "success": true,
  "data": {
    "total_conversations": 1250,
    "total_leads": 340,
    "total_followups": 89,
    "conversion_rate": 27.2
  }
}
```

---

### GET /api/analytics/leads

Daftar prospek (leads).

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Parameter Query:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `store_wa_id` | `string` | ID WhatsApp toko (opsional) |
| `label` | `string` | Filter label (opsional) |
| `startDate` | `string` | Tanggal awal (YYYY-MM-DD, opsional) |
| `endDate` | `string` | Tanggal akhir (YYYY-MM-DD, opsional) |

**Contoh Respons (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Budi",
      "phone": "628111111111",
      "label": "hot",
      "created_at": "2025-06-01T10:00:00.000Z"
    }
  ]
}
```

---

### GET /api/analytics/followups

Statistik tindak lanjut (follow-up).

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Parameter Query:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `store_wa_id` | `string` | ID WhatsApp toko (opsional) |

**Contoh Respons (200):**
```json
{
  "success": true,
  "data": {
    "pending": 12,
    "completed": 45,
    "cancelled": 3,
    "total": 60
  }
}
```

---

### GET /api/analytics/learning

Analitik pembelajaran AI.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Parameter Query:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `store_wa_id` | `string` | ID WhatsApp toko (opsional) |
| `limit` | `integer` | Jumlah data (opsional) |

**Contoh Respons (200):**
```json
{
  "success": true,
  "data": [
    {
      "pattern": "salam",
      "count": 150,
      "accuracy": 0.95
    }
  ]
}
```

---

## 5. Chat / Percakapan

Semua route di bawah ini memerlukan **JWT**. Beberapa memiliki batasan role tambahan.

### GET /api/chat/:storeId

Mendapatkan riwayat pesan untuk satu toko.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `storeId` | `integer` | ID toko |

**Parameter Query:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `contactId` | `string` | ID kontak (opsional) |
| `limit` | `integer` | Batas jumlah pesan (default: 50) |
| `before` | `string` | Kursor untuk paginasi (timestamp/ID) |
| `paginated` | `boolean` | Aktifkan paginasi (opsional) |

**Contoh Respons (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 101,
      "from": "customer",
      "message": "Halo, ada stok?",
      "timestamp": "2025-06-08T10:00:00.000Z"
    }
  ],
  "pagination": {
    "has_more": true,
    "cursor": "2025-06-08T10:00:00.000Z"
  }
}
```

---

### GET /api/chat/:storeId/contacts

Mendapatkan daftar kontak dengan pesan terakhir untuk satu toko.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `storeId` | `integer` | ID toko |

**Contoh Respons (200):**
```json
{
  "success": true,
  "data": [
    {
      "contactId": "628111111111@c.us",
      "name": "Budi",
      "last_message": "Halo, ada stok?",
      "last_time": "2025-06-08T10:00:00.000Z",
      "unread_count": 2
    }
  ]
}
```

---

### POST /api/chat/:storeId/:contactId/read

Menandai pesan sebagai sudah dibaca.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `storeId` | `integer` | ID toko |
| `contactId` | `string` | ID kontak |

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "Pesan ditandai sudah dibaca"
}
```

---

### POST /api/chat/:storeId/send

Mengirim pesan ke kontak. **Rate limited:** 30 permintaan per menit. **Role:** operator atau admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `operator`, `admin` |
| **Rate Limit** | 30 req / menit |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `storeId` | `integer` | ID toko |

**Request Body:**

| Field | Tipe | Deskripsi |
|---|---|---|
| `contactId` | `string` | ID kontak tujuan |
| `message` | `string` | Isi pesan |

**Contoh Request:**
```json
{
  "contactId": "628111111111@c.us",
  "message": "Selamat siang, ada yang bisa dibantu?"
}
```

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "Pesan berhasil dikirim"
}
```

---

### POST /api/chat/:storeId/send-media

Mengirim media (gambar, dokumen, dll.) ke kontak. **Role:** operator atau admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `operator`, `admin` |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `storeId` | `integer` | ID toko |

**Request Body:** `multipart/form-data`

| Field | Tipe | Deskripsi |
|---|---|---|
| `contactId` | `string` | ID kontak tujuan |
| `media` | `file` | Berkas media |

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "Media berhasil dikirim"
}
```

---

### POST /api/chat/:storeId/:contactId/pause

Menjeda AI untuk kontak tertentu. **Role:** operator atau admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `operator`, `admin` |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `storeId` | `integer` | ID toko |
| `contactId` | `string` | ID kontak |

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "AI dijeda untuk kontak ini"
}
```

---

### POST /api/chat/:storeId/:contactId/unpause

Melanjutkan AI untuk kontak tertentu. **Role:** operator atau admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `operator`, `admin` |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `storeId` | `integer` | ID toko |
| `contactId` | `string` | ID kontak |

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "AI dilanjutkan untuk kontak ini"
}
```

---

### POST /api/chat/:storeId/:contactId/request-phone

Meminta nomor telepon dari kontak. **Role:** operator atau admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `operator`, `admin` |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `storeId` | `integer` | ID toko |
| `contactId` | `string` | ID kontak |

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "Permintaan nomor telepon dikirim"
}
```

---

### DELETE /api/chat/:storeId/:contactId

Menghapus seluruh riwayat chat dengan kontak. **Role:** admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `admin` |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `storeId` | `integer` | ID toko |
| `contactId` | `string` | ID kontak |

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "Riwayat chat berhasil dihapus"
}
```

---

### POST /api/chat/:storeId/messages/reaction

Mengirim reaksi ke pesan. **Role:** operator atau admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `operator`, `admin` |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `storeId` | `integer` | ID toko |

**Request Body:**

| Field | Tipe | Deskripsi |
|---|---|---|
| `messageId` | `string` | ID pesan |
| `emoji` | `string` | Emoji reaksi |

**Contoh Request:**
```json
{
  "messageId": "msg_12345",
  "emoji": ":thumbsup:"
}
```

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "Reaksi berhasil dikirim"
}
```

---

### POST /api/chat/:storeId/messages/forward

Meneruskan pesan ke kontak lain. **Role:** operator atau admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `operator`, `admin` |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `storeId` | `integer` | ID toko |

**Request Body:**

| Field | Tipe | Deskripsi |
|---|---|---|
| `messageId` | `string` | ID pesan asal |
| `toContactId` | `string` | ID kontak tujuan |

**Contoh Request:**
```json
{
  "messageId": "msg_12345",
  "toContactId": "628222222222@c.us"
}
```

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "Pesan berhasil diteruskan"
}
```

---

## 6. Toko (Stores)

Semua route di bawah ini memerlukan **JWT**.

### GET /api/stores

Mendapatkan daftar semua toko.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Contoh Respons (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Toko A",
      "wa_id": "628123456789",
      "is_connected": true,
      "agent_id": 1
    }
  ]
}
```

---

### POST /api/stores

Membuat toko baru. **Role:** admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `admin` |

**Request Body:**

| Field | Tipe | Deskripsi |
|---|---|---|
| `name` | `string` | Nama toko |
| `agent_id` | `integer` | ID agen penanggung jawab |
| `wa_id` | `string` | Nomor WhatsApp (opsional) |

**Contoh Request:**
```json
{
  "name": "Toko Baru",
  "agent_id": 1,
  "wa_id": "628987654321"
}
```

**Contoh Respons (201):**
```json
{
  "success": true,
  "message": "Toko berhasil dibuat",
  "data": {
    "id": 2,
    "name": "Toko Baru",
    "wa_id": "628987654321",
    "is_connected": false,
    "agent_id": 1
  }
}
```

---

### POST /api/stores/prepare-qr

Menyiapkan kode QR untuk menghubungkan perangkat WhatsApp. **Role:** admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `admin` |

**Request Body:**

| Field | Tipe | Deskripsi |
|---|---|---|
| `store_id` | `integer` | ID toko |

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "QR siap dipindai",
  "data": {
    "qr_code": "data:image/png;base64,..."
  }
}
```

---

### POST /api/stores/cancel-qr

Membatalkan pembuatan kode QR. **Role:** admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `admin` |

**Request Body:**

| Field | Tipe | Deskripsi |
|---|---|---|
| `store_id` | `integer` | ID toko |

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "Pembuatan QR dibatalkan"
}
```

---

### PUT /api/stores/:id

Memperbarui data toko. **Role:** admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `admin` |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `id` | `integer` | ID toko |

**Request Body (sebagian atau seluruhnya):**

| Field | Tipe | Deskripsi |
|---|---|---|
| `name` | `string` | Nama toko (opsional) |
| `wa_id` | `string` | Nomor WhatsApp (opsional) |
| `agent_id` | `integer` | ID agen (opsional) |

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "Toko berhasil diperbarui",
  "data": {
    "id": 1,
    "name": "Toko A Updated",
    "wa_id": "628123456789",
    "agent_id": 2
  }
}
```

---

### DELETE /api/stores/:id

Menghapus toko. **Role:** admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `admin` |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `id` | `integer` | ID toko |

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "Toko berhasil dihapus"
}
```

---

### POST /api/stores/:id/logout

Logout perangkat WhatsApp toko. **Role:** admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `admin` |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `id` | `integer` | ID toko |

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "WhatsApp berhasil logout"
}
```

---

### POST /api/stores/:id/reconnect

Menghubungkan ulang perangkat WhatsApp toko. **Role:** admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `admin` |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `id` | `integer` | ID toko |

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "Proses koneksi ulang dimulai"
}
```

---

## 7. Tindak Lanjut (Follow-ups)

Semua route di bawah ini memerlukan **JWT**.

### GET /api/followups/stats/:storeId

Mendapatkan statistik tindak lanjut untuk satu toko.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `storeId` | `integer` | ID toko |

**Contoh Respons (200):**
```json
{
  "success": true,
  "data": {
    "total": 50,
    "pending": 10,
    "completed": 35,
    "cancelled": 5
  }
}
```

---

### GET /api/followups/:storeId

Mendapatkan daftar tindak lanjut untuk satu toko.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `storeId` | `integer` | ID toko |

**Parameter Query:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `status` | `string` | Filter status (pending, completed, cancelled) |
| `page` | `integer` | Halaman (default: 1) |
| `limit` | `integer` | Jumlah per halaman (default: 20) |

**Contoh Respons (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "contact": "628111111111@c.us",
      "message": "Halo, apakah tertarik?",
      "scheduled_at": "2025-06-09T10:00:00.000Z",
      "status": "pending"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 50,
    "total_pages": 3
  }
}
```

---

### POST /api/followups/cancel/:id

Membatalkan satu tindak lanjut. **Role:** operator atau admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `operator`, `admin` |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `id` | `integer` | ID follow-up |

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "Follow-up berhasil dibatalkan"
}
```

---

### POST /api/followups/emergency-cancel-all

Membatalkan semua tindak lanjut (darurat). **Role:** admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `admin` |

**Request Body:**

| Field | Tipe | Deskripsi |
|---|---|---|
| `store_wa_id` | `string` | ID WhatsApp toko (opsional, kosongkan untuk semua) |

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "Semua follow-up berhasil dibatalkan"
}
```

---

### GET /api/followups/config/:id

Mendapatkan konfigurasi follow-up untuk satu toko. **Role:** operator atau admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `operator`, `admin` |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `id` | `integer` | ID toko |

**Contoh Respons (200):**
```json
{
  "success": true,
  "data": {
    "store_id": 1,
    "enabled": true,
    "interval_hours": 24,
    "message_template": "Halo {{name}}, apakah anda tertarik?"
  }
}
```

---

### POST /api/followups/config/:id

Memperbarui konfigurasi follow-up. **Role:** admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `admin` |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `id` | `integer` | ID toko |

**Request Body:**

| Field | Tipe | Deskripsi |
|---|---|---|
| `enabled` | `boolean` | Aktifkan follow-up (opsional) |
| `interval_hours` | `integer` | Interval dalam jam (opsional) |
| `message_template` | `string` | Template pesan (opsional) |

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "Konfigurasi follow-up berhasil diperbarui"
}
```

---

### GET /api/followups/pipeline/:id

Mendapatkan pipeline follow-up. **Role:** operator atau admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `operator`, `admin` |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `id` | `integer` | ID toko |

**Contoh Respons (200):**
```json
{
  "success": true,
  "data": [
    {
      "stage": "new_lead",
      "label": "Prospek Baru",
      "order": 1,
      "count": 15
    },
    {
      "stage": "followed_up",
      "label": "Sudah Ditindaklanjuti",
      "order": 2,
      "count": 25
    }
  ]
}
```

---

### PUT /api/followups/pipeline/:id

Memperbarui pipeline follow-up. **Role:** admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `admin` |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `id` | `integer` | ID toko |

**Request Body:**

| Field | Tipe | Deskripsi |
|---|---|---|
| `stages` | `array` | Daftar tahapan pipeline |

**Contoh Request:**
```json
{
  "stages": [
    {"name": "new_lead", "label": "Prospek Baru", "order": 1},
    {"name": "negotiation", "label": "Negosiasi", "order": 2},
    {"name": "closed_won", "label": "Berhasil", "order": 3}
  ]
}
```

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "Pipeline berhasil diperbarui"
}
```

---

### GET /api/followups/stage-stats/:store_wa_id

Mendapatkan statistik per tahapan pipeline.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `store_wa_id` | `string` | ID WhatsApp toko |

**Contoh Respons (200):**
```json
{
  "success": true,
  "data": [
    {
      "stage": "new_lead",
      "count": 20,
      "percentage": 40
    },
    {
      "stage": "followed_up",
      "count": 30,
      "percentage": 60
    }
  ]
}
```

---

### POST /api/followups/force-send/:id

Memaksa pengiriman follow-up secara manual. **Role:** admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `admin` |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `id` | `integer` | ID follow-up |

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "Follow-up dipaksa kirim"
}
```

---

### POST /api/followups/schedule

Menjadwalkan follow-up baru. **Role:** operator atau admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `operator`, `admin` |

**Request Body:**

| Field | Tipe | Deskripsi |
|---|---|---|
| `store_id` | `integer` | ID toko |
| `contact_id` | `string` | ID kontak |
| `message` | `string` | Isi pesan |
| `scheduled_at` | `string` | Jadwal pengiriman (ISO 8601) |

**Contoh Request:**
```json
{
  "store_id": 1,
  "contact_id": "628111111111@c.us",
  "message": "Halo, apakah anda tertarik dengan produk kami?",
  "scheduled_at": "2025-06-09T10:00:00.000Z"
}
```

**Contoh Respons (201):**
```json
{
  "success": true,
  "message": "Follow-up berhasil dijadwalkan",
  "data": {
    "id": 101,
    "store_id": 1,
    "scheduled_at": "2025-06-09T10:00:00.000Z",
    "status": "pending"
  }
}
```

---

## 8. Media

Semua route di bawah ini memerlukan **JWT**.

### GET /api/media

Mendapatkan daftar semua media.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Contoh Respons (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "filename": "produk.jpg",
      "mimetype": "image/jpeg",
      "size": 204800,
      "url": "/uploads/produk.jpg",
      "created_at": "2025-06-08T10:00:00.000Z"
    }
  ]
}
```

---

### POST /api/media/upload

Mengunggah berkas media. Menggunakan multer dengan batas ukuran **50 MB**.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Tipe MIME yang diizinkan:**

| Kategori | Tipe MIME |
|---|---|
| Gambar | image/jpeg, image/png, image/gif, image/webp |
| Dokumen | application/pdf, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet |
| Teks | text/plain, text/csv |
| Video | video/mp4, video/quicktime, video/webm, video/3gpp |

**Request Body:** `multipart/form-data`

| Field | Tipe | Deskripsi |
|---|---|---|
| `file` | `file` | Berkas yang akan diunggah |

**Contoh Respons (201):**
```json
{
  "success": true,
  "message": "Media berhasil diunggah",
  "data": {
    "id": 1,
    "filename": "produk.jpg",
    "mimetype": "image/jpeg",
    "size": 204800,
    "url": "/uploads/produk.jpg"
  }
}
```

---

### GET /api/media/:id

Mendapatkan detail media berdasarkan ID.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `id` | `integer` | ID media |

**Contoh Respons (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "filename": "produk.jpg",
    "mimetype": "image/jpeg",
    "size": 204800,
    "url": "/uploads/produk.jpg",
    "created_at": "2025-06-08T10:00:00.000Z"
  }
}
```

---

### PUT /api/media/:id

Memperbarui metadata media.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `id` | `integer` | ID media |

**Request Body:**

| Field | Tipe | Deskripsi |
|---|---|---|
| `filename` | `string` | Nama baru (opsional) |

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "Media berhasil diperbarui"
}
```

---

### DELETE /api/media/:id

Menghapus media.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `id` | `integer` | ID media |

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "Media berhasil dihapus"
}
```

---

## 9. Ringkasan (Summaries)

Semua route di bawah ini memerlukan **JWT**.

### GET /api/summaries

Mendapatkan daftar ringkasan percakapan.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Parameter Query:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `store_wa_id` | `string` | ID WhatsApp toko (opsional) |
| `status` | `string` | Filter status (opsional) |
| `limit` | `integer` | Batas jumlah data (opsional) |

**Contoh Respons (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "store_wa_id": "628123456789",
      "contact_id": "628111111111@c.us",
      "summary": "Pelanggan menanyakan harga produk X...",
      "status": "completed",
      "created_at": "2025-06-08T10:00:00.000Z"
    }
  ]
}
```

---

### GET /api/summaries/labels

Mendapatkan daftar label yang tersedia untuk ringkasan.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Contoh Respons (200):**
```json
{
  "success": true,
  "data": ["hot", "warm", "cold", "follow_up", "completed"]
}
```

---

### GET /api/summaries/:storeWaId/:contactId

Mendapatkan ringkasan untuk satu toko dan kontak tertentu.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `storeWaId` | `string` | ID WhatsApp toko |
| `contactId` | `string` | ID kontak |

**Contoh Respons (200):**
```json
{
  "success": true,
  "data": {
    "store_wa_id": "628123456789",
    "contact_id": "628111111111@c.us",
    "summary": "Pelanggan menanyakan harga produk X...",
    "label": "hot",
    "status": "completed",
    "created_at": "2025-06-08T10:00:00.000Z"
  }
}
```

---

## 14. Pengaturan (Settings)

Semua route di bawah ini memerlukan **JWT**.

### GET /api/settings/health

Memeriksa kesehatan sistem secara keseluruhan.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Contoh Respons (200):**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "uptime": 3600,
    "memory_usage": "45%",
    "cpu_load": "0.5"
  }
}
```

---

### GET /api/settings/logs

Mendapatkan log sistem.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Contoh Respons (200):**
```json
{
  "success": true,
  "data": [
    {
      "timestamp": "2025-06-08T10:00:00.000Z",
      "level": "info",
      "message": "Server started"
    }
  ]
}
```

---

### GET /api/settings/backups

Mendapatkan daftar cadangan (backup) yang tersedia.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Contoh Respons (200):**
```json
{
  "success": true,
  "data": [
    {
      "name": "backup_20250608_120000.sql.gz",
      "size": 1048576,
      "created_at": "2025-06-08T12:00:00.000Z"
    }
  ]
}
```

---

### POST /api/settings/backups

Membuat cadangan baru. **Role:** admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `admin` |

**Contoh Respons (201):**
```json
{
  "success": true,
  "message": "Backup berhasil dibuat",
  "data": {
    "name": "backup_20250608_130000.sql.gz",
    "size": 0
  }
}
```

---

### DELETE /api/settings/backups/:name

Menghapus cadangan. **Role:** admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `admin` |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `name` | `string` | Nama file backup |

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "Backup berhasil dihapus"
}
```

---

### GET /api/settings/backups/:name/download

Mengunduh file cadangan.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `name` | `string` | Nama file backup |

**Contoh Respons (200):** Binary file stream (application/gzip).

---

### GET /api/settings/wa-status

Mendapatkan status koneksi WhatsApp.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Contoh Respons (200):**
```json
{
  "success": true,
  "data": {
    "connected": true,
    "battery": 85,
    "platform": "web"
  }
}
```

---

### POST /api/settings/wa-restart

Merestart koneksi WhatsApp. **Role:** admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `admin` |

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "WhatsApp berhasil direstart"
}
```

---

### PUT /api/settings/profile

Memperbarui profil pengguna. **Role:** admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `admin` |

**Request Body:**

| Field | Tipe | Deskripsi |
|---|---|---|
| `username` | `string` | Nama pengguna baru (opsional) |
| `password` | `string` | Kata sandi baru (opsional) |

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "Profil berhasil diperbarui"
}
```

---

### GET /api/settings/:storeId

Mendapatkan pengaturan untuk satu toko.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | -- |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `storeId` | `integer` | ID toko |

**Contoh Respons (200):**
```json
{
  "success": true,
  "data": {
    "store_id": 1,
    "welcome_message": "Halo! Ada yang bisa dibantu?",
    "working_hours": {"start": "08:00", "end": "17:00"},
    "auto_reply": true
  }
}
```

---

### POST /api/settings/:storeId

Memperbarui pengaturan untuk satu toko. **Role:** admin.

| Atribut | Nilai |
|---|---|
| **Autentikasi** | JWT |
| **Role** | `admin` |

**Parameter URL:**

| Parameter | Tipe | Deskripsi |
|---|---|---|
| `storeId` | `integer` | ID toko |

**Request Body:**

| Field | Tipe | Deskripsi |
|---|---|---|
| `welcome_message` | `string` | Pesan sambutan (opsional) |
| `working_hours` | `object` | Jam operasional (opsional) |
| `auto_reply` | `boolean` | Balas otomatis (opsional) |

**Contoh Request:**
```json
{
  "welcome_message": "Selamat datang di Toko A!",
  "working_hours": {"start": "09:00", "end": "18:00"},
  "auto_reply": false
}
```

**Contoh Respons (200):**
```json
{
  "success": true,
  "message": "Pengaturan toko berhasil diperbarui"
}
```

---

## Kode Status HTTP

| Kode | Deskripsi |
|---|---|
| 200 | OK -- Permintaan berhasil |
| 201 | Created -- Sumber daya berhasil dibuat |
| 400 | Bad Request -- Permintaan tidak valid |
| 401 | Unauthorized -- Token JWT tidak ada/tidak valid |
| 403 | Forbidden -- Role tidak memiliki izin |
| 404 | Not Found -- Sumber daya tidak ditemukan |
| 429 | Too Many Requests -- Melebihi batas rate limit |
| 500 | Internal Server Error -- Kesalahan server |

## Catatan Umum

1. **Autentikasi:** Semua route kecuali `GET /health`, `POST /api/auth/login`, dan `/uploads` (static files) memerlukan header `Authorization: Bearer <token>`.
2. **Rate Limit:** `POST /api/auth/login` dibatasi 10 permintaan per 15 menit. `POST /api/chat/:storeId/send` dibatasi 30 permintaan per menit.
3. **Role Gates:** Route yang ditandai `admin` hanya dapat diakses oleh pengguna dengan role `admin`. Route yang ditandai `operator` atau `admin` dapat diakses oleh kedua role tersebut.
4. **Upload Media:** Batas ukuran unggahan media adalah 50 MB. Tipe MIME yang tidak diizinkan akan ditolak.
5. **Waktu:** Semua timestamp menggunakan format ISO 8601 (UTC).
