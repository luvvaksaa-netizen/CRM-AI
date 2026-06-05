# 📁 PANDUAN UPLOAD MEDIA — LABEL NAMA YANG TEPAT & LENGKAP

Panduan ini memastikan semua media (foto/video) yang Anda upload ke sistem
akan bekerja sempurna: dikirim bot ke customer pada waktu yang tepat,
terpakai di follow-up otomatis, dan sebagai knowledge AI.

---

## ⚠️ ATURAN PENTING SEBELUM UPLOAD

1. **Label HARUS persis seperti di tabel** (huruf kecil, spasi tepat).
2. 🌟 **PENTING (ISOLASI MEDIA):** Media kini 100% dipisah per agen agar tidak ada salah kirim produk. Jika Anda punya 2 agen yang butuh media yang sama (misal gambar bundling), Anda WAJIB meng-upload gambar tersebut ke masing-masing agen.
3. Gambar bundling **"bundling upsell"** WAJIB di-upload ke **KEDUA** agen agar agen DTF maupun UV bisa menawarkannya.
4. Setelah upload, tunggu hingga status menjadi ✅ **"Analisis Vision AI Selesai"**.

---

## 🔍 CARA KERJA PENGIRIMAN MEDIA (WAJIB DIBACA)

### Update Teknis Video

- Video besar dianalisis dari dua sisi: visual frame + audio narasi.
- Untuk transkripsi, sistem mengekstrak audio kecil dulu sebelum memanggil Whisper. Video 20MB/45 detik tidak lagi dikirim penuh ke API transkripsi.
- Untuk pengiriman WhatsApp, video di atas threshold dibuatkan versi MP4 ringan otomatis (`*-wa.mp4`) saat analisis atau saat pertama kali dikirim, agar customer tidak menunggu terlalu lama.
- Rekomendasi tetap: video katalog 8-12MB atau lebih kecil, durasi 15-45 detik, audio jelas, dan tidak perlu resolusi terlalu tinggi.
- Jika status analisis selesai tetapi `narasi=false`, berarti audio tidak ada/tidak terbaca atau koneksi Whisper gagal setelah retry; analisis visual tetap bisa dipakai AI.

### Apakah bisa kirim lebih dari 1 gambar dengan label yang sama?

**Ya, bisa.** Tapi ada yang perlu Anda pahami:

#### Fakta Teknis
- Setiap file yang dikirim = **1 bubble pesan WhatsApp tersendiri**
- WhatsApp tidak bisa menggabungkan beberapa gambar dalam 1 bubble
- Namun jika beberapa gambar dikirim berurutan cepat, **WhatsApp akan otomatis menampilkannya sebagai album** (terlihat rapih)

#### Contoh Skenario
| Anda upload | Label | Yang terjadi |
|-------------|-------|--------------|
| 1 file kolase (4 varian dalam 1 gambar) | `katalog dtf` | **✅ 1 bubble — PALING CLEAN** |
| 3 file terpisah | `katalog dtf 1`, `katalog dtf 2`, `katalog dtf 3` | ⚠️ 3 bubble — AI mungkin tidak kirim semua |
| 3 file terpisah | semua diberi label `katalog dtf` | ✅ 3 bubble — AI biasanya kirim semua (jika diperintahkan) |

#### Rekomendasi Terbaik
> **Gabungkan semua varian menjadi 1 gambar kolase/grid**, lalu upload 1 file dengan label `katalog dtf`.  
> Ini paling **reliable, cepat, dan clean** — 1 bubble, selalu terkirim, tidak tergantung pilihan AI.

#### Jika Tetap Ingin Multi-File
Beri label yang **sama persis** (misalnya semua `katalog dtf`), bukan `katalog dtf 1`, `katalog dtf 2`.  
AI akan melihat semua file berlabel sama di katalog dan bisa memilih semua dengan `media_ids: [1, 2, 3]`.  
Pastikan di System Prompt sudah ada instruksi: *"Kirim SEMUA gambar yang berlabel 'katalog dtf'"*

#### Bagaimana dengan Follow-Up Otomatis?
Follow-up sistem hanya mengirim **1 media per stage** (media pertama yang cocok ditemukan).
Jadi untuk follow-up, cukup 1 file per label sudah optimal.

---

## 🟦 AGENT DTF (Label Nama Baju/Kain)
*Upload semua media berikut ke Agent DTF*

| No | Tipe | Label (WAJIB PERSIS INI) | Isi / Keterangan | Digunakan Untuk |
|----|------|--------------------------|------------------|-----------------|
| 1 | 📷 Gambar | `katalog dtf` | Foto 4 varian font DTF (bahan kain) | Dikirim bot saat opening — customer lihat pilihan font |
| 2 | 🎬 Video | `video dtf` | Video cara setrika label ke baju/seragam/bahan kain lain | Dikirim saat opening + Follow-Up Stage 1 & 3 |
| 3 | 📷 Gambar | `testimoni dtf` | Screenshot/foto review customer DTF | Follow-Up Stage 2 & 4 |
| 4 | 📷 Gambar | `value dtf` | Infografis keunggulan DTF (waterproof, tahan cuci, dll) | Follow-Up Stage 2 |
| 5 | 📷 Gambar | `bundling upsell` | Foto paket bundling Back to School | Upselling setelah customer closing |

