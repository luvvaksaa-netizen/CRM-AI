# 📖 Panduan Behavior Sistem: Bot Toggle ON/OFF

> **Versi:** 2026-05-24  
> **Relevan untuk:** Semua agent/store dalam sistem CRM WhatsApp

---

## Gambaran Umum

Sistem CRM ini memiliki dua mode operasi per-store (nomor WA):

| Mode | Nama UI | `is_bot_active` | Fungsi |
|---|---|---|---|
| **Bot ON** | Toggle hijau aktif | `true` | AI membalas otomatis, follow-up berjalan |
| **Bot OFF** | Toggle merah mati | `false` | CS manusia yang handle, AI diam |

---

## 🔴 Saat Bot Dimatikan (Toggle OFF)

### Apa yang TETAP berjalan:
✅ Semua pesan customer **masuk tersimpan ke database**  
✅ Foto dari customer **dianalisis Vision AI** dan tersimpan  
✅ Voice note dari customer **ditranskripsi Whisper** dan tersimpan  
✅ Pesan dari CS yang balas lewat HP **tercatat di dashboard** sebagai `CS (dari HP)`  
✅ Pesan dari dashboard manual **tercatat** seperti biasa  
✅ Label otomatis (misal: `AI Lead Baru`) **tetap ditambahkan** ke kontak  
✅ Auto-cancel follow-up saat customer balas **tetap berjalan**  
✅ **Rekap/Summary percakapan TETAP diperbarui** tiap customer chat (debounced 60 detik → background OpenAI call)  
✅ CS manual balas dari HP → summary juga langsung diperbarui (debounced 30 detik)  

### Apa yang BERHENTI:
🚫 AI tidak membalas sama sekali (**4 lapisan FIREWALL** mencegah ini)  
🚫 Follow-up otomatis dibatalkan saat bot OFF terdeteksi  
🚫 Reaction 👍 ke foto tidak dikirim saat bot OFF (agar customer tidak tahu bot aktif)  

### Hal Penting: CS Manual dari HP
Ketika CS membalas dari HP (bukan dashboard) saat bot OFF:
1. Pesan tercatat sebagai `sender_name: 'CS (dari HP)'`
2. **Background task (debounced 30 detik)**: summary/rekap percakapan diperbarui oleh AI
3. **Follow-up pending dibatalkan**: karena CS sudah handle, bot tidak perlu follow-up

### 🛡️ 4-Layer FIREWALL — Garansi Bot Tidak Reply saat OFF

Ketika toggle OFF, ada **4 lapisan pertahanan** yang memastikan bot tidak pernah membalas:

| Layer | Lokasi | Pengecekan |
|---|---|---|
| **FIREWALL 1** | `handleMessage()` awal | Parameter `shouldAIReply=false` (mode sinkronisasi startup) |
| **FIREWALL 2** | `handleMessage()` | `pausedContacts.has(debounceKey)` (pause per-kontak) |
| **FIREWALL 3** | `handleMessage()` sebelum debouncer | `Store.is_bot_active === false` (DB check early — baru) |
| **FIREWALL 4** | `_processAIReplyUnlocked()` | `Store.is_bot_active === false` (DB check late — defense-in-depth) |

Bahkan jika FIREWALL 1-3 gagal karena bug, FIREWALL 4 tetap mencegah reply. **Bot tidak akan pernah membalas selama toggle OFF.**

---

## 🟢 Saat Bot Dinyalakan Kembali (Toggle ON)

### Yang Terjadi Secara Otomatis (Smart Re-Activation):

Ketika toggle diubah ke ON, sistem menjalankan **background scan** atas semua percakapan aktif (30 hari terakhir). Proses ini berjalan di background — tidak memperlambat UI.

```
Untuk setiap kontak aktif:
  │
  ├─ Cek ChatSummary STATUS
  │   ├─ "closing/selesai" → SKIP (tidak diganggu sama sekali)
  │   └─ Aktif/Belum selesai → lanjut evaluasi
  │
  ├─ Cek pesan CS manual (24 jam terakhir)
  │   ├─ Ada CS balas → Update rekap background
  │   │                → Batalkan follow-up lama (CS sudah handle)
  │   └─ Tidak ada → lanjut evaluasi
  │
  └─ Cek apakah customer menunggu jawaban
      ├─ Customer kirim pesan tapi belum dibalas → Jadwalkan follow-up (15 menit delay)
      └─ Sudah ada balasan terakhir dari bot/CS → Skip (tidak perlu follow-up)
```

### Hasil Log yang Diharapkan:
```
[BotActivation] 🔄 Bot [default] dinyalakan. Memulai scan konteks percakapan...
[BotActivation] Ditemukan 12 kontak aktif untuk dievaluasi.
[BotActivation] [62812xxx@lid] sudah closing — skip semua aksi.
[BotActivation] [62813xxx@lid] sudah dibalas CS manual 3x saat bot OFF. Memperbarui rekap...
[BotActivation] [62815xxx@lid] customer masih menunggu — follow-up dijadwal ulang dalam 15 menit.
[BotActivation] ✅ Scan selesai: 5 closing (skip), 4 sudah dibalas CS, 3 follow-up dijadwal ulang.
```

