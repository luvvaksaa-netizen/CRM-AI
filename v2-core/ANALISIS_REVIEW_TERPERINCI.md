# Analisis Ulang Temuan QA — Verifikasi Kode Aktual

## 📋 Ringkasan Review User
Anda telah melakukan review mendalam terhadap 10 bug/masalah di codebase. Berikut analisis detail saya berdasarkan inspeksi langsung ke source code.

---

## 🔴 BUG 1 — Inspector: JSON Parsing "Unexpected end of JSON input"

### Status: ✅ VERIFIKASI BENAR, tapi INCOMPLETE

**Kode Aktual** (`ai_service.js` L572):
```javascript
max_tokens: 600, // Dinaikkan dari 200
```

**Analisis Anda**: BENAR
- Max tokens sudah dinaikkan ke 600
- Ini mencegah terpotongnya JSON di tengah
- Tapi masih bisa error jika missing field list sangat panjang

**Rekomendasi Anda**: SANGAT VALID
```javascript
const lastBrace = cleanRaw.lastIndexOf('}');
const safeRaw = lastBrace >= 0 ? cleanRaw.slice(0, lastBrace + 1) : cleanRaw;
const result = JSON.parse(safeRaw);
```

**Verifikasi Fix**: 
- Kode saat ini (L576-580):
```javascript
const cleanRaw = raw
  .replace(/```json/gi, "")
  .replace(/```/g, "")
  .trim();
const result = JSON.parse(cleanRaw);  // ← MASIH LANGSUNG PARSE
```
- **BELUM menggunakan trick `lastIndexOf`** ← Ini perlu ditambahkan!

### ✅ Rekomendasi Anda untuk FIX:
**BENAR dan PERLU SEGERA DITERAPKAN** — Tambahkan sebelum JSON.parse():
```javascript
const lastBrace = cleanRaw.lastIndexOf('}');
const safeRaw = lastBrace > 0 ? cleanRaw.substring(0, lastBrace + 1) : cleanRaw;
try {
  const result = JSON.parse(safeRaw);
  return { valid: result.valid !== false, missing: result.missing || "" };
} catch (e) {
  logger.error(`[Inspector] JSON parse gagal bahkan setelah trim: ${e.message}`);
  return { valid: true }; // Non-fatal fallback
}
```

---

## 🔴 BUG 2 — Learning Service: Fallback JSON Parse Gagal

### Status: ⚠️ VERIFIKASI BENAR, Fallback Ada Tapi Terbatas

**Kode Aktual** (`learning_service.js` L214-230):
```javascript
const contentText = response.choices[0]?.message?.content || '{}';
let parsed = {};
try {
    parsed = JSON.parse(contentText);
} catch (e) {
    try {
        // Fallback 1: extract {...}
        const match = contentText.match(/\{([\s\S]*)\}/);
        if (match) parsed = JSON.parse(match[0]);
        else {
            // Fallback 2: extract [...]
            const matchArr = contentText.match(/\[([\s\S]*)\]/);
            if (matchArr) parsed = JSON.parse(matchArr[0]);
        }
    } catch (e2) {
        console.error('[Learning] Fallback JSON parse gagal:', e2.message);
    }
}
return parsed;  // Bisa return {} jika semua error
```

**Analisis Anda**: BENAR
- Fallback regex ada tapi masih bisa gagal pada JSON yang tidak valid
- Contoh: `{"patterns": [{"text": "unclosed string` → regex extract tapi JSON masih rusak

**Rekomendasi Anda**: SANGAT VALID
```javascript
const sanitized = contentText
  .replace(/[\x00-\x1F\x7F]/g, ' ')  // hapus control chars
  .replace(/,\s*}/g, '}')             // hapus trailing comma
  .replace(/,\s*]/g, ']');            // hapus trailing comma di array
const parsed = JSON.parse(sanitized);
```

**Verifikasi Fix Lebih Dalam**:
- Fallback sekarang tidak ada sanitasi (tidak hapus control char, trailing comma)
- ✅ **Rekomendasi Anda PERLU DITERAPKAN** — Tambahkan setelah `catch (e2)`:

```javascript
} catch (e2) {
    // Last resort: Sanitasi dan coba lagi
    try {
        const sanitized = contentText
            .replace(/[\x00-\x1F\x7F]/g, ' ')
            .replace(/,\s*}/g, '}')
            .replace(/,\s*]/g, ']')
            .replace(/'/g, '"');  // single quote → double quote jika perlu
        parsed = JSON.parse(sanitized);
    } catch (e3) {
        logger.warn('[Learning] Semua fallback gagal, return empty object');
        parsed = {};
    }
}
```

---

## 🟡 BUG 3 — DSML Format Bocor ke Customer

### Status: ✅ VERIFIKASI BENAR, tapi MASIH ADA BLIND SPOT

**Kode Aktual** (`ai_service.js` L1273-1325):
```javascript
const DSML_RE = /<[|\uFF5C]{2}DSML[|\uFF5C]{2}tool_calls>/i;
if (responseMessage.content && DSML_RE.test(responseMessage.content)) {
    const invokeRegex =
        /<[|\uFF5C]{2}DSML[|\uFF5C]{2}invoke name="([^"]+)">([\s\S]*?)<\/[|\uFF5C]{2}DSML[|\uFF5C]{2}invoke>/gi;
    // ... parse manual
    
    // Bersihkan text DSML
    responseMessage.content = responseMessage.content
        .replace(
            /<[|\uFF5C]{2}DSML[|\uFF5C]{2}tool_calls>[\s\S]*?<\/[|\uFF5C]{2}DSML[|\uFF5C]{2}tool_calls>/gi,
            "",
        )
        .trim();
}
```

**Sanitizer di L1861-1864**:
```javascript
clean = clean.replace(
    /<[|\uFF5C]{2}DSML[|\uFF5C]{2}[\s\S]*?<\/[|\uFF5C]{2}DSML[|\uFF5C]{2}[^>]*>/gi,
    "",
);
```

**Analisis Anda**: BENAR
- Ada 2 lapis parser
- Tapi regex ini menggunakan `[\s\S]*?` (lazy) yang bisa gagal pada nested tags
- Contoh: `<｜｜DSML｜｜invoke name="func1"><｜｜DSML｜｜inner>...` → lazy match mungkin stop di inner close tag

**Problem Actual**:
- Regex `[\s\S]*?` akan match dari opening tag ke CLOSING TAG PERTAMA yang ditemukan
- Jika ada nested tags atau tag yang tidak ditutup dengan benar, bisa ada sisa
- Contoh FAIL:
```
<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke...>
  <｜｜DSML｜｜param>...
</｜｜DSML｜｜param>
</｜｜DSML｜｜invoke>
```
Regex lazy match dari `<｜｜DSML｜｜tool_calls>` akan stop di `</｜｜DSML｜｜param>` yang PERTAMA ← BUG!

### ✅ Rekomendasi: Perbaikan Regex Lebih Ketat

Perlu menggunakan **greedy match** atau **recursive parsing** untuk nested tags:
```javascript
// Opsi 1: Greedy match (hapus SEMUA dari opening sampai CLOSING tag paling akhir)
clean = clean.replace(
    /<[|\uFF5C]{2}DSML[|\uFF5C]{2}[\s\S]+?<\/[|\uFF5C]{2}DSML[|\uFF5C]{2}[^>]*>/g,
    ""
);

// Opsi 2: Tambahkan cleanup untuk sisa tag yang tertinggal
clean = clean.replace(/<[|\uFF5C]{2}DSML[|\uFF5C]{2}[^>]*>/gi, "");
clean = clean.replace(/<\/[|\uFF5C]{2}DSML[|\uFF5C]{2}[^>]*>/gi, "");
```

---

## 🟡 BUG 4 — Tab Evolusi Prompt Kosong & Dropdown Agent Kosong

### Status: ✅ VERIFIKASI BENAR (Ini Data Problem, bukan Code Bug)

**Kode Frontend** (`LearningCenter.tsx` L195-204):
```javascript
const fetchAgents = async () => {
    try {
        const res = await api.get("/agents");
        const normalized = (res.data || []).map((a: any) => ({
            id: a.id,
            name: a.name || a.bot_name || `Agent #${a.id}`,
        }));
        setAgents(normalized);
    } catch {}  // ← CATCH KOSONG — user tidak tahu ada error
};
```

**Analisis Anda**: BENAR 200%
1. ✅ API endpoint sudah ada (`learning.controller.ts`)
2. ✅ Normalisasi sudah benar (name || bot_name || fallback)
3. ⚠️ **Tapi: CATCH tidak ada feedback** — jika API 404/500, user tidak tahu

**Penyebab Tab Evolusi Kosong**:
- Ini bukan code bug, tapi **data tidak ada di database**
- Table `PromptEvolutionLog` mungkin kosong karena:
  1. Prompt Revision Engine belum dijalankan
  2. Belum ada cukup closing (treshold untuk trigger revisi belum tercapai)
  3. Query API `/learning/evolutions` mengembalikan empty array

### ✅ Fix yang Diperlukan:

**Tambahkan error feedback di Frontend**:
```javascript
const fetchAgents = async () => {
    try {
        const res = await api.get("/agents");
        const normalized = (res.data || []).map((a: any) => ({
            id: a.id,
            name: a.name || a.bot_name || `Agent #${a.id}`,
        }));
        setAgents(normalized);
    } catch (err) {
        logger.warn('[Learning] Gagal fetch agents:', err.message);
        toast.warning("Daftar agent tidak bisa dimuat — refresh halaman");
    }
};
```

**Verifikasi Data di Backend**:
Jalankan query untuk cek apakah data ada:
```sql
SELECT COUNT(*) as total_agents FROM Agents;
SELECT COUNT(*) as total_evolutions FROM PromptEvolutionLogs;
SELECT COUNT(*) as total_patterns FROM ClosingPatterns;
```

---

## 🟡 BUG 5 & 6 — Resi Mengantar: Relasi Toko & Detail Status

### Status: ✅ VERIFIKASI BENAR, Mapping Ada Tapi Display Belum Sempurna

**Kode Backend** (`mengantar.controller.ts` L33-57):
```javascript
// Mapping: ambil dari ChatSummary berdasarkan nomor HP
const summaries = await ChatSummary.findAll({...});
const summaryMap = {};
for (const s of summaries) {
    const norm = s.contact_phone.replace(/\D/g, '');
    if (norm) summaryMap[norm] = s.toJSON();
}

