# Matriks Pengujian Regresi - v2-core CRM-AI
**Dokumen**: 09_TESTING_CHECKLIST.md
**Project**: v2-core CRM-AI
**Versi**: 1.0

---

## Tujuan
Matriks ini mencakup seluruh skenario pengujian regresi untuk aplikasi **v2-core CRM-AI**. Setiap item harus diuji ulang setelah perubahan kode, deployment, atau rilis baru.

---

## Cara Penggunaan
1. Cetak matriks atau buka salinan digital.
2. Uji setiap item sesuai **Langkah Pengujian**.
3. Beri tanda **PASS** atau **FAIL** pada kolom **PASS/FAIL**.
4. Jika FAIL, isi Severity (Critical / High / Medium / Low).
5. Kembalikan laporan ke tim QA.

---

## Matriks Pengujian Regresi

### 1. ALUR LOGIN (10 item)

| ID | Area | Item yang Diuji | Langkah Pengujian | Hasil yang Diharapkan | PASS/FAIL | Severity |
|---|---|---|---|---|---|---|
| LOG-01 | Login | Login berhasil kredensial admin | 1. Buka /login<br>2. Masukkan email & password admin valid<br>3. Klik Login | Redirect ke /dashboard, sessionStorage terisi token | | |
| LOG-02 | Login | Login gagal - password salah | 1. Buka /login<br>2. Masukkan email valid, password salah<br>3. Klik Login | Muncul pesan error, tetap di /login | | |
| LOG-03 | Login | Login gagal - email tidak terdaftar | 1. Buka /login<br>2. Masukkan email tidak terdaftar<br>3. Klik Login | Pesan Akun tidak ditemukan, tetap di /login | | |
| LOG-04 | Login | Login gagal - field kosong | 1. Buka /login<br>2. Biarkan email & password kosong<br>3. Klik Login | Validasi cegah submit / error 400 | | |
| LOG-05 | Login | Rate limit 10+ percobaan gagal | 1. Lakukan 11 login gagal dalam 15 menit<br>2. Amati response ke-11 | HTTP 429, pesan Terlalu banyak percobaan | | |
| LOG-06 | Login | Token expiry 24 jam | 1. Login berhasil<br>2. Tunggu/manipulasi waktu expiry<br>3. Akses halaman | Redirect ke /login, sessionStorage cleared | | |
| LOG-07 | Login | Validasi sesi via GET /api/auth/session | 1. Login berhasil<br>2. Panggil GET /api/auth/session | Return 200 dengan data user | | |
| LOG-08 | Login | Validasi sesi - token tidak valid | 1. Manipulasi token jadi string acak<br>2. Muat ulang halaman | Redirect ke /login | | |
| LOG-09 | Login | Logout bersihkan sessionStorage | 1. Login<br>2. Klik Logout<br>3. Periksa sessionStorage | sessionStorage kosong, redirect ke /login, WS putus | | |
| LOG-10 | Login | Redirect tanpa autentikasi | 1. Hapus token<br>2. Akses /dashboard langsung | Redirect ke /login | | |

### 2. DASHBOARD - HALAMAN UTAMA (7 item)

| ID | Area | Item yang Diuji | Langkah Pengujian | Hasil yang Diharapkan | PASS/FAIL | Severity |
|---|---|---|---|---|---|---|
| DSH-01 | Dashboard | Statistik utama termuat | 1. Login sebagai admin<br>2. Buka /dashboard | Statistik (total store, chat, pesan) muncul | | |
| DSH-02 | Dashboard | Grafik Recharts merender | 1. Buka /dashboard<br>2. Periksa area grafik | Grafik muncul tanpa error defaultProps | | |
| DSH-03 | Dashboard | Filter toko berfungsi | 1. Buka /dashboard<br>2. Pilih toko dari dropdown | Data berubah sesuai toko | | |
| DSH-04 | Dashboard | Filter rentang tanggal | 1. Buka /dashboard<br>2. Pilih rentang tanggal | Data & grafik diperbarui | | |
| DSH-05 | Dashboard | Responsif mobile | 1. Buka di viewport 375px<br>2. Periksa elemen | Layout menyesuaikan, tidak overflow | | |
| DSH-06 | Dashboard | Loading state | 1. Buka dengan koneksi lambat<br>2. Amati awal | Spinner/skeleton muncul lalu hilang | | |
| DSH-07 | Dashboard | Error state gagal API | 1. Matikan backend<br>2. Buka /dashboard | Pesan error informatif tampil | | |

