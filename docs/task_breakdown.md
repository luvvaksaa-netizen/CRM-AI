# Dokumen Rincian Tugas (Task Breakdown & WBS)
## CRM WhatsApp AI (WhatsApp Cloud API Integration)

---

## FASE 0: Optimasi & Stabilitas Engine AI (Sedang Berjalan)
Fase ini berfokus pada penyaringan dan perbaikan logika AI dari versi terbaru agar sistem berjalan stabil tanpa error/banned sebelum migrasi ke Cloud API.

- [x] **T-0.1: Perbaikan Context Media AI** (Mencegah pengulangan caption pada pengiriman gambar jamak).
- [x] **T-0.2: Penerapan Consultative Selling** (Melonggarkan prompt draconian, menonaktifkan fast-return media agar AI berbicara lebih natural, dan membersihkan bug toolResponses).
- [x] **T-0.3: Perbaikan UI Analytics & Dashboard** (Memastikan filter analitik berjalan dan perbaikan modal).
- [x] **T-0.4: Implementasi Fitur Filter Live Chat** (Memisahkan chat Bot vs CS Manusia dan sinkronisasi fitur Hard-Stop AI). *Catatan: Natural Bubble Splitting diabaikan sesuai permintaan karena akan diatasi via LLM Prompt.*

---

## FASE 1: Registrasi Akun & Konfigurasi Meta Developer (Estimasi: 1 - 2 Hari)
Fase ini tidak melibatkan penulisan kode, melainkan persiapan infrastruktur resmi Meta.

- [ ] **T-1.1: Registrasi Akun Meta Developer**
  * Membuat akun pengembang di [developers.facebook.com](https://developers.facebook.com).
  * Membuat Meta App baru kategori "Perniagaan" (*Business*).
- [ ] **T-1.2: Konfigurasi Produk WhatsApp**
  * Menambahkan produk "WhatsApp" ke aplikasi Meta.
  * Mendapatkan nomor telepon uji coba (*test number*) dan Phone Number ID bawaan.
- [ ] **T-1.3: Pengaturan Akun Meta Business Manager**
  * Menghubungkan aplikasi ke Akun Bisnis Meta.
  * Mendaftarkan nomor telepon WhatsApp fisik resmi (setelah di-unregister dari aplikasi seluler handphone).
  * Membuat dan mendapatkan **Token Akses Graf Permanen** (*System User Access Token*) agar koneksi API tidak terputus tiap 24 jam.

---

## FASE 2: Penyesuaian Skema Database SQLite (Estimasi: 2 - 3 Jam)
Menghubungkan tabel database yang ada dengan data autentikasi resmi Meta.

- [ ] **T-2.1: Modifikasi Model Store di `src/database/index.js`**
  * Menambahkan kolom `phone_number_id`, `waba_id`, `access_token`, dan `verify_token` ke model `Store`.
  * Menghapus referensi ke instans Puppeteer/LocalAuth di model (atau dibiarkan sebagai legacy tak terpakai).
- [ ] **T-2.2: Migrasi Database SQLite**
  * Menjalankan inisialisasi basis data untuk memperbarui kolom baru (`sequelize.sync()` otomatis memicu `alter: true`).

---

## FASE 3: Implementasi Webhook & API Penerima di Backend (Estimasi: 1 Hari)
Menerima payload real-time resmi dari WhatsApp dan merutekannya ke dalam logika CRM.

- [ ] **T-3.1: Tambah Endpoint Webhook Express**
  * Membuat rute `GET /webhook/whatsapp` di `index.js` untuk verifikasi webhook awal oleh Meta.
  * Membuat rute `POST /webhook/whatsapp` untuk memproses callback pesan masuk dan status pesan dari Meta.
- [ ] **T-3.2: Middleware Verifikasi Tanda Tangan Meta**
  * Membuat middleware di `src/utils/security.js` untuk memverifikasi SHA256 HMAC signature dari header `x-hub-signature-256`.
- [ ] **T-3.3: Parser Payload Webhook**
  * Menulis parser untuk membedakan tipe pesan (teks, media gambar, media video, audio/pesan suara).
  * Memanggil logika `handleMessage()` dari `src/events/message_handler.js` dengan payload terstandarisasi.
  * Mengintegrasikan update status kirim (delivered/read) ke dashboard via Socket.IO.

---

## FASE 4: Rework Mesin Pengirim Pesan (whatsapp_service.js) (Estimasi: 1 Hari)
Mengganti engine pengirim pesan dari WWebJS browser ke panggilan HTTPS REST API Meta Graph.

- [ ] **T-4.1: Rework `sendManualMessage` & `sendFollowUpMessage`**
  * Mengubah instansiasi Axios untuk mengirim pesan teks menggunakan Meta API:
    `POST https://graph.facebook.com/v19.0/{phone_number_id}/messages`.
- [ ] **T-4.2: Rework `sendManualMedia`**
  * Menulis fungsi pengunggah media ke Meta (`POST /v19.0/{phone_number_id}/media`) untuk mendapatkan `media_id` Meta.
  * Mengirim pesan media menggunakan ID media Meta tersebut ke pelanggan.
- [ ] **T-4.3: Implementasi Sinyal Mengetik (Typing Status API)**
  * Mengubah sinyal mengetik di `message_handler.js` menggunakan panggilan API resmi Meta:
    `POST /messages` dengan body `"sender_action": "typing_on"`.

---

## FASE 5: Pembaruan Dasbor Setelan di Frontend (Estimasi: 4 Jam)
Mengganti visualisasi pemindaian QR Code menjadi kolom formulir token Meta.

- [ ] **T-5.1: Pembaruan Halaman Setelan Toko**
  * Mengganti area render QR Code dengan form input: Token Akses Meta, Phone Number ID, WABA ID, dan Verify Token.
  * Menambahkan tombol "Simpan & Tes Koneksi".
- [ ] **T-5.2: Hubungkan API Koneksi**
  * Membuat endpoint backend `/api/stores/:id/test-connection` untuk mencoba mengirim pesan uji coba ke nomor pengembang.

---

## FASE 6: Uji Coba Integrasi & QA (Estimasi: 1 Hari)
Memastikan seluruh sistem terhubung lancar dari ujung ke ujung.

- [ ] **T-6.1: Uji Coba Webhook Cloudflare Tunnel**
  * Menguji apakah webhook dari Meta berhasil masuk ke Express melalui terowongan Cloudflare secara lokal.
- [ ] **T-6.2: Tes Integrasi AI**
  * Menguji respons AI, pemanggilan fungsi otomatis (*ongkir* & *katalog*), dan verifikasi bahwa data customer tercatat rapi di database.
- [ ] **T-6.3: Tes Keamanan (Human Override)**
  * Memastikan bot otomatis berhenti merespons ketika CS membalas chat secara manual dari dashboard UI atau langsung dari HP resmi.