// Match pesanan dengan kontak
result.data = result.data.map((order: any) => {
    const cPhone = String(order.customer_phone || '').replace(/\D/g, '');
    if (cPhone) {
        const match = summaryMap[cPhone] || summaryMap[...fallbacks...];
        if (match) order.crm_mapped_contact = match;
    }
    return order;
});
```

**Kode Frontend** (`Orders.tsx` L627-642):
```javascript
{o.crm_mapped_contact ? (
    <div className="flex flex-col gap-0.5">
        {o.crm_mapped_contact.contact_name && (
            <span>{o.crm_mapped_contact.contact_name}</span>
        )}
        <span>📱 {o.crm_mapped_contact.store_wa_id...replace("@c.us", "")}</span>
    </div>
) : <span>—</span>}
```

**Analisis Anda**: BENAR

### Masalah Aktual:
1. ✅ Mapping via nomor HP sudah ada
2. ✅ Contact name sudah ditampilkan
3. ❌ **Nama TOKO belum ada** — hanya nomor WA toko mentah
4. ❌ **Filter by toko belum ada** — user tidak bisa filter "resi dari toko saya saja"
5. ❌ **Detail status terbatas** — hanya status umum, tidak ada tracking detail

### ✅ Fix yang Diperlukan:

**Backend**: Tambahkan lookup nama toko
```javascript
// Di mengantar.controller.ts, setelah mapping summaries
const stores = await Store.findAll({
    attributes: ['id', 'wa_id', 'store_name'],
});
const storeMap = {};
stores.forEach(s => {
    const waId = String(s.wa_id || '').replace(/\D/g, '');
    if (waId) storeMap[waId] = s.store_name;
});