### 3. HALAMAN STORES / TOKO (8 item)

| ID | Area | Item yang Diuji | Langkah Pengujian | Hasil yang Diharapkan | PASS/FAIL | Severity |
|---|---|---|---|---|---|---|
| STR-01 | Stores | Daftar toko termuat | 1. Buka /stores | Semua toko muncul dengan nomor WA, status, tombol aksi | | |
| STR-02 | Stores | Membuat toko baru | 1. Klik Tambah Toko<br>2. Isi nama, no WA, alamat<br>3. Klik Simpan | Toko baru muncul di daftar | | |
| STR-03 | Stores | QR Code scan WA | 1. Klik Scan QR on disconnected store<br>2. Pindai QR | Status WA jadi Connected, pesan masuk | | |
| STR-04 | Stores | Reconnect WA | 1. Klik Reconnect di store terputus<br>2. Scan ulang QR | QR baru muncul, status jadi connected | | |
| STR-05 | Stores | Logout WA | 1. Klik Logout WA di store connected<br>2. Konfirmasi | Status jadi Disconnected, QR siap scan | | |
| STR-06 | Stores | Hapus toko | 1. Klik Hapus pada toko<br>2. Konfirmasi | Toko & data terkait terhapus | | |
| STR-07 | Stores | Validasi form nama kosong | 1. Klik Tambah Toko<br>2. Nama biarkan kosong<br>3. Klik Simpan | Validasi cegah submit, border merah | | |
| STR-08 | Stores | Pagination > 20 toko | 1. Pastikan 25+ toko<br>2. Buka /stores | 20 per halaman, navigasi muncul | | |

### 4. HALAMAN CHAT / OBROLAN (12 item)

| ID | Area | Item yang Diuji | Langkah Pengujian | Hasil yang Diharapkan | PASS/FAIL | Severity |
|---|---|---|---|---|---|---|
| CHT-01 | Chat | Daftar kontak termuat | 1. Buka /chat<br>2. Periksa sidebar | Kontak muncul, diurutkan chat terbaru | | |
| CHT-02 | Chat | Riwayat pesan termuat | 1. Klik kontak<br>2. Scroll ke atas | Riwayat termuat, infinite scroll berfungsi | | |
| CHT-03 | Chat | Kirim pesan teks | 1. Buka percakapan<br>2. Ketik pesan<br>3. Enter/Kirim | Pesan muncul di chat & terkirim ke WA | | |
| CHT-04 | Chat | Kirim media gambar | 1. Klik lampiran<br>2. Pilih gambar<br>3. Kirim | Gambar terkirim, thumbnail muncul | | |
| CHT-05 | Chat | Kirim media video | 1. Klik lampiran<br>2. Pilih video <50MB<br>3. Kirim | Video terkirim dan tampil | | |
| CHT-06 | Chat | Pause/unpause AI | 1. Klik Pause AI<br>2. Kirim pesan<br>3. Klik Unpause | Pause: AI tidak balas. Unpause: AI balas lagi | | |
| CHT-07 | Chat | Clear chat (admin) | 1. Login admin<br>2. Klik Hapus Percakapan<br>3. Konfirmasi | Semua pesan terhapus | | |
| CHT-08 | Chat | Clear chat (non-admin) | 1. Login operator/viewer<br>2. Cari tombol Hapus | Tombol tidak muncul | | |
| CHT-09 | Chat | Reaksi emoji pesan | 1. Hover pesan<br>2. Pilih emoji reaksi | Emoji muncul, dapat diubah/dihapus | | |
| CHT-10 | Chat | Forward pesan | 1. Klik menu forward<br>2. Pilih kontak tujuan<br>3. Konfirmasi | Pesan diforward | | |
| CHT-11 | Chat | Typing indicator | 1. Buka percakapan<br>2. Minta kontak mengetik | Indikator Sedang mengetik... muncul | | |
| CHT-12 | Chat | Emoji picker | 1. Klik ikon emoji<br>2. Pilih emoji | Emoji tersisip di input chat | | |