**Total media untuk Agent DTF: 5 file**

---

## 🟩 AGENT UV (Label Nama Stiker Keras)
*Upload semua media berikut ke Agent UV*

| No | Tipe | Label (WAJIB PERSIS INI) | Isi / Keterangan | Digunakan Untuk |
|----|------|--------------------------|------------------|-----------------|
| 1 | 📷 Gambar | `katalog uv` | Foto 3 varian UV (Cowok, Cewek, Polos) | Dikirim bot saat opening — customer lihat pilihan varian |
| 2 | 🎬 Video | `video uv` | Video cara tempel stiker ke botol/helm/buku | Dikirim saat opening + Follow-Up Stage 1 & 3 |
| 3 | 📷 Gambar | `testimoni uv` | Screenshot/foto review customer stiker keras | Follow-Up Stage 2 & 4 |
| 4 | 📷 Gambar | `value uv` | Infografis keunggulan UV (anti air, timbul, permanen) | Follow-Up Stage 2 |
| 5 | 🎬 Video | `video pemasangan` | Video cara tempel stiker ke berbagai permukaan | Follow-Up Stage 4 (pagi hari besoknya) |
| 6 | 📷 Gambar | `bundling upsell` | Foto paket bundling Back to School | Upselling setelah customer closing |

**Total media untuk Agent UV: 6 file**

---

## 📋 CARA UPLOAD LANGKAH PER LANGKAH

### Langkah 1: Buka Dashboard
- Buka `crm.datasdm.com` di browser
- Login dengan akun admin

### Langkah 2: Pilih Tab Media
- Klik menu **"Media"** di sidebar kiri

### Langkah 3: Pilih Agent yang Benar
- Di bagian atas, pastikan Agent yang aktif adalah yang benar (DTF atau UV)
- Jangan sampai salah upload ke agent yang berbeda!

### Langkah 4: Upload File
1. Klik tombol **"Upload Baru"**
2. Pilih file dari komputer Anda
3. Isi **Label** dengan PERSIS seperti yang ada di tabel di atas (copy-paste saja)
4. Isi **Deskripsi** singkat (opsional, untuk info internal)
5. Klik **Upload**
6. Tunggu hingga status berubah menjadi ✅ **"Analisis Vision AI Selesai"**
7. Ulangi untuk file berikutnya

### Langkah 5: Verifikasi
- Setelah semua file terupload, chat ke nomor WA yang terhubung ke agent tersebut
- Kirim pesan apapun (misalnya: "Halo")
- Bot seharusnya membalas dengan foto katalog + video secara otomatis

---

## 🔄 ALUR SISTEM: KAPAN MEDIA DIKIRIM?

```
Customer Chat Pertama
        ↓
Bot: kirim teks cepat + [katalog dtf/uv] + [video dtf/uv]
      (jika ada video, teks dikirim dulu agar customer tidak menunggu upload)
        ↓
Customer pilih varian → tanya nama → tanya qty → tanya alamat
        ↓
Bot cek ongkir otomatis
        ↓
Bot kirim Rekap + No. Rekening
        ↓
Bot kirim [bundling upsell] + tawaran paket Back to School
        ↓
Customer tidak balas 10 menit →
  Follow-Up Stage 1: kirim [video dtf/uv] + copywriting
        ↓
Customer tidak balas 1 jam →
  Follow-Up Stage 2: kirim [value dtf/uv] atau [testimoni dtf/uv] + copywriting
        ↓
Jam 19:00 (hari yang sama) →
  Follow-Up Stage 3: kirim [video dtf/uv] + copywriting malam
        ↓
Jam 06:00 (hari berikutnya) →
  Follow-Up Stage 4: kirim [testimoni dtf/uv] + [video pemasangan] + copywriting pagi
        ↓
Customer membalas di manapun → Semua follow-up OTOMATIS dibatalkan ✅
```

---

## ❓ FAQ

**Q: Bagaimana kalau saya salah tulis label?**
A: Hapus media tersebut dan upload ulang dengan label yang benar. Bot tidak akan bisa menemukan media dengan label yang salah.

**Q: Apakah boleh upload foto lebih dari 1 untuk 1 label?**
A: Ya, tapi sistem akan mengambil yang pertama ditemukan. Sebaiknya 1 label = 1 file untuk konsistensi.

**Q: Gambar bundling upsell perlu di-upload ke kedua agent?**
A: YA! Karena media sekarang dipisah per agen secara ketat (isolasi media), Anda wajib meng-upload `bundling upsell` ke Agent DTF dan Agent UV jika ingin keduanya bisa menawarkan promo tersebut.

**Q: Video pemasangan untuk Agent UV saja atau DTF juga?**
A: Agent UV membutuhkan "video pemasangan" (cara tempel stiker). Agent DTF sudah pakai "video dtf" untuk tujuan yang sama (cara setrika). Jadi tidak perlu upload "video pemasangan" ke Agent DTF.