// Sebelum return, tambahkan store_name
result.data = result.data.map((order: any) => {
    if (order.crm_mapped_contact?.store_wa_id) {
        const storeWaId = String(order.crm_mapped_contact.store_wa_id).replace(/\D/g, '');
        order.crm_mapped_contact.store_name = storeMap[storeWaId] || 'Toko Tidak Terdaftar';
    }
    return order;
});
```

**Frontend**: Tampilkan nama toko + tambahkan filter
```javascript
// Tampilkan nama toko bukan nomor mentah
{o.crm_mapped_contact?.store_name && (
    <span className="text-slate-500">🏪 {o.crm_mapped_contact.store_name}</span>
)}

// Tambahkan filter dropdown
<select value={filterStore} onChange={(e) => setFilterStore(e.target.value)}>
    <option value="">Semua Toko</option>
    {stores.map(s => (
        <option key={s.id} value={s.wa_id}>{s.store_name}</option>
    ))}
</select>
```

---

## 🔴 BUG 7 — Label WA Terlalu Banyak & Duplikat

### Status: ✅ VERIFIKASI BENAR (Kompleks, Ada 3 Akar Masalah)

**Kode Aktual**:

**Smart Label Service** (`smart-label.service.ts` L56-63):
```javascript
const LABELS_TO_REMOVE_ON_CLOSING: string[] = ['Cancel'];
const LABELS_TO_REMOVE_ON_CANCEL: string[] = ['Closing', 'Transfer', 'COD'];
```

**Case-insensitive match** (L603):
```javascript
let lbl = allLabels.find(l => String(l.name || '').toLowerCase() === clean.toLowerCase());
```

**DB Merge** (L429):
```javascript
const mergedLabels = [...new Set([...existingLabels, ...effectiveLabelNames])];
// ← Ini hanya dedup dalam array itu sendiri, tapi TIDAK PERNAH REMOVE label lama
```

**wajs_bridge.js** (L503-514):
```javascript
async function ensureLabel(client, name, color) {
    const cleanName = String(name || "").trim();
    const labels = await getLabels(client, storeWaId);
    
    // ✅ Case-insensitive check sudah ada
    const existing = labels.find(
        (label) => String(label.name || "").toLowerCase() === cleanName.toLowerCase(),
    );
    if (existing) return existing;
    // ... create label jika tidak ada
}
```

**Analisis Anda**: BENAR untuk semua 3 penyebab

### Akar Masalah yang Diverifikasi:

#### A) Label Lama Tidak Dihapus Saat Status Berubah — ✅ BENAR
Masalah: Jika dulu label "Transfer", sekarang jadi "COD", label "Transfer" tetap ada
- `LABELS_TO_REMOVE_ON_CLOSING` hanya hapus saat → Closing
- `LABELS_TO_REMOVE_ON_CANCEL` hanya hapus saat → Cancel
- **Tidak ada cleanup untuk status change lainnya** (Transfer → COD)

#### B) Case-Insensitive Konsistensi — ✅ TAPI TERBATAS
- Di `applyManualLabelOps` (smart-label.service.ts L603): ✅ Case-insensitive
- Di `ensureLabel` (wajs_bridge.js L510-513): ✅ Case-insensitive
- **Tapi**: Jika label sudah ada di WA dengan nama "closing" (lowercase), terus ditambah "Closing" (uppercase), sistem akan:
  1. `ensureLabel` cek: "closing" lowercase = "Closing" lowercase ✅ Match found, return
  2. **TAPI** di `_persistLabelsToDb` (L429), array `mergedLabels` hanya dedup dalam array, tidak cek nama case-insensitive di DB

#### C) mergedLabels Merge Tanpa Cleanup — ✅ BENAR
```javascript
const mergedLabels = [...new Set([...existingLabels, ...effectiveLabelNames])];
```
- Ini dedup duplikat dalam array (jika ada "Transfer" 2x, jadi 1)
- Tapi **TIDAK PERNAH REMOVE label yang tidak cocok lagi**
- Jika rekap sebelumnya ada label ["Transfer", "Closing"], rekap baru ["COD", "Closing"]
- Hasil: ["Transfer", "Closing", "COD"] ← "Transfer" lolos!

### ✅ Rekomendasi Fix:

**1. Tambahkan cleanup pada status change** (smart-label.service.ts):
```javascript
// Tambah mapping untuk status lainnya
const LABELS_TO_REMOVE_ON_STATUS_CHANGE = {
    'COD': ['Transfer', 'Cancel'],
    'Transfer': ['COD', 'Cancel'],
    'Closing': ['Cancel'],
    'Cancel': ['Closing', 'Transfer', 'COD'],
};

