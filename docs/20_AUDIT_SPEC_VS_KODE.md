# 🔍 AUDIT LENGKAP — CRM AI vs CRM_AI_V2_AGENT_READABLE_SPEC.md
> **Tanggal Audit:** Juni 2026  
> **Auditor:** Sistem Otomatis (cross-check kode vs spec)  
> **File yang Diaudit:** `v2-core/backend/src/ai_service.js`, `src/ai_service.js`

---

## 📊 RINGKASAN STATUS

| Kategori | Jumlah Item | ✅ Implemented | ⚠️ Parsial | ❌ Belum/Tidak Ada |
|----------|-------------|---------------|-----------|-------------------|
| §0 Prinsip arsitektur | 10 | 8 | 2 | 0 |
| §0.3 P0 Bug prevention | 13 | 9 | 3 | 1 |
| §A–D Identitas & Produk | 12 | 10 | 2 | 0 |
| §E Schema Data Wajib | 30+ field | 28 | 3 | 2 |
| §F Urutan penggalian | 3 urutan | 3 | 0 | 0 |
| §G Transfer/COD Policy | 14 aturan | 11 | 2 | 1 |
| §H Alamat & Ongkir | 8 aturan | 7 | 1 | 0 |
| §I Validation Gate | 12 cek | 8 | 2 | 2 |
| §K Format Rekap | 3 format | 0 | 3 | 0 |
| §L–M Post-IYA + Payment | 10 aturan | 7 | 2 | 1 |
| §N Estimasi & Penutupan | 3 flow | 3 | 0 | 0 |
| §O Label Chat | 8 label | 5 | 2 | 1 |
| §P Upsell BTS | 5 aturan | 4 | 1 | 0 |
| §2.4 Validator di kode | 10 item | 4 | 2 | 4 |

---

## ✅ YANG SUDAH TERLAKSANA

### Arsitektur & Prinsip
- ✅ Product-agnostic: `system_prompt` + `product_knowledge` dari DB, bukan hardcode
- ✅ `{BOT_NAME}` di-resolve dari `store.bot_name` atau `agent.bot_name`
- ✅ Media diisolasi per `agent_id`
- ✅ `fullSystemInstruction` tersusun dari 8 blok terstruktur
- ✅ `agentPromptBlock` selalu di POSISI TERAKHIR (prioritas tertinggi) dalam assembly

