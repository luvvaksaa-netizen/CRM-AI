# Database Schema — WA-AI-CS

> **Engine:** SQLite3 via Sequelize ORM  
> **Mode:** WAL (Write-Ahead Logging) untuk concurrent access  
> **Lokasi:** `DATA_DIR/database.sqlite` (default: `./data/database.sqlite`)

---

## Entity Relationship Diagram

```
BotAgents (1) ──────── (Many) Stores (Nomor WA)
    │
    └── (1) ─────────── (Many) MediaAssets
    
Stores (1) ──────────── (Many) ChatMessages
Stores (1) ──────────── (Many) ChatSummaries (per contact)
```

---

## Model: `BotAgents`

**Fungsi:** Otak/konfigurasi AI. Satu agen bisa dipakai banyak nomor WA (multi-tenant).

| Kolom | Tipe | Default | Keterangan |
|-------|------|---------|------------|
| `id` | INTEGER PK | auto | Primary key |
| `name` | STRING | null | Nama internal agen (admin) |
| `bot_name` | STRING | 'CS Bot' | Nama yang ditampilkan ke pelanggan |
| `system_prompt` | TEXT | '' | Instruksi kepribadian & perilaku AI |
| `product_knowledge` | TEXT | '' | Knowledge base produk (teks bebas) |
| `createdAt` | DATE | now | Auto-managed oleh Sequelize |
| `updatedAt` | DATE | now | Auto-managed oleh Sequelize |

---

## Model: `Stores`

**Fungsi:** Representasi satu nomor WhatsApp / perangkat yang terdaftar.

| Kolom | Tipe | Default | Keterangan |
|-------|------|---------|------------|
| `id` | INTEGER PK | auto | Primary key |
| `wa_id` | STRING UNIQUE | - | Identifier unik (slug dari nama toko) |
| `name` | STRING | 'Perangkat Baru' | Nama tampilan toko |
| `agent_id` | INTEGER FK | null | Referensi ke BotAgent |
| `is_bot_active` | BOOLEAN | true | Toggle AI on/off |
| `last_active` | DATE | now | Timestamp terakhir aktif |
| `connection_mode` | STRING | 'wwebjs' | **Legacy** (selalu 'wwebjs', kolom dipertahankan agar DB aman) |
| `roketchat_token` | STRING | null | **Legacy** (tidak lagi dipakai) |
| `roketchat_device_id` | STRING | null | **Legacy** (tidak lagi dipakai) |
| `roketchat_phone` | STRING | null | **Legacy** (tidak lagi dipakai) |
| `bot_name` | STRING | - | **Legacy** (dipindah ke BotAgent) |
| `system_prompt` | TEXT | - | **Legacy** (dipindah ke BotAgent) |
| `product_knowledge` | TEXT | - | **Legacy** (dipindah ke BotAgent) |

---

## Model: `MediaAssets`

**Fungsi:** Katalog foto & video produk per agen AI.

| Kolom | Tipe | Default | Keterangan |
|-------|------|---------|------------|
| `id` | INTEGER PK | auto | Primary key |
| `agent_id` | INTEGER FK | null | Pemilik agen |
| `store_wa_id` | STRING | null | **Legacy** |
| `filename` | STRING | null | Nama file fisik di `UPLOADS_DIR` |
| `original_name` | STRING | - | Nama file asli saat upload |
| `type` | ENUM | null | `'image'` atau `'video'` |
| `label` | STRING | - | Label/judul media |
| `description` | TEXT | - | Deskripsi manual dari admin |
| `ai_analysis` | TEXT | '' | Hasil analisis GPT-4o Vision |
| `video_transcript` | TEXT | '' | Hasil transkripsi Whisper |
| `trigger_words` | STRING | '' | Kata kunci pemicu kirim otomatis (comma-separated) |
| `purpose` | ENUM | 'both' | `'both'` / `'knowledge_only'` / `'send_only'` |
| `analysis_status` | ENUM | 'pending' | `'pending'` / `'processing'` / `'done'` / `'failed'` |

### Penjelasan `purpose`:
- **`both`**: Digunakan sebagai knowledge AI SEKALIGUS bisa dikirim ke pelanggan
- **`knowledge_only`**: AI tahu tentang ini, tapi TIDAK bisa dikirimkan
- **`send_only`**: Bisa dikirim ke pelanggan, tapi AI tidak "belajar" darinya

---

## Model: `ChatMessages`