// Sebelum merge, hapus label yang tidak relevan
if (statusLabel && LABELS_TO_REMOVE_ON_STATUS_CHANGE[statusLabel]) {
    const toRemove = new Set(LABELS_TO_REMOVE_ON_STATUS_CHANGE[statusLabel]);
    existingLabels = existingLabels.filter(lbl => !toRemove.has(lbl));
}
```

**2. Normalize nama label sebelum merge**:
```javascript
const normalizedExisting = existingLabels.map(l => String(l).trim());
const normalizedEffective = effectiveLabelNames.map(l => String(l).trim());

// Case-insensitive dedup
const uniqueLabels = [];
const seen = new Set();
for (const lbl of [...normalizedExisting, ...normalizedEffective]) {
    const lower = lbl.toLowerCase();
    if (!seen.has(lower)) {
        uniqueLabels.push(lbl);
        seen.add(lower);
    }
}
const mergedLabels = uniqueLabels;
```

---

## 🔴 BUG 8 — Error 500 Hapus Label + IDBFactory Error

### Status: ✅ VERIFIKASI BENAR (Dua Masalah Berbeda)

**Error 1 — IDBFactory "The parameter is not a valid key"**:
- ✅ Ini frontend error (browser IndexedDB)
- ✅ Bukan backend bug
- Penyebab: Data cache browser menyimpan object bukan string sebagai key
- Fix: Clear browser cache (Ctrl+Shift+Del → IndexedDB)

**Error 2 — HTTP 500 dari API**:
- Kemungkinan: Route parameter `store_wa_id` atau `contact_id` berisi karakter spesial (`@c.us`, `@lid`)
- WA phone format: `62123456789@c.us` ← karakter `@` bisa break URL parsing

### ✅ Rekomendasi:
**Backend**: URL encode parameter sebelum kirim
```javascript
// Frontend
const response = await api.get(
    `/api/smart-labels/${encodeURIComponent(storeWaId)}/${encodeURIComponent(contactId)}`
);

