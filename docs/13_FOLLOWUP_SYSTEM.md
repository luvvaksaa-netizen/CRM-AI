# Sistem Follow-Up Otomatis (Re-Engagement Pipeline)

Dokumentasi ini menjelaskan arsitektur, cara kerja, dan konfigurasi dari **Sistem Follow-Up Otomatis** pada platform WhatsApp CRM.

---

## 1. Konsep & Tujuan

Tujuan dari modul follow-up ini adalah untuk mengembalikan perhatian customer yang mengambang atau belum sempat melakukan pembayaran/order. Fitur ini dirancang sangat halus agar tidak terlihat seperti spam dan mengurangi resiko *flagging/banned* oleh WhatsApp.

### Fitur Utama:
1. **4-Stage Pipeline**: Follow-up dilakukan secara bertahap dalam 4 waktu strategis (10 menit, 1 jam, Pukul 19:00, Pukul 06:00 hari berikutnya).
2. **Auto-Cancellation**: Begitu customer membalas chat secara manual (atau status transaksi terdeteksi Close/Lunas), seluruh antrian follow-up pending untuk kontak tersebut otomatis dibatalkan.
3. **Random Delay Execution**: Pengiriman pesan follow-up tidak dilakukan serentak di waktu yang sama persis, melainkan diberi jeda acak 2-5 menit antar-customer untuk meniru perilaku manusia asli.
4. **Media Integrations**: Setiap pesan follow-up dapat melampirkan media yang relevan (seperti video testimoni atau foto produk) berdasarkan label media di library agen.
5. **Human Override Safety**: Jika status AI Reply pada kontak di-pause oleh operator CRM (status PAUSED_CONTACT), follow-up otomatis ditunda/tidak dikirimkan untuk mencegah bentrokan balasan.

---

## 2. Arsitektur Database (`FollowUp` Table)

Antrian follow-up dilacak di SQLite menggunakan tabel `FollowUp` dengan struktur berikut:

| Field | Tipe Data | Deskripsi |
| :--- | :--- | :--- |
| `id` | INTEGER (PK) | Auto-increment ID |
| `store_wa_id` | STRING | ID WhatsApp Toko yang mengirim follow-up |
| `contact_id` | STRING | ID Chat WhatsApp penerima |
| `contact_name` | STRING | Nama pelanggan |
| `stage` | INTEGER | Tahapan follow-up (1, 2, 3, atau 4) |
| `scheduled_at` | DATE | Waktu target pengiriman |
| `sent_at` | DATE | Waktu pengiriman sukses |
| `status` | STRING | Status: `pending`, `sent`, `cancelled` |
| `cancel_reason` | STRING | Alasan pembatalan (misal: "Customer Replied") |
| `last_chat_context` | TEXT | Cuplikan pesan terakhir dari pelanggan |

---

## 3. Empat Tahap Follow-Up (Default Rules)

Waktu pengiriman dihitung secara relatif dari pesan keluar AI terakhir kepada pelanggan:

| Tahap | Jeda Waktu | Template Copywriting Utama | Jenis Media Terlampir |
| :---: | :--- | :--- | :--- |
| **Stage 1** | **10 Menit** | Menawarkan bantuan/menanyakan kendala pengisian nama/desain. | *N/A (Teks Saja)* |
| **Stage 2** | **1 Jam** | Memberikan opsi varian font/warna terpopuler. | Gambar Varian Alternatif |
| **Stage 3** | **Pukul 19:00 WIB** | Menekankan urgensi slot cetak besok pagi. | Video Demo Cetak / Testimoni |
| **Stage 4** | **Pukul 06:00 WIB (Besok)** | Menyapa ramah, menanyakan apakah order ingin dilanjutkan hari ini. | *N/A (Teks Saja)* |

---

## 4. Cara Kerja Scheduler & Executor

Layanan scheduler didefinisikan di `src/services/followup_service.js`.

### Alur Eksekusi:
1. **Trigger Post-AI Reply**: Setelah AI selesai menjawab pesan customer, system secara otomatis menghapus antrian lama dan membuat antrian follow-up baru di database (dimulai dari `Stage 1` pada 10 menit ke depan).
2. **Scheduler Tick**: Scheduler berjalan setiap 60 detik mencari record dengan status `pending` dan `scheduled_at` kurang dari waktu saat ini.
3. **Queue Staggering**: Jika ditemukan beberapa follow-up siap kirim sekaligus, sistem mengantrikannya dengan jeda acak 2-5 menit antar-item agar pengiriman tampak alami di WhatsApp network.
4. **Pembatalan pada Pesan Masuk**: Begitu customer mengirim pesan baru (ditangkap di `message_handler.js`), sistem langsung memanggil `cancelPendingFollowUps()` untuk membatalkan semua agenda kirim yang tertunda.

---

## 5. Konfigurasi Sistem

Semua interval dan pengaturan dapat disesuaikan pada file `src/services/followup_service.js`:

```javascript
// Interval scheduler memeriksa database (default 60 detik)
const SCHEDULER_INTERVAL_MS = 60000; 

// Jeda stagger antar-pengiriman (default 120,000 - 300,000 ms)
const STAGGER_MIN_MS = 120000;
const STAGGER_MAX_MS = 300000;
```