### 5. HALAMAN FOLLOW-UP / TINDAK LANJUT (8 item)

| ID | Area | Item yang Diuji | Langkah Pengujian | Hasil yang Diharapkan | PASS/FAIL | Severity |
|---|---|---|---|---|---|---|
| FLW-01 | Follow-up | Daftar follow-up termuat | 1. Buka /followup | Daftar follow-up dengan status, waktu, kontak | | |
| FLW-02 | Follow-up | Filter status | 1. Pilih filter (pending/selesai/dibatalkan)<br>2. Klik Terapkan | Daftar sesuai filter | | |
| FLW-03 | Follow-up | Pagination | 1. Pastikan 30+ follow-up<br>2. Buka /followup | Navigasi halaman muncul | | |
| FLW-04 | Follow-up | Batalkan follow-up | 1. Klik Batalkan<br>2. Konfirmasi | Status Dibatalkan | | |
| FLW-05 | Follow-up | Emergency cancel (admin) | 1. Login admin<br>2. Klik Emergency Cancel | Follow-up dibatalkan segera | | |
| FLW-06 | Follow-up | Konfigurasi follow-up | 1. Buka pengaturan<br>2. Ubah interval/template<br>3. Simpan | Pengaturan tersimpan | | |
| FLW-07 | Follow-up | Pipeline follow-up | 1. Buka pipeline<br>2. Drag & drop status | Status berubah real-time | | |
| FLW-08 | Follow-up | Force send & schedule | 1. Klik Kirim Sekarang / jadwalkan | Follow-up terkirim/terjadwal | | |

### 6. HALAMAN MEDIA (7 item)

| ID | Area | Item yang Diuji | Langkah Pengujian | Hasil yang Diharapkan | PASS/FAIL | Severity |
|---|---|---|---|---|---|---|
| MED-01 | Media | Daftar media termuat | 1. Buka /media | Daftar media dengan thumbnail muncul | | |
| MED-02 | Media | Upload gambar | 1. Klik Upload<br>2. Pilih JPG/PNG<br>3. Upload | File terupload, thumbnail tampil | | |
| MED-03 | Media | Upload video | 1. Klik Upload<br>2. Pilih MP4<br>3. Upload | Video terupload | | |
| MED-04 | Media | Validasi MIME type | 1. Upload .exe/.pdf<br>2. Amati respon | Ditolak: Tipe file tidak diizinkan | | |
| MED-05 | Media | Batas ukuran 50MB | 1. Upload file >50MB<br>2. Amati respon | Ditolak: Ukuran melebihi 50MB | | |
| MED-06 | Media | Edit trigger_words | 1. Edit media<br>2. Tambah/hapus trigger words<br>3. Simpan | Trigger words tersimpan | | |
| MED-07 | Media | Analisis AI selesai | 1. Upload media baru<br>2. Tunggu analisis | Status jadi Selesai dengan hasil | | |

### 7. HALAMAN AGENTS / AGEN (8 item)