**Fungsi:** Histori percakapan CRM (per-store, per-contact).

| Kolom | Tipe | Default | Keterangan |
|-------|------|---------|------------|
| `id` | INTEGER PK | auto | Primary key |
| `store_wa_id` | STRING | required | Nomor WA toko pengirim |
| `contact_id` | STRING | required | JID pelanggan (`62xxx@s.whatsapp.net`, `62xxx@c.us`, atau `xxxxx@lid`) |
| `wa_message_id` | STRING | null | ID pesan WhatsApp asli untuk reaction/forward via WA-JS |
| `sender_name` | STRING | - | Nama tampilan pengirim |
| `contact_display_name` | STRING | null | Nama aman untuk CRM; `@lid` tidak diformat sebagai nomor telepon |
| `contact_phone` | STRING | null | Nomor WA asli jika diketahui dan domain kontak memang phone-based |
| `contact_lid` | STRING | null | Local part untuk kontak `@lid` |
| `contact_type` | STRING | null | `phone`, `lid`, `broadcast`, `newsletter`, `group`, atau `unknown` |
| `contact_source` | STRING | null | Sumber display name: `profile`, `phone`, `lid`, dll |
| `quoted_message_id` | STRING | null | ID pesan WhatsApp yang sedang di-reply/di-quote |
| `quoted_body` | TEXT | null | Cuplikan isi pesan asal untuk ditampilkan di dashboard |
| `quoted_from_me` | BOOLEAN | null | `true` jika pesan asal dari admin/bot, `false` jika dari customer |
| `quoted_sender_name` | STRING | null | Nama pengirim pesan asal |
| `body` | TEXT | - | Isi pesan (bisa berisi tag `[MEDIA:...]`) |
| `type` | STRING | 'chat' | Tipe pesan |
| `is_from_me` | BOOLEAN | false | `true` = dari bot/admin, `false` = dari pelanggan |
| `timestamp` | DATE | now | Waktu pesan |

Catatan identitas kontak:
- `@lid` adalah private WhatsApp ID, bukan nomor telepon. CRM menampilkan `Kontak WA #xxxxxx` sampai nomor asli diminta/tersedia.
- `@broadcast`, `@newsletter`, dan `@g.us` tidak masuk pipeline customer chat agar daftar pelanggan tetap bersih.

---

## Model: `ChatSummaries`

**Fungsi:** Rekap pembahasan per pelanggan untuk long-term memory AI.

| Kolom | Tipe | Default | Keterangan |
|-------|------|---------|------------|
| `store_wa_id` | STRING PK | required | Composite primary key |
| `contact_id` | STRING PK | required | Composite primary key |
| `contact_name` | STRING | '' | Nama tampilan pelanggan |
| `summary` | TEXT | 'Belum ada rekapan.' | Rekap AI (3-5 poin) dari riwayat chat |
| `last_updated` | DATE | now | Timestamp update terakhir |

---

## Model: `PausedContacts`

**Fungsi:** Menyimpan status pause (Human Override) per kontak. Persisten saat restart.

| Kolom | Tipe | Default | Keterangan |
|-------|------|---------|------------|
| `store_wa_id` | STRING PK | required | Composite primary key |
| `contact_id` | STRING PK | required | Composite primary key |
| `paused_at` | DATE | now | Timestamp saat dipause |
| `paused_by` | STRING | 'manual' | Siapa yang pause: `'manual'` (CS) atau `'auto'` (sistem) |

---

## Migrasi & Lifecycle

### Auto-Migration saat Startup (`initDB()`):
1. `sequelize.sync()` — buat tabel baru jika belum ada
2. `safeAddColumn()` — tambah kolom baru tanpa drop tabel (aman untuk production)
3. `migrateLegacyData()` — migrasi data Store lama (yang masih pakai `system_prompt` di tabel Store) ke arsitektur BotAgent baru
4. `backfillSummaryNames()` — isi `contact_name` yang kosong dari histori chat

5. `backfillContactIdentity()` - membersihkan nama `@lid` lama yang sebelumnya tersimpan seperti nomor palsu dan mengisi kolom identitas kontak baru
6. Kolom quoted reply (`quoted_message_id`, `quoted_body`, `quoted_from_me`, `quoted_sender_name`) ditambahkan agar dashboard tahu setiap balasan mengacu ke pesan mana.

### Mode WAL:
```sql
PRAGMA journal_mode=WAL;
```
Diaktifkan di startup untuk performa concurrent read/write yang lebih baik.