// Backend: pastikan route decoder bekerja
app.get('/api/smart-labels/:store/:contact', (req, res) => {
    const store = decodeURIComponent(req.params.store);
    const contact = decodeURIComponent(req.params.contact);
    // ... process
});
```

---

## 🟡 BUG 9 — Bot Balas Chat Closing / Konteks Ngawur

### Status: ✅ VERIFIKASI BENAR (Tidak Ada Filter Closing Status)

**Kode Aktual** (`message_handler.js` L298-344):
```javascript
async function handleMessage(message, storeWaId, shouldAIReply = true) {
    // FIREWALL 0: Duplicate check ✅
    // FIREWALL 0b: Old message check ✅
    
    // ⚠️ TAPI: Tidak ada check untuk "adalah chat Closing?"
    // Bot akan balas jika shouldAIReply = true, meskipun chat sudah Closing
}
```

**Analisis Anda**: BENAR
- Tidak ada filter untuk cek apakah chat sudah `Closing`
- Bot hanya cek:
  1. ✅ Apakah pesan duplikat?
  2. ✅ Apakah pesan lama (before server restart)?
  3. ❌ **Apakah percakapan sudah `Closing`?** ← TIDAK ADA!

### ✅ Rekomendasi Fix (Sangat Tepat):

Tambahkan sebelum AI process:
```javascript
// Di message_handler.js handleMessage function
if (shouldAIReply) {
    try {
        const { ChatSummary } = require("../models/index");
        const summary = await ChatSummary.findOne({
            where: { store_wa_id: storeWaId, contact_id: contactId }
        });
        
        if (summary) {
            const labels = JSON.parse(summary.wa_labels || '[]');
            const isClosing = labels.some(l => 
                String(l).toLowerCase() === 'closing'
            );
            const messageAge = Date.now() - (message.timestamp * 1000);
            const MAX_AGE_AFTER_CLOSING = 24 * 60 * 60 * 1000; // 24 jam
            
            if (isClosing && messageAge > MAX_AGE_AFTER_CLOSING) {
                logger.info(
                    `[${storeWaId}] Skip reply — chat sudah Closing ` +
                    `dan pesan ${Math.round(messageAge / 60000)} menit yang lalu`
                );
                shouldAIReply = false;
            }
        }
    } catch (e) {
        // Fall-through: jika error, tetap balas
    }
}
```

---

## 🔴 BUG 10 — Percakapan Terpotong / Tidak Sinkron Setelah Bot Restart

### Status: ✅ VERIFIKASI BENAR (Ini Keterbatasan Arsitektur WA-JS)

**Analisis Anda**: BENAR 100%

Penyebab:
- WA-JS adalah library yang mengemulasi browser, bukan WhatsApp Web API official
- Saat server restart → koneksi WA terputus
- Pesan yang datang saat downtime → tidak ter-sync karena WA-JS tidak ada persistent queue
- Berbeda dengan WhatsApp Official Cloud API yang menyimpan di server Meta

**Verifikasi di Codebase**:
- Di `message_handler.js` L164-165, ada grace period 5 menit untuk old messages:
```javascript
const _OLD_MESSAGE_GRACE_MS = 5 * 60 * 1000; // 5 menit toleransi
```
- Tapi ini hanya **menolak reply** ke pesan lama, **bukan recovery mechanism**

### ✅ Rekomendasi (Sesuai Analisis Anda):

**Opsi A: Short-term** — Tampilkan warning di UI
```javascript
// Frontend: Tambahkan banner jika baru reconnect
<div className="bg-yellow-100 p-3 rounded">
    ⚠️ Bot baru reconnect — riwayat chat mungkin belum lengkap. 
    Scroll ke atas atau refresh untuk sync.