| ID | Area | Item yang Diuji | Langkah Pengujian | Hasil yang Diharapkan | PASS/FAIL | Severity |
|---|---|---|---|---|---|---|
| AGT-01 | Agents | Daftar agen termuat | 1. Buka /agents | Semua agen AI muncul dengan nama, status, tipe | | |
| AGT-02 | Agents | Buat agen baru (admin) | 1. Login admin<br>2. Klik Tambah Agen<br>3. Isi nama, tipe, prompt<br>4. Simpan | Agen baru muncul, siap digunakan | | |
| AGT-03 | Agents | Edit agen (admin) | 1. Klik edit<br>2. Ubah nama/prompt<br>3. Simpan | Data agen berubah | | |
| AGT-04 | Agents | Hapus agen (admin) | 1. Klik hapus pada agen<br>2. Konfirmasi | Agen terhapus | | |
| AGT-05 | Agents | Buat agen (non-admin) | 1. Login operator/viewer<br>2. Cari tombol Tambah Agen | Tombol tidak muncul, API 403 | | |
| AGT-06 | Agents | Cascade delete agen | 1. Hapus agen punya toko & media<br>2. Periksa DB | Store & media ikut terhapus | | |
| AGT-07 | Agents | Toggle status agen | 1. Toggle aktif/nonaktif<br>2. Kirim chat | Nonaktif: AI diam. Aktif: AI respon | | |
| AGT-08 | Agents | Prompt template | 1. Buat agen dengan prompt spesifik<br>2. Kirim pesan pemicu | Respon AI sesuai prompt | | |

### 8. HALAMAN REKAP / RINGKASAN (6 item)

| ID | Area | Item yang Diuji | Langkah Pengujian | Hasil yang Diharapkan | PASS/FAIL | Severity |
|---|---|---|---|---|---|---|
| REK-01 | Rekap | Daftar ringkasan termuat | 1. Buka /rekap | Ringkasan percakapan muncul | | |
| REK-02 | Rekap | Filter toko | 1. Pilih toko dari dropdown<br>2. Klik Terapkan | Ringkasan sesuai toko | | |
| REK-03 | Rekap | Filter label | 1. Pilih label<br>2. Klik Terapkan | Ringkasan sesuai label | | |
| REK-04 | Rekap | Filter status | 1. Pilih status (selesai/baru)<br>2. Klik Terapkan | Ringkasan sesuai status | | |
| REK-05 | Rekap | Detail ke chat | 1. Klik ringkasan<br>2. Klik Lihat Percakapan | Redirect ke /chat dengan percakapan terbuka | | |
| REK-06 | Rekap | Pagination | 1. Pastikan 25+ ringkasan<br>2. Klik navigasi | Data per halaman konsisten | | |

### 9. HALAMAN CLOSING / PENUTUPAN (8 item)

| ID | Area | Item yang Diuji | Langkah Pengujian | Hasil yang Diharapkan | PASS/FAIL | Severity |
|---|---|---|---|---|---|---|
| CLS-01 | Closing | Statistik closing | 1. Buka /closing | Statistik penutupan (total, rate, waktu) muncul | | |
| CLS-02 | Closing | Pola closing | 1. Buka tab pola<br>2. Periksa daftar | Pola closing terdeteksi dengan frekuensi | | |
| CLS-03 | Closing | Analitik closing | 1. Buka tab analitik<br>2. Periksa grafik | Grafik tren, konversi per toko tampil | | |
| CLS-04 | Closing | Filter COD vs Transfer | 1. Pilih metode pembayaran<br>2. Klik Terapkan | Data difilter sesuai metode | | |
| CLS-05 | Closing | Ekspor CSV | 1. Klik Ekspor CSV<br>2. Buka file | CSV terunduh dengan data lengkap | | |
| CLS-06 | Closing | Toggle pola (admin) | 1. Login admin<br>2. Toggle pola | Pola berubah status, deteksi menyesuaikan | | |
| CLS-07 | Closing | Hapus pola (admin) | 1. Login admin<br>2. Klik hapus pola | Pola terhapus | | |
| CLS-08 | Closing | Hapus/toggle pola (non-admin) | 1. Login operator/viewer<br>2. Cari tombol | Tombol tidak muncul | | |

