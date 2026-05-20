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
const MAX_CONCURRENCY = 3;    // Maks 3 request AI serentak
const QUEUE_TIMEOUT_MS = 120000; // Request kadaluarsa setelah 2 menit
```

### Mekanisme:
- Setiap request masuk → masuk ke `pendingQueue`
- Hanya **3 request** bisa diproses bersamaan
- Slot dibebaskan via `Promise.finally()` → **tidak pernah deadlock**
- Request yang menunggu > 2 menit otomatis digugurkan (mencegah balasan basi)

---

## Tool Calling

AI memiliki dua "alat" yang bisa dipanggil:

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
| `xxx.com...` | Hapus (domain fiktif) |
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

---

## Typing Delay (Human Simulation)

```javascript
function calculateTypingDelay(text, minCharDelay=60, maxDelay=5000) {
    const randomSpeed = random(60, 100); // ms per karakter
    const baseDelay = text.length * randomSpeed;
    const humanOffset = random(400, 1200); // noise manusia
    return Math.min(baseDelay + humanOffset, maxDelay); // cap 5 detik
}
```

Selama delay, status `sedang mengetik...` ditampilkan di WA.

---

## ChatSummary (Long-Term Memory)

Setelah setiap interaksi, AI generate ringkasan percakapan (background, non-blocking):

```
Prompt ke GPT-4o-mini:
"Buat REKAP PEMBAHASAN CHAT singkat (3-5 poin):
 1. Identitas pelanggan (jika sudah tahu)
 2. Produk yang diminati
 3. Progress diskusi (deal, tanya-tanya, mau kirim desain)"
```

Rekap ini disimpan di `ChatSummaries` dan digunakan sebagai **long-term memory** untuk sesi berikutnya dari pelanggan yang sama.

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