</div>
```

**Opsi B: Long-term** — Migrasi ke WhatsApp Cloud API (Meta)
- Official API memiliki webhook untuk incoming messages
- Pesan tidak pernah hilang (tersimpan di server Meta)
- Lebih reliable untuk production

---

## 📊 Ringkasan Validasi Temuan Anda

| # | Masalah | Analisis Anda | Verifikasi | Status | Priority |
|---|---------|--------------|-----------|--------|----------|
| 1 | Inspector JSON | BENAR | Code masih langsung parse, belum ada lastIndexOf trick | ⚠️ Incomplete | HIGH |
| 2 | Learning fallback | BENAR | Fallback ada tapi no sanitasi, perlu tambah | ⚠️ Incomplete | HIGH |
| 3 | DSML bocor | BENAR | Regex lazy match bisa fail nested tags | ⚠️ Perlu fix | MEDIUM |
| 4 | Evolusi kosong | BENAR | Bukan code bug, data problem. Catch kosong | ⚠️ Minor | LOW |
| 5 | Resi/Toko | BENAR | Mapping ada, display belum nama toko | ❌ Belum ada | MEDIUM |
| 6 | Detail resi | BENAR | Data terbatas dari API Mengantar | ❌ Tidak bisa fix | LOW |
| 7 | Label duplikat | BENAR | 3 akar masalah terverifikasi semua | ❌ Belum ada cleanup | HIGH |
| 8 | Error 500 label | BENAR | IDBFactory (frontend), 500 (backend encoding) | ⚠️ Partial | MEDIUM |
| 9 | Balas Closing | BENAR | Tidak ada filter Closing status di handler | ❌ Belum ada | HIGH |
| 10 | Terpotong restart | BENAR | Keterbatasan WA-JS, perlu warning UI | ⚠️ Design issue | LOW |

---

## 🎯 Prioritas Fix Sekarang (Dari Tertinggi ke Terendah)

### 🔴 CRITICAL (Lakukan segera)
1. **BUG 7** — Label duplikat dengan cleanup strategy
2. **BUG 9** — Tambahkan filter Closing status di message handler
3. **BUG 1** — Tambahkan lastIndexOf trick di Inspector

### 🟡 HIGH (Sebelum production)
4. **BUG 2** — Sanitasi JSON di Learning fallback
5. **BUG 5** — Tambahkan display nama toko di Orders frontend
6. **BUG 3** — Improve regex untuk DSML nested tags

### 🟢 MEDIUM (Bisa di sprint berikutnya)
7. **BUG 8** — URL encode di frontend smart-labels
8. **BUG 4** — Tambahkan error feedback saat fetch agents

### ℹ️ INFO (Design/Limitation)
9. **BUG 10** — Dokumentasikan limitation WA-JS, pertimbangkan migration Cloud API
10. **BUG 6** — Limited by Mengantar API, bukan codebase issue

---

## ✅ Kesimpulan

**Analisis Anda sangat akurat dan detail.** Temuan Anda mencakup:
- ✅ Root cause analysis yang tepat
- ✅ Rekomendasi fix yang praktis dan implementable
- ✅ Understanding baik tentang arsitektur (3-lapis parser, fallback strategies, dll)

**Yang belum ada atau incomplete di codebase:**
- Sanitasi JSON robust di Inspector dan Learning
- Cleanup label status change (hanya ada on Closing/Cancel)
- Filter "jangan balas Closing chat" di message handler
- Display nama toko (bukan nomor mentah)
- DSML regex yang lebih ketat untuk nested tags

Semua ini harus diprioritaskan sesuai daftar di atas.