### 10. HALAMAN LEARNING / PEMBELAJARAN (6 item)

| ID | Area | Item yang Diuji | Langkah Pengujian | Hasil yang Diharapkan | PASS/FAIL | Severity |
|---|---|---|---|---|---|---|
| LRN-01 | Learning | Overview pembelajaran | 1. Buka /learning | Ringkasan data pembelajaran tampil | | |
| LRN-02 | Learning | Pola pembelajaran | 1. Buka tab pola | Pola dari interaksi chat tampil | | |
| LRN-03 | Learning | Analitik pembelajaran | 1. Buka tab analitik | Grafik tren & distribusi tampil | | |
| LRN-04 | Learning | Toggle pola (admin) | 1. Login admin<br>2. Toggle pola | Pola diaktifkan/dinonaktifkan | | |
| LRN-05 | Learning | Toggle pola (non-admin) | 1. Login operator/viewer<br>2. Cari toggle | Tombol tidak muncul | | |
| LRN-06 | Learning | Seed data (admin) | 1. Login admin<br>2. Upload data baru | Data pembelajaran bertambah | | |

### 11. HALAMAN LABELS / SMART-LABELS (7 item)

| ID | Area | Item yang Diuji | Langkah Pengujian | Hasil yang Diharapkan | PASS/FAIL | Severity |
|---|---|---|---|---|---|---|
| LBL-01 | Labels | Daftar label termuat | 1. Buka /labels | Smart-label dengan warna & deskripsi muncul | | |
| LBL-02 | Labels | Buat label baru | 1. Klik Tambah Label<br>2. Isi nama, pilih warna<br>3. Simpan | Label baru muncul | | |
| LBL-03 | Labels | Edit label | 1. Klik edit<br>2. Ubah nama/warna<br>3. Simpan | Perubahan tersimpan | | |
| LBL-04 | Labels | Hapus label | 1. Klik hapus<br>2. Konfirmasi | Label terhapus | | |
| LBL-05 | Labels | Color palette | 1. Buat/edit label<br>2. Klik pemilih warna | Palette warna muncul, bisa dipilih | | |
| LBL-06 | Labels | WA list per label | 1. Klik label<br>2. Periksa daftar WA | Daftar nomor WA dalam label muncul | | |
| LBL-07 | Labels | Hitung per label | 1. Buka /labels<br>2. Periksa angka | Jumlah kontak per label akurat | | |

### 12. HALAMAN BOT-ACTIVATION / AKTIVASI BOT (5 item)

| ID | Area | Item yang Diuji | Langkah Pengujian | Hasil yang Diharapkan | PASS/FAIL | Severity |
|---|---|---|---|---|---|---|
| BOT-01 | Bot-Activation | Status bot per toko | 1. Buka /bot-activation | Daftar toko dengan status bot (aktif/nonaktif) | | |
| BOT-02 | Bot-Activation | Toggle bot (admin) | 1. Login admin<br>2. Toggle bot suatu toko | Status berubah, AI berhenti/mulai respon | | |
| BOT-03 | Bot-Activation | Toggle bot (non-admin) | 1. Login operator/viewer<br>2. Cari toggle | Tombol tidak muncul | | |
| BOT-04 | Bot-Activation | Toggle massal | 1. Centang beberapa toko<br>2. Klik Aktifkan/Nonaktifkan Semua | Status berubah serentak | | |
| BOT-05 | Bot-Activation | Status persist setelah toggle | 1. Toggle bot<br>2. Navigasi pergi & kembali | Status tetap sesuai | | |

### 13. HALAMAN SETTINGS / PENGATURAN (8 item)

