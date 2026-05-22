# AI Engine — Cara Kerja & Arsitektur

> **File:** `src/ai_service.js`  
> **Model Chat:** `gpt-4o-mini` (default, configurable via `.env`)  
> **Model Vision:** `gpt-4o` (hardcoded, required for vision)  
> **Model Audio:** `whisper-1`

---

## Konsep Inti

AI Engine adalah "otak" sistem yang mengorkestrasi semua kecerdasan. Ia tidak berdiri sendiri — ia menerima **konteks yang sangat kaya** sebelum membuat keputusan balasan.

### Konteks yang Diberikan ke AI (Per Request):
1. **System Prompt** — Kepribadian & aturan dasar bot (dari `BotAgent`)
2. **Waktu Saat Ini** — Untuk sapaan kontekstual (pagi/siang/malam)
3. **Product Knowledge** — Pengetahuan produk toko
4. **Knowledge Media** — Analisis AI dari foto/video yang sudah diupload
5. **Sendable Catalog** — Daftar ID media yang bisa dikirim ke pelanggan
6. **Long-Term Memory (ChatSummary)** — Rekap pembahasan sesi sebelumnya
7. **Recent History** — 15 pesan terakhir dalam percakapan ini
8. **Draconian Rules** — Aturan teknis mutlak (ditempatkan di akhir untuk prioritas tinggi)
9. **User Message** — Pesan terkini dari pelanggan (dengan konteks media jika ada)

---

## Concurrency Queue (Deadlock-Proof)

```javascript
const MAX_CONCURRENCY = 10;   // Maks 10 request AI serentak
const QUEUE_TIMEOUT_MS = 60000; // Request kadaluarsa setelah 1 menit
```

### Mekanisme:
- Setiap request masuk → masuk ke `pendingQueue`
- Hanya **10 request** bisa diproses bersamaan
- Slot dibebaskan via `Promise.finally()` → **tidak pernah deadlock**
- Request yang menunggu > 1 menit otomatis digugurkan (mencegah balasan basi)

---

## Tool Calling

AI memiliki tiga "alat" yang bisa dipanggil:

### Tool 1: `cek_ongkir_jne`
```json
{
  "name": "cek_ongkir_jne",
  "description": "Mengecek biaya ongkos kirim JNE dari Kediri",
  "parameters": {
    "destinationCity": "string",
    "weightGrams": "integer (default: 1000)"
  }
}
```
Flow:
1. AI deteksi pelanggan tanya ongkir
2. Panggil tool → `rajaongkir_service.getJneOngkir()`
3. Hasil dikembalikan ke AI → AI compose jawaban natural

### Tool 2: `kirim_media_katalog`
```json
{
  "name": "kirim_media_katalog",
  "description": "Mengirimkan foto/video produk kepada pelanggan",
  "parameters": {
    "media_ids": ["array of integer IDs"],
    "caption": "string"
  }
}
```
Flow:
1. AI memutuskan media mana yang relevan berdasarkan katalog yang diberikan
2. Panggil tool → cari `MediaAsset` dari DB berdasarkan ID
3. Filter: hanya yang `purpose !== 'knowledge_only'`
4. Return ke message_handler → kirim file fisik ke WA

### Tool 3: `tambahkan_label_chat`
Aktif hanya jika `BotAgent.auto_labels` berisi daftar label.

Flow:
1. AI memilih label dari konfigurasi agen, misalnya `Hot Lead` atau `Menunggu Transfer`
2. `message_handler` mengeksekusi label via WA-JS `WPP.labels.*`
3. Jika WA-JS/WA Business label belum tersedia, pipeline chat tetap lanjut dan hanya menulis warning

---

## Alur Proses AI (Dua Langkah)

```
Pesan Masuk
    │
    ▼
FIRST API CALL (dengan tools)
    ├── AI jawab teks biasa → langsung return
    └── AI panggil tool(s) →
            ├── Eksekusi tool (ongkir / media)
            ├── Append hasil tool ke messages
            └── SECOND API CALL (tanpa tools)
                    └── AI compose jawaban akhir
```

---

## Sanitizer Output (Guard Level Production)

Sebelum pesan dikirim ke WA, selalu melewati `sanitizeTextOutput()`:

| Pattern | Aksi |
|---------|------|
| `![...](...)`  | Hapus (markdown image) |
| `https://...` | Hapus (link fiktif) |
| `example.com` / placeholder domain | Hapus (domain fiktif) |
| `[MEDIA:...]` | Hapus (tag internal bocor) |
| `[VIDEO:...]` | Hapus (tag internal bocor) |
| `ID: 123` | Hapus (ID sistem bocor) |
| `[WAKTU: ...]` | Hapus (timestamp bocor) |
| `(Dikirim DD MMM HH:mm)` | Hapus (timestamp bocor) |
| `\n{3,}` | Normalisasi jadi `\n\n` |

---

## Strategi Prompt (Bottom-Weighted Priority)

```
[System: fullSystemInstruction]  ← Kepribadian & context
[User: hist message 1]           ← History percakapan
[Asst: hist reply 1]
[User: hist message 2]
...
[System: draconianRules]         ← ATURAN TEKNIS (di akhir = prioritas TINGGI)
[User: pesan_sekarang]           ← Input terkini
```