---

## ⚡ Alur Follow-Up Setelah Bot ON

Follow-up yang dijadwalkan ulang saat re-aktivasi akan melewati **5 lapisan guard** sebelum dikirim:

1. **Bot aktif?** — Jika bot dimatikan lagi sebelum follow-up terkirim → dibatalkan
2. **Kontak dipause?** — Jika CS manual pause kontak → dibatalkan  
3. **ChatSummary closing?** — Jika summary menunjukkan selesai → dibatalkan
4. **CS sudah balas dari HP?** — Jika ada pesan `CS (dari HP)` setelah follow-up dijadwal → dibatalkan
5. **Customer sudah balas?** — Jika customer membalas sendiri → dibatalkan

Hanya jika **semua 5 guard lolos**, follow-up baru dikirim.

---

## 🔄 Skenario Lengkap: Bot OFF 1 Hari

### Skenario A: Customer sudah selesai order (closing)
```
09.00 — Customer chat → Bot balas → STATUS: closing
12.00 — Bot dimatikan
18.00 — Bot dinyalakan
         → Scan: summary = closing → SKIP
         → Tidak ada aksi apa-apa ✅
```

### Skenario B: CS membalas dari HP saat bot OFF
```
09.00 — Customer chat → Bot balas → STATUS: gali kebutuhan
10.00 — Bot dimatikan
11.00 — Customer chat lagi (tidak dijawab bot)
13.00 — CS balas dari HP (HP langsung ke WA)
13.00 — CRM otomatis: catat pesan CS, cancel follow-up, queue rekap update
13.30 — Rekap diperbarui (30 detik debounce → hit OpenAI)
18.00 — Bot dinyalakan
         → Scan: ada CS manual reply → rekap sudah fresh → follow-up ter-cancel
         → AI sudah tau bahwa CS sudah handle kontak ini ✅
```

### Skenario C: Customer menunggu jawaban (tidak dibalas saat bot OFF)
```
09.00 — Customer chat → Bot balas → STATUS: menunggu alamat
10.00 — Bot dimatikan
14.00 — Customer kirim alamatnya (bot OFF, tidak ada balasan)
18.00 — Bot dinyalakan
         → Scan: customer kirim pesan, tidak ada balasan terbaru → schedule follow-up
         → Follow-up dikirim 15 menit kemudian (18.15)
         → AI mendapat summary yang berisi "menunggu alamat" → tahu konteksnya ✅
```

### Skenario D: Tidak ada aktivitas (customer tidak chat saat bot OFF)
```
09.00 — Customer chat → Bot balas → STATUS: gali kebutuhan
10.00 — Bot dimatikan
18.00 — Bot dinyalakan
         → Scan: tidak ada pesan baru dari customer → tidak ada aksi
         → Follow-up yang sudah dijadwalkan sebelumnya tetap berjalan normal ✅
```

---

## ⚙️ Konfigurasi & Tuning

Beberapa konstanta yang bisa disesuaikan via `.env`:

```env
# Delay sebelum follow-up dikirim setelah bot ON (default: 15 menit)
BOT_ACTIVATION_FOLLOWUP_DELAY_MS=900000

# Debounce summary update dari CS manual (default: 30 detik)
CS_SUMMARY_DEBOUNCE_MS=30000

# Window scan kontak aktif saat bot ON (default: 30 hari)
BOT_ACTIVATION_SCAN_DAYS=30
```

---

## 🚨 Hal yang Perlu Diperhatikan

1. **Jangan matikan `npm start`** saat bot OFF — jika server dimatikan, pesan yang datang tidak akan tersimpan sama sekali.

2. **Follow-up stage 2-4 tidak otomatis reschedule** saat bot ON — hanya stage 1 yang dijadwalkan ulang. Jika customer butuh follow-up lanjutan, sistem akan menjadwalkan stage berikutnya setelah stage 1 berhasil terkirim.

3. **CS Manual Summary Update membutuhkan koneksi internet** ke OpenAI. Jika OpenAI down saat CS membalas, rekap tidak diperbarui — tapi pesan tetap tersimpan di DB.

4. **Jeda 15 menit** saat reschedule follow-up disengaja agar tidak langsung spam setelah bot ON.

---

## 📊 Tabel Status Follow-Up

| Status | Artinya | Aksi Berikutnya |
|---|---|---|
| `pending` | Dijadwalkan, menunggu waktu kirim | Akan dikirim oleh scheduler |
| `sent` | Berhasil dikirim | Stage berikutnya dijadwalkan |
| `replied` | Customer sudah merespons | Tidak ada aksi |
| `cancelled` | Dibatalkan (bot OFF, closing, CS handle, dsb) | Tidak ada aksi |