| ID | Area | Item yang Diuji | Langkah Pengujian | Hasil yang Diharapkan | PASS/FAIL | Severity |
|---|---|---|---|---|---|---|
| SET-01 | Settings | Health check | 1. Buka /settings<br>2. Tab Health | Semua service (API, DB, Redis, WA) hijau | | |
| SET-02 | Settings | Buat backup | 1. Klik Buat Backup<br>2. Tunggu selesai | Backup baru di daftar | | |
| SET-03 | Settings | Hapus backup | 1. Klik hapus backup<br>2. Konfirmasi | Backup terhapus | | |
| SET-04 | Settings | Download backup | 1. Klik download backup<br>2. Buka file | File terunduh, bisa direstore | | |
| SET-05 | Settings | Download log | 1. Klik Download Log<br>2. Buka file | File log terunduh (.txt/.log) | | |
| SET-06 | Settings | Status WhatsApp | 1. Buka tab WA Status<br>2. Periksa per toko | Status koneksi Connected/Disconnected | | |
| SET-07 | Settings | Restart WA (admin) | 1. Login admin<br>2. Klik Restart WA | Service WA restart, status berubah | | |
| SET-08 | Settings | Update profil (admin) | 1. Login admin<br>2. Ubah nama/email/password<br>3. Simpan | Profil berubah, token tetap valid | | |

### 14. SOCKET EVENTS / EVENT REAL-TIME (7 item)

| ID | Area | Item yang Diuji | Langkah Pengujian | Hasil yang Diharapkan | PASS/FAIL | Severity |
|---|---|---|---|---|---|---|
| SKT-01 | Socket | Koneksi saat auth | 1. Login berhasil<br>2. Cek DevTools WS | WebSocket terhubung (status 101) | | |
| SKT-02 | Socket | Putus saat logout | 1. Login, WS connected<br>2. Klik Logout | WS disconnect, tidak ada error | | |
| SKT-03 | Socket | Pesan baru real-time | 1. Minta kontak kirim WA<br>2. Amati chat | Pesan muncul <2 detik | | |
| SKT-04 | Socket | Typing indicator real-time | 1. Minta kontak mengetik<br>2. Amati UI | Indikator muncul real-time | | |
| SKT-05 | Socket | QR Code via socket | 1. Klik Scan QR di store disconnected<br>2. Amati event | QR muncul via socket, bisa dipindai | | |
| SKT-06 | Socket | Follow-up update real-time | 1. Buka /followup<br>2. Sistem kirim follow-up | Status berubah tanpa refresh | | |
| SKT-07 | Socket | Dashboard update real-time | 1. Buka /dashboard<br>2. Kontak kirim pesan | Statistik terupdate otomatis | | |

### 15. ROLE-BASED ACCESS CONTROL / KONTROL AKSES (8 item)

| ID | Area | Item yang Diuji | Langkah Pengujian | Hasil yang Diharapkan | PASS/FAIL | Severity |
|---|---|---|---|---|---|---|
| RBAC-01 | RBAC | Admin akses penuh | 1. Login admin<br>2. Akses semua fitur | Semua fitur berfungsi | | |
| RBAC-02 | RBAC | Operator read+kirim+pause | 1. Login operator<br>2. Kirim chat, pause AI, baca | Berhasil: kirim, pause, baca. Gagal: hapus | | |
| RBAC-03 | RBAC | Viewer read only | 1. Login viewer<br>2. Coba kirim/edit | Hanya baca, tombol aksi disabled | | |
| RBAC-04 | RBAC | API 403 aksi tidak sah | 1. Login viewer<br>2. Panggil POST/PUT/DELETE via DevTools | HTTP 403, pesan Akses ditolak | | |
| RBAC-05 | RBAC | UI non-admin tersembunyi | 1. Login operator/viewer<br>2. Periksa UI | Tombol admin tidak tampil | | |
| RBAC-06 | RBAC | UI admin tampil | 1. Login admin<br>2. Periksa UI | Semua kontrol admin muncul | | |
| RBAC-07 | RBAC | Role tidak bisa diubah via API | 1. Login operator<br>2. PATCH role jadi admin | API 403, role tidak berubah | | |
| RBAC-08 | RBAC | Store access restriction | 1. Login user akses 2 toko<br>2. Buka /stores | Hanya 2 toko muncul | | |

