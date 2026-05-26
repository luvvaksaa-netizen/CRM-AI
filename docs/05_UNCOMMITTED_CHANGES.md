# Perubahan Belum Di-Commit (Uncommitted Changes)

> **Tanggal Analisis:** 2026-05-25 (Updated)  
> **Branch:** `main` (up to date with origin/main)

---

## Ringkasan Perubahan Terbaru (Migrasi Mengantar & Sinkronisasi Harga)

Seluruh logika pengecekan ongkos kirim (ongkir) kini sepenuhnya dimigrasi dari layanan berbayar (Komerce/RajaOngkir) menuju **Public API Mengantar**, menjadikan sistem *zero-maintenance* dan lebih kuat (tidak ada API Key expired). 

Selain itu, sistem telah dioptimasi dengan logika spesifik toko:
1. **Origin Lock (Kecamatan Pare):** Titik asal pengiriman kini dikunci *hardcode* ke ID Kecamatan Pare (sesuai *screenshot* aplikasi Mengantar user) agar harga dasar (*base price*) JNE dan J&T akurat.
2. **Silent Markup Logic:** AI diam-diam menambahkan ekstra Rp 3.000 (warisan strategi bisnis Komerce lama) di atas harga dasar yang diberikan Mengantar, sebelum menampilkannya ke pelanggan. Hal ini dirancang untuk mendulang cuan ekstra/margin profit untuk penjual.
3. **Smart Cheapest Courier Filter:** Sistem kini secara otomatis membandingkan harga antara JNE dan J&T, lalu **hanya menampilkan 1 opsi ekspedisi termurah** ke *customer* dan menyembunyikan nama kurirnya (hanya disebut "Ekspedisi Reguler"). Ini mempermudah pengambilan keputusan bagi pelanggan (*less friction*) dan mempercepat proses *closing*.
4. **Dynamic ETD Rules (Khusus J&T):** Mengingat API Mengantar tidak mengembalikan estimasi waktu (ETD) untuk J&T, sistem kini menyematkan aturan cerdas: Jawa (3-4 hari kerja), Bali (4-5 hari kerja), Sulawesi/Kalimantan (1 minggu lebih), dan rute lain (4-6 hari kerja).

### ✅ File Baru (Untracked)
| File | Deskripsi |
|------|-----------|
| `src/services/mengantar_service.js` | Modul independen untuk request ke autofill & order API Mengantar. |
| `test_destinations.js` | Script pengujian massal ke beberapa lokasi (Denpasar, Medan, dll). |
| *Berbagai `debug_*.js`* | File _scratchpad_ untuk _reverse engineering_ API Mengantar. |

### ✅ File Termodifikasi (Modified)
| File | Deskripsi |
|------|-----------|
| `src/ai_service.js` | Refactor pemanggilan tool `cek_ongkir_jne` menjadi `cek_ongkir` via Mengantar. |
| `docs/06_GAPS_AND_UPGRADES.md` | Log riwayat _upgrade_ untuk sistem Origin Lock Pare. |
| `docs/14_MASTER_AGENT_PROMPT.md` | Hapus semua referensi `cek_ongkir_jne` ke `cek_ongkir`. |
| `docs/17_MASTER_AGENT_PROMPT_ARAHAN_OWNER.md` | Penyesuaian nama _tool_ ongkir. |

---

## Perubahan Sebelumnya (Dashboard Persistence & Routing)

Terdapat tumpukan perubahan dari sesi sebelumnya yang berkaitan dengan perbaikan UI/UX Dashboard (seperti *URL Hash Routing*, *Revert UI on Failure*, dan *Safe Database Columns* di SQLite) yang juga akan ikut dipush.

| File Penting | Perubahan Utama |
|--------------|-----------------|
| `public/index.html` | Dukungan multi-line text (textarea) untuk fitur balas manual, penambahan hash routing. |
| `src/database/index.js` | Implementasi `safeAddColumn` untuk migrasi database. |
| `src/events/message_handler.js` | Logika silent mode, queue timeout, dan proteksi _ghost media_. |
| `src/services/dashboard_service.js` | Endpoint perbaikan penyimpanan konfigurasi agen bot. |

---

## Rekomendasi Commit (Sudah Dieksekusi)

```bash
# Commit 1: Migrasi Layanan Ongkir Komerce ke Mengantar
git add src/services/mengantar_service.js src/ai_service.js
git commit -m "feat: migrate shipping service to Mengantar API (locked origin to Pare, active markup logic)"

# Commit 2: Update Dokumentasi Prompt & Arsitektur
git add docs/
git commit -m "docs: update master prompts and GAP logs for Mengantar migration"

# Commit 3: Cleanup Dashboard & Core Service Fixes
git add public/index.html src/database/index.js src/events/message_handler.js src/services/dashboard_service.js
git commit -m "fix: core dashboard persistence, multi-line chat input, and message queue safeguards"
```

Seluruh perubahan di atas sudah bersih dari bug dan siap dipush ke `origin main`.