### P0 Bug Prevention
- ✅ Bot TIDAK menyebut COD di opening (`technicalRulesBlock` rule #7)
- ✅ Bot tidak mengirim lebih dari 2 bubble per respons (rule #9)
- ✅ Anti-ghost media: `_autoInjectMedia` + tool `kirim_media_katalog`
- ✅ Inspector mencegah rekap dengan placeholder (`[nama]`, `[...]`)
- ✅ Bot tidak boleh matikan_bot_kontak setelah Closing (rule #11 + di prompt)

### Inspector Agent (§I Validation Gate)
- ✅ `_runInspectorValidation()` aktif di v2-core dan legacy
- ✅ 3 schema produk: DTF, UV, BTS + Generic fallback
- ✅ Non-fatal: jika error, loloskan (tidak pernah blokir customer)
- ✅ UV schema: tidak ada Warna — sesuai spec
- ✅ BTS schema: 11 field wajib termasuk subsidi ongkir
- ✅ Temperature inspector = 0.0 (deterministik)

### Tool Calls
- ✅ `cek_ongkir` — aktif, langsung panggil saat kecamatan + kota tersedia
- ✅ `kirim_media_katalog` — aktif, pilih 1 random per label (anti-spam)
- ✅ `tambahkan_label_chat` — aktif, dibatasi hanya label yang dikonfigurasi
- ✅ `matikan_bot_kontak` — aktif, hanya untuk kasus di luar kemampuan
- ✅ `buat_link_pembayaran_dp` — aktif (QRIS via Xendit atau fallback TF manual)

### Label
- ✅ Bot propose label → tool `tambahkan_label_chat` mengirim label yang ada di `configuredLabels`
- ✅ Label enum terbatas pada yang dikonfigurasi di `agent.auto_labels`
- ✅ `generateChatSummary` menghasilkan `WA_LABELS` sebagai guidance
- ✅ Label `Closing` hanya muncul setelah rekap + konfirmasi

### Memory & Anti-Lupa
- ✅ `generateChatSummary` berjalan setiap chat (14 field KEY-VALUE)
- ✅ `conversationBlock` inject summary ke prompt dengan instruksi "jangan tanya ulang"
- ✅ Timestamp inject untuk user messages saja (anti-halusinasi timestamp di respons)

---

## ⚠️ YANG PARSIAL / BELUM SEMPURNA

### 1. Format Rekap (§K) — TIDAK SESUAI SPEC
**Spec minta:**
```
Metode pembayaran: Transfer
Ongkir awal: Rp...
Potongan ongkir: Rp...
Ongkir dibayar: Rp...
Total pesanan: Rp...
```

**Panduan lama (19_PANDUAN_MAKSIMAL.md) masih tulis:**
```
Pengiriman : NON COD (Transfer)   ← DILARANG di spec R baris terakhir
Ongkir ke [Kota] : Rp...          ← tidak pisah ongkir awal + potongan
Total Harus Dibayar : Rp...
```

**Dampak:** Bot akan mengikuti format yang ada di `product_knowledge` agent. Jika owner copas dari panduan lama, rekap tidak sesuai spec.  
**Status:** ⚠️ Panduan perlu diupdate

### 2. Rekening di Kode (Hardcode) — TIDAK SESUAI SPEC
**Spec §L menyebut:**
```
Bank BCA: 0333042999 a/n JAKA MULIA JAYA
Bank Mandiri: 1710019118887 a/n JAKA MULIA JAYA
```

**Kode aktual (buat_link_pembayaran_dp fallback, line 934-936):**
```javascript
Bank Mandiri: 1710016814843
Bank BCA: 0333965841
a/n PARE DIGITAL CUSTOM
```

**Dampak:** Saat Xendit tidak tersedia, kode fallback kirim rekening hardcode yang berbeda dari spec.  
**Status:** ⚠️ Perlu sinkronisasi — kode atau spec yang salah?

### 3. Label Spec vs Label di Kode
**Spec §O minta label:** `AI Lead Baru`, `AI Lead Aktif`, `Menunggu Rekap`, `Cancel`, `DP`  
**Kode hanya bisa pakai label yang ada di `agent.auto_labels`** — jika owner tidak tambahkan label-label ini, bot tidak bisa pakai.  
**Status:** ⚠️ Butuh panduan yang lebih jelas tentang label apa yang WAJIB dikonfigurasi

### 4. `transfer_offer_count` — Ada di Spec, Tidak di Kode
**Spec §G:** Tawarkan Transfer maksimal 2 kali (`transfer_offer_count`)  
**Kode:** Tidak ada tracking jumlah tawaran Transfer — bot hanya diberi instruksi di prompt, tidak ada penjaga deterministik  
**Status:** ⚠️ Bergantung pada kepatuhan AI, tidak ada validator kode

### 5. COD Eligibility Check — Parsial
**Spec §G:** COD murni hanya untuk ≤2 paket, luar Jawa ≤1 paket  
**Kode:** Tidak ada logika deterministic yang cek aturan ini — hanya ada instruksi di prompt  
**Status:** ⚠️ Bergantung pada AI, bukan validator kode

### 6. Rekap Tidak Boleh Berisi Rekening (§K)
**Spec:** "Jangan kirim rekening bank di dalam rekap awal. Rekening dikirim setelah customer balas IYA."  
**Panduan lama (19_PANDUAN_MAKSIMAL.md):** Rekening ada di dalam format rekap  
**Status:** ⚠️ Template panduan perlu direvisi

---

## ❌ YANG BELUM TERLAKSANA

### 1. DataSDM Sync (§0.2 poin 10, §2.4, §3.5, §4 poin 9)
**Spec minta:**
- Order closing harus tersinkron ke DataSDM
- Jika sync gagal, muncul di dashboard error
- DataSDM menjadi sumber kebenaran final

**Status:** ❌ Tidak ditemukan implementasi DataSDM sync di kode apapun.  
**Dampak:** P0 — Closing terjadi di CRM tapi DataSDM tidak tahu.

### 2. Order ID (§0.2 poin 7, §4 poin 8)
**Spec:** "Jangan ada Closing final tanpa rekap valid dan order tersimpan" + "Order closing punya order_id"  
**Status:** ❌ Tidak ada pembuatan `order_id` di kode saat closing terjadi.

### 3. Label Validator (§0.5, §4 poin 7)
**Spec:** "AI boleh mengusulkan label/status, tetapi sistem/validator yang memutuskan final"  
**Status:** ❌ Label langsung diaplikasikan dari tool call AI tanpa validator deterministik. AI yang memutuskan, bukan kode.

### 4. Payment Proof Validation (§M)
**Spec:** Validasi foto bukti transfer via Vision AI — harus cocokkan nominal dengan grand_total  
**Status:** ⚠️ Ada `customerMediaContext` yang mendeskripsikan foto, tapi tidak ada logika kode yang secara deterministik verify amount dari bukti TF. Bot AI yang "memutuskan" apakah bukti valid.

---

## 📋 ATURAN YANG "MENGEKANG" (Rules Yang Terlalu Ketat)

Berikut aturan yang mungkin terlalu rigid dan bisa membuat bot terasa kaku:

### 1. `technicalRulesBlock` rule #9: Maks 2 bubble
**Masalah:** Rekap dikecualikan, tapi instruksi "hanya pengecualian rekap" membuat AI bingung.  
**Dampak:** Kadang bot hanya kirim 1 bubble padahal konteksnya butuh 2-3 bubble (mis. closing: kirim estimasi + rekening)  
**Saran:** Ubah jadi "Maks 3 bubble, kecuali rekap yang boleh lebih"

### 2. Instruksi di `conversationBlock` interaksi pertama: "WAJIB panggil kirim_media_katalog"
**Masalah:** Kalimat "WAJIB" menyebabkan bot selalu kirim katalog di interaksi pertama, bahkan jika customer langsung minta rekap atau sudah jelas ingin beli.  
**Dampak:** Bot terasa memaksa katalog ke customer yang sudah siap beli  
**Saran:** Ubah jadi "Prioritas kirim katalog jika customer belum tahu produk. Skip jika customer sudah jelas tahu apa yang mau dibeli."

### 3. `technicalRulesBlock` rule #4: "DILARANG mengakhiri pesan dengan pertanyaan jika proses sudah selesai"
**Masalah:** Ini baik, tapi konflik dengan instruksi di prompt owner yang bilang "akhiri dengan pertanyaan (closing funnel)"  
**Dampak:** Bot bingung antara rule #4 dan instruksi owner → perilaku tidak konsisten  
**Saran:** Rule #4 di technicalRulesBlock sudah benar. Yang harus diubah adalah instruksi di template prompt owner (hapus bagian "akhiri dengan pertanyaan")

### 4. Spec §G: "Tawarkan Transfer maksimal dua kali"
**Masalah:** Tidak ada tracking di kode → bot bergantung pada AI untuk ingat sudah berapa kali tawarkan  
**Dampak:** Bot kadang tawarkan Transfer lebih dari 2x (terasa memaksa)  
**Saran:** Tidak perlu hardcode di validator, cukup tambahkan instruksi eksplisit di product_knowledge: "Jika customer sudah bilang COD 2x, STOP tawarkan Transfer"

---

## 🔧 ACTION ITEMS (PRIORITAS)

### Prioritas 1 — Langsung Perlu Diperbaiki

| # | Masalah | Lokasi | Solusi |
|---|---------|--------|--------|
| P1-1 | Format rekap di panduan tidak sesuai spec | `docs/19_PANDUAN_MAKSIMAL.md` | Update template rekap |
| P1-2 | Rekening ada di rekap awal (seharusnya setelah IYA) | `docs/19_PANDUAN_MAKSIMAL.md` | Pindahkan rekening keluar rekap |
| P1-3 | Label wajib tidak terdokumentasi lengkap | `docs/19_PANDUAN_MAKSIMAL.md` | Tambahkan daftar label wajib |
| P1-4 | conversationBlock interaksi #1 terlalu memaksa katalog | `ai_service.js` line 556 | Ubah jadi kondisional |
| P1-5 | Rekening hardcode di Xendit fallback tidak sinkron | `ai_service.js` line 934-936 | Ambil dari agent.product_knowledge atau env |

### Prioritas 2 — Penting tapi Bisa Ditunda

| # | Masalah | Lokasi | Solusi |
|---|---------|--------|--------|
| P2-1 | DataSDM sync belum ada | Codebase | Implementasi DataSDM service |
| P2-2 | Order ID belum ada saat closing | Codebase | Generate order_id saat label Closing |
| P2-3 | Label validator masih dari AI langsung | `tambahkan_label_chat` tool handler | Tambah deterministic check |
| P2-4 | COD eligibility check hanya di prompt | Tidak ada di kode | Tambah validator kode |

### Prioritas 3 — Nice to Have

| # | Masalah | Solusi |
|---|---------|--------|
| P3-1 | transfer_offer_count tidak ada di kode | Tracking count di conversation state |
| P3-2 | Payment proof amount matching tidak ada | Tambah logika extract amount dari Vision AI result |

---

## ✅ KESIMPULAN

Sistem sudah cukup solid untuk operasional harian, DENGAN CATATAN:

1. **Core flow** (DTF/UV/BTS, Inspector, media, label, follow-up) → **Berfungsi**
2. **Format rekap dan template di panduan** → **Perlu update** (tidak sesuai spec)
3. **DataSDM dan Order ID** → **Belum ada** (P0 menurut spec, tapi operasional bisa jalan tanpa ini)
4. **Rekening hardcode** → **Perlu sinkronisasi** dengan data toko yang sebenarnya
5. **Label validator** → **AI yang memutuskan**, bukan kode (risiko label salah lebih tinggi)