### 16. API PATH & ERROR FORMAT (6 item)

| ID | Area | Item yang Diuji | Langkah Pengujian | Hasil yang Diharapkan | PASS/FAIL | Severity |
|---|---|---|---|---|---|---|
| API-01 | API | Frontend cocok backend routes | 1. Buka DevTools Network<br>2. Jelajahi semua halaman<br>3. Verifikasi URL | Semua URL cocok dengan route backend | | |
| API-02 | API | Error format konsisten | 1. Request dengan data invalid<br>2. Periksa response | Format: success=false, message, error | | |
| API-03 | API | HTTP method sesuai standar | 1. Periksa endpoint<br>2. GET=read, POST=create, PUT=update, DELETE=delete | Sesuai RESTful | | |
| API-04 | API | Response time | 1. Monitor API calls<br>2. Catat response time | < 2 detik 95% request, <5 detik upload | | |
| API-05 | API | Pagination konsisten | 1. Panggil dengan page & limit<br>2. Periksa response | Format: data, meta page/limit/total/totalPages | | |
| API-06 | API | CORS headers | 1. Periksa response headers | Access-Control-Allow-Origin sesuai config | | |

### 17. BUILD & COMPILATION (4 item)

| ID | Area | Item yang Diuji | Langkah Pengujian | Hasil yang Diharapkan | PASS/FAIL | Severity |
|---|---|---|---|---|---|---|
| BLD-01 | Build | TypeScript compilation | 1. Jalankan npx tsc --noEmit<br>2. Periksa output | Tidak ada error kompilasi TS | | |
| BLD-02 | Build | Build production | 1. Jalankan npm run build<br>2. Cek exit code | Build sukses (exit 0), folder terisi | | |
| BLD-03 | Build | Tidak ada warning kritis | 1. Perhatikan output build<br>2. Catat warning | Tidak ada warning indikasi bug | | |
| BLD-04 | Build | Build size wajar | 1. Periksa ukuran build/dist | Tidak membengkak >20% dari baseline | | |

### 18. CONSOLE ERRORS (7 item)

| ID | Area | Item yang Diuji | Langkah Pengujian | Hasil yang Diharapkan | PASS/FAIL | Severity |
|---|---|---|---|---|---|---|
| CON-01 | Console | Tidak ada WebSocket is closed | 1. Buka DevTools Console<br>2. Login, logout, navigasi | Tidak ada error WebSocket is closed | | |
| CON-02 | Console | Tidak ada Recharts defaultProps | 1. Buka halaman dengan grafik<br>2. Periksa Console | Tidak ada warning defaultProps | | |
| CON-03 | Console | Tidak ada Failed to load resource | 1. Buka semua halaman<br>2. Periksa Console & Network | Semua resource termuat | | |
| CON-04 | Console | Tidak ada unhandled promise | 1. Navigasi lengkap<br>2. Trigger aksi API | Tidak ada Unhandled Promise Rejection | | |
| CON-05 | Console | Tidak ada Cannot read null | 1. Buka semua halaman<br>2. Interaksi elemen | Tidak ada Cannot read properties of null | | |
| CON-06 | Console | Tidak ada React key warnings | 1. Navigasi halaman dengan list<br>2. Periksa Console | Tidak ada missing key prop warning | | |
| CON-07 | Console | Tidak ada 401/500 flow normal | 1. Lakukan flow end-to-end<br>2. Periksa Network | Tidak ada 401/500 di flow normal | | |

