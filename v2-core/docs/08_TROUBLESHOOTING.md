
## Daftar Isi

1. [Masalah Database](#1-masalah-database)
2. [Masalah Koneksi WhatsApp](#2-masalah-koneksi-whatsapp)
3. [Masalah Autentikasi dan Login](#3-masalah-autentikasi-dan-login)
4. [Masalah Socket.IO / Realtime](#4-masalah-socketio--realtime)
5. [Masalah Frontend](#5-masalah-frontend)
6. [Masalah Build dan Kompilasi](#6-masalah-build-dan-kompilasi)
7. [Masalah Upload Media](#7-masalah-upload-media)
8. [Masalah AI Engine](#8-masalah-ai-engine)
9. [Masalah Server Umum](#9-masalah-server-umum)

---

## 1. Masalah Database

### 1.1. Database Terkunci (SQLITE_BUSY)

**Gejala:** Error `SQLITE_BUSY` atau `database is locked` saat operasi baca/tulis.

**Penyebab:**
- SQLite berjalan dalam mode WAL (Write-Ahead Logging), tetapi ada proses legacy yang melakukan write secara konkuren.
- Koneksi database tidak ditutup dengan benar setelah transaksi.
- Transaksi berjalan lama yang memblokir koneksi lain.

**Solusi:**
1. Identifikasi proses yang mengakses database dengan lsof atau Process Explorer.
2. Restart backend server untuk melepas semua koneksi:
   
3. Jika error terus muncul, backup database lalu jalankan VACUUM:
   

**Pencegahan:**
- Gunakan pool koneksi dengan jumlah terbatas (disarankan max 5).
- Hindari transaksi panjang - maksimal 5 detik per transaksi.
- Pastikan legacy writer sudah dimigrasi ke endpoint API v2.

---