> **Kenapa aturan diletakkan di akhir?** Karena model LLM memberikan bobot lebih tinggi pada context yang posisinya lebih dekat ke akhir prompt (bottom-weighting). Ini memastikan larangan tidak bisa "dilupakan" oleh model.

Aturan teknis terbaru tidak lagi memaksa satu pesan panjang. Untuk chat normal, AI boleh memisahkan baris; setiap baris dikirim sebagai satu bubble WhatsApp pendek (maksimal 10 kata). Rekap order/payment tetap boleh panjang agar detail transaksi tidak hilang.

---

## Typing Delay (Human Simulation)

```javascript
function calculateTypingDelay(text, minCharDelay=18, maxDelay=650) {
    const randomSpeed = random(18, 32); // ms per karakter
    const baseDelay = text.length * randomSpeed;
    const humanOffset = random(80, 180); // noise manusia ringan
    return Math.min(baseDelay + humanOffset, maxDelay); // cap 650ms
}
```

Debounce balasan default sekarang `AI_REPLY_DEBOUNCE_MS=1400`. Typing WA-JS hanya dipakai jika `WPP` sudah ready; jika belum, sistem langsung fallback ke WWebJS supaya tidak menunggu injeksi ulang.

---

## ChatSummary (Long-Term Memory)

Setelah setiap interaksi, AI generate ringkasan percakapan (background, non-blocking):

```
Prompt ke GPT-4o-mini:
"Buat REKAP PEMBAHASAN CHAT untuk dashboard CS:
 identitas, produk, varian, teks custom, jumlah, alamat,
 harga, ongkir, total, metode bayar, data kurang, dan next action."
```

Rekap diambil dari 50 pesan terbaru setelah balasan bot terkirim, disimpan di `ChatSummaries`, dan digunakan sebagai **long-term memory** untuk sesi berikutnya dari pelanggan yang sama.

---

## Voice Note Support (Whisper)

```
Customer kirim voice note (audio/*)
    │
    ▼
Download media (timeout 20s)
    │
    ▼
Simpan ke UPLOADS_DIR sementara
    │
    ▼
transcribeAudio() → openai.audio.transcriptions (whisper-1, lang: id)
    │
    ▼
customerMediaContext = "[AI-TRANSKRIPSI: teks hasil whisper]"
    │
    ▼
Dikirim sebagai konteks ke AI (AI "mendengar" voice note)
    │
    ▼
File sementara DIHAPUS (anti-leak storage)
```

---

## Vision Support (Foto Pelanggan)

```
Customer kirim foto
    │
    ▼
Download media (timeout 20s)
    │
    ▼
Simpan ke UPLOADS_DIR sementara
    │
    ▼
analyzeImage(filePath, storeContext) → GPT-4o Vision
    │
    ▼
customerMediaContext = "[MEDIA:/uploads/xxx] [AI-VISION: deskripsi]"
    │
    ▼
Dikirim sebagai konteks ke AI (AI "melihat" foto)
    │
    ▼
File sementara DIHAPUS (anti-leak storage)
```

---

## Fitur & Peningkatan Lanjutan (Multi-Product AI)

### 1. Memori Terstruktur (Structured Memory)
Untuk mengatasi masalah bot "lupa" data yang sudah dikirim oleh customer (seperti nama pemesan, jumlah, varian, dan alamat), sistem menggunakan **Key-Value Extraction** terstruktur. 
- Di akhir setiap percakapan, AI menghasilkan rekap format JSON/Key-Value:
  ```yaml
  NAMA PEMESAN: [Nama]
  JUMLAH ORDER: [Jumlah]
  VARIAN PRODUK: [Varian]
  ALAMAT KIRIM: [Alamat Lengkap]
  STATUS CLOSE: [YA/TIDAK]
  ```
- Data terstruktur ini disuntikkan ke prompt berikutnya dengan prioritas tertinggi.

### 2. Aturan Bobot Bawah (Bottom-Weighted Rules)
OpenAI API cenderung memprioritaskan instruksi yang diletakkan di bagian paling akhir prompt (*recency bias*). Oleh karena itu, semua aturan draconian (seperti "DILARANG menanyakan ulang nama/jumlah/varian/alamat jika sudah ada di memori") diletakkan di **bagian paling bawah prompt** sebelum pesan user dikirim. Hal ini memaksa model untuk mematuhinya secara mutlak.

### 3. Opening Flow Otomatis (Media-Driven)
Pada interaksi pertama dengan pelanggan baru (di mana belum ada histori percakapan), AI secara otomatis diinstruksikan untuk memanggil tool `kirim_media_katalog` guna mengirimkan:
- 1 Gambar Varian produk (contoh: catalog DTF/UV)
- 1 Video Demonstrasi produk
Ini memastikan alur onboarding pelanggan lebih visual, premium, dan interaktif.

### 4. Dynamic Store Bot Names
Meskipun menggunakan model Master Agent (otak tunggal) yang sama untuk melayani beberapa produk, nama CS/bot di-render secara dinamis menggunakan placeholder `{BOT_NAME}` yang digantikan dengan nilai `bot_name` dari tabel `Store` masing-masing perangkat.

