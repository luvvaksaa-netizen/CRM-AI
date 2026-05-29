# 07 — Migration Plan: WWebJS → WhatsApp Cloud API

> **Versi:** 1.0 | **Tanggal:** 2026-05-29

---

## Ringkasan Eksekutif

Dokumen ini menjelaskan strategi migrasi bertahap dari whatsapp-web.js (WWebJS) + WPPConnect WA-JS ke WhatsApp Business Platform (Cloud API). Migrasi dirancang sebagai **incremental, non-breaking change** dengan rollback capability di setiap fase.

**Prinsip Utama:**
1. **Zero downtime** — Tidak ada gangguan layanan selama migrasi
2. **Rollback ready** — Setiap store bisa dikembalikan ke WWebJS kapan saja
3. **Parallel run** — WWebJS dan Cloud API berjalan berdampingan
4. **Per-store migration** — Migrasi satu nomor WA pada satu waktu

---

## 1. Prerequisites (Sebelum Migrasi)

### 1.1 Meta Business Verification

| Step | Deskripsi | Est. Waktu |
|------|-----------|-----------|
| 1 | Buat Meta Business Account | 1 hari |
| 2 | Verifikasi bisnis (upload dokumen) | 1-4 minggu |
| 3 | Buat WhatsApp Business App di developers.facebook.com | 1 hari |
| 4 | Setup Test Number (gratis dari Meta) | 1 hari |
| 5 | Daftarkan nomor production (memerlukan verifikasi) | 1-2 minggu |

### 1.2 Kebutuhan Teknis

- [ ] Adapter Pattern sudah diimplementasi (Sprint 2)
- [ ] Security hardening selesai (Sprint 1)
- [ ] Webhook endpoint accessible dari internet (HTTPS)
- [ ] Message templates disubmit dan disetujui
- [ ] Environment variables disiapkan:
  ```env
  WHATSAPP_PHONE_NUMBER_ID=123456789
  WHATSAPP_ACCESS_TOKEN=EAABx...
  WHATSAPP_VERIFY_TOKEN=my-random-verify-token
  WHATSAPP_APP_SECRET=abc123...
  WHATSAPP_BUSINESS_ACCOUNT_ID=987654321
  ```

### 1.3 Cost Estimation

| Tier | Volume | Cost/bulan |
|------|--------|-----------|
| Free | 1.000 conversations | $0 |
| Low | 5.000 conversations | ~$200 |
| Medium | 10.000 conversations | ~$500 |
| High | 50.000 conversations | ~$2.500 |

> **Note:** 1 "conversation" = 24 jam dialog dengan 1 customer. Business-initiated conversations lebih mahal dari user-initiated.

---

## 2. Fase Migrasi

### Fase 0: Adapter Pattern Foundation (Sprint 2)

```
BEFORE:
  message_handler.js → whatsapp_service.js → WWebJS client

AFTER:
  message_handler.js → IChannelAdapter → WWebJSAdapter → WWebJS client
                                       → WACloudAdapter → Cloud API (new)
```

**Deliverables:**
- `IChannelAdapter` interface terdefinisi
- `WWebJSAdapter` membungkus semua logic WWebJS yang ada
- Semua service berkomunikasi via adapter, bukan langsung ke WWebJS
- **ZERO behavior change** — hanya refactor internal

**Verification:**
- Semua fitur tetap berfungsi identik
- Tidak ada perubahan yang terlihat oleh user/customer

---

### Fase 1: Cloud API Adapter (Sprint 3, Minggu 5)

**Implementasi webhook receiver:**

```javascript
// src/adapters/wa-cloud-api/webhook.js

const crypto = require('crypto');

// GET /api/webhook — Verification challenge dari Meta
router.get('/api/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// POST /api/webhook — Incoming messages
router.post('/api/webhook', (req, res) => {
  // 1. Verify signature
  const signature = req.headers['x-hub-signature-256'];
  const expectedSig = crypto
    .createHmac('sha256', process.env.WHATSAPP_APP_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');
  
  if (signature !== `sha256=${expectedSig}`) {
    return res.sendStatus(403);
  }
  
  // 2. Acknowledge immediately (Meta expects <15s response)
  res.sendStatus(200);
  
  // 3. Process asynchronously
  processWebhookPayload(req.body).catch(console.error);
});
```

**Implementasi message sender:**

```javascript
// src/adapters/wa-cloud-api/sender.js

async sendTextMessage(to, body) {
  const response = await axios.post(
    `https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to, // format: 628123456789
      type: 'text',
      text: { body: body }
    },
    { headers: { Authorization: `Bearer ${this.accessToken}` } }
  );
  return response.data;
}

async sendTemplate(to, templateName, languageCode = 'id', components = []) {
  const response = await axios.post(
    `https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to: to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components: components
      }
    },
    { headers: { Authorization: `Bearer ${this.accessToken}` } }
  );
  return response.data;
}
```

**Verification:**
- Webhook menerima test message dari Meta Console
- Send text message ke test number berhasil
- Send media message berhasil
- Template message terkirim dan terdisplay

---

### Fase 2: Parallel Run — Test Number (Sprint 3, Minggu 6)

```
Store A (Toko 1) → WWebJSAdapter  → WWebJS client ← Existing production
Store B (Toko 2) → WWebJSAdapter  → WWebJS client ← Existing production
Store T (Test)   → WACloudAdapter → Cloud API     ← NEW test number
```

**Setup:**
1. Buat store baru di database dengan `adapter_type: 'cloud_api'`
2. Konfigurasi `phone_number_id` dan `wa_access_token` untuk store test
3. Assign agent AI ke store test
4. Test semua flow:
   - Customer → AI response
   - CS manual reply dari dashboard
   - Media sending
   - Follow-up (dengan template)
   - Summary generation
   - Label assignment (via DB, bukan WA-JS)

**Duration:** 1-2 minggu parallel run

**Success Criteria:**
- [ ] AI response time < 5 detik (p95)
- [ ] 0 message loss
- [ ] Media delivery success rate > 95%
- [ ] Template delivery success rate > 99%
- [ ] Dashboard real-time update berfungsi

---

### Fase 3: Production Migration — Store by Store (Sprint 4+)

**Urutan migrasi:**
1. **Store dengan traffic paling rendah** → migrasi pertama
2. Monitor 48-72 jam
3. Jika stabil → migrasi store berikutnya
4. Repeat sampai semua store selesai

**Per-store migration steps:**

```
1. ✅ Daftarkan nomor WA existing ke Cloud API
   (Catatan: nomor yang sudah di WWebJS perlu disconnect dulu)

2. ✅ Update store di database:
   UPDATE stores SET 
     adapter_type = 'cloud_api',
     phone_number_id = '...',
     wa_access_token = '...'
   WHERE wa_id = 'store-xxx';

3. ✅ Restart app (adapter factory akan pick up new config)

4. ✅ Monitor dashboard — pastikan messages flowing

5. ✅ Jika ada masalah:
   UPDATE stores SET adapter_type = 'wwebjs' WHERE wa_id = 'store-xxx';
   → Rollback instant
```

**⚠️ PENTING: Nomor WA Migration**

Ketika nomor WA didaftarkan ke Cloud API:
- Nomor tersebut **tidak bisa digunakan di WWebJS lagi** secara bersamaan
- Perlu **disconnect WWebJS session** terlebih dahulu
- Histori chat di HP tetap ada
- Kontak dan group tetap ada
- Proses ini **reversible** (bisa kembali ke WA biasa/WWebJS)

---

### Fase 4: Decommission WWebJS (Sprint 6+)

Setelah semua store berhasil migrasi ke Cloud API:

1. **Hapus WWebJS dependencies:**
   ```bash
   npm uninstall whatsapp-web.js puppeteer puppeteer-extra puppeteer-extra-plugin-stealth
   npm uninstall @nicedash/wppconnect-wa-js
   ```

2. **Hapus WWebJS adapter code:**
   - `src/adapters/wwebjs/` → DELETE
   - `src/services/wajs_bridge.js` → DELETE
   - WWebJS health check → DELETE
   - Chromium configuration → DELETE

3. **Simplify Dockerfile:**
   - Hapus Chromium installation
   - Hapus Puppeteer env vars
   - Image size: ~1.5GB → ~200MB

4. **Update documentation:**
   - Remove WWebJS references
   - Update setup guide

**Verification:**
- App starts without Chromium
- All stores functional via Cloud API
- Docker image < 300MB
- No WWebJS code remaining

---

## 3. Feature Parity Matrix

| Feature | WWebJS | Cloud API | Migration Notes |
|---------|:---:|:---:|----------|
| Send text | ✅ | ✅ | Direct port |
| Send image | ✅ | ✅ | Upload to Meta CDN first |
| Send video | ✅ | ✅ | Upload to Meta CDN first |
| Send document | ✅ | ✅ | Upload to Meta CDN first |
| Receive text | ✅ | ✅ | Via webhook |
| Receive image | ✅ | ✅ | Download from Meta CDN |
| Receive voice | ✅ | ✅ | Download from Meta CDN |
| Read receipts | ✅ | ✅ | markAsRead via API |
| Typing indicator | ✅ | ❌ | Not available in Cloud API |
| QR code auth | ✅ | ❌ | Cloud API uses access token |
| Labels (WA native) | ✅ (via WA-JS) | ⚠️ | Business API only for biz verified |
| Message templates | ❌ | ✅ | New feature — enables compliant outbound |
| 24h window tracking | ❌ | ✅ | Built-in by Meta |
| Webhook-based | ❌ | ✅ | No more browser polling |
| Multi-device | ❌ | ✅ | Native support |
| Status updates | ❌ | ✅ | sent/delivered/read/failed |
| Reply to message | ✅ | ✅ | context.message_id |
| Group messages | ✅ | ⚠️ | Limited in Cloud API |
| Broadcast | ✅ (risky) | ✅ | Via approved templates |

**Key Gaps:**
- **Typing indicator:** Tidak ada di Cloud API — hilangkan fitur ini (minimal impact)
- **Native WA labels:** Hanya via Business Management API (perlu tambahan permission)
- **Group messages:** Limited support di Cloud API — fokus pada 1:1 chat

---

## 4. Rollback Strategy

### Per-Store Rollback (< 5 menit)

```javascript
// Rollback store ke WWebJS
async function rollbackStore(storeWaId) {
  // 1. Update adapter type
  await Store.update(
    { adapter_type: 'wwebjs' },
    { where: { wa_id: storeWaId } }
  );
  
  // 2. Re-initialize WWebJS client
  const client = createWhatsAppClient(storeWaId);
  setupEventListeners(client, storeWaId);
  await client.initialize();
  
  // 3. Display QR code for re-scan
  // (Customer harus scan ulang QR)
}
```

### Full Rollback (< 30 menit)

Jika Cloud API bermasalah secara global:
1. Update semua store ke `adapter_type: 'wwebjs'`
2. Restart application
3. Scan QR code untuk setiap nomor
4. Semua traffic kembali via WWebJS

**⚠️ Limitation:** Setelah rollback, nomor WA mungkin perlu verifikasi ulang di WWebJS (QR scan).

---

## 5. Data Migration

### Chat History
- Chat history yang sudah ada di database **tetap utuh** — tidak perlu migrasi
- Chat baru akan masuk via Cloud API webhook

### Customer Contacts
- Contact ID format berbeda: WWebJS (`6281234@c.us`) vs Cloud API (`6281234`)
- Perlu normalization layer di contact identity service
- Existing contacts mapped via phone number

### Media Files
- Media yang sudah di-upload tetap di local storage
- Media baru dari Cloud API perlu download dari Meta CDN

### Session Data
- `.wwebjs_auth/` session files **tidak dibutuhkan** untuk Cloud API
- Cloud API menggunakan access token (stateless)

---

## 6. Monitoring & Success Criteria

### KPIs selama migrasi

| Metric | Target | Alert Threshold |
|--------|--------|----------------|
| Message delivery rate | > 99% | < 95% |
| Webhook response time | < 200ms | > 1s |
| AI response time | < 5s (p95) | > 10s |
| Error rate | < 1% | > 5% |
| Customer complaints | 0 | > 0 |

### Monitoring Tools
- `/api/health` endpoint — uptime monitoring
- Pino structured logs — error tracking
- Meta Business Manager — delivery/read stats
- Database queries — message flow analysis

---

## 7. Timeline

```
Week 0-2:  Sprint 1 — Security hardening (prerequisite)
Week 3-4:  Sprint 2 — Adapter pattern implementation
Week 5:    Sprint 3a — Cloud API adapter + webhook
Week 6:    Sprint 3b — Parallel run with test number
Week 7:    Review parallel run results
Week 8:    Start production migration (store by store)
Week 9-10: Complete migration all stores
Week 11:   Stability monitoring
Week 12:   Decommission WWebJS (if all stable)
```

**Total Timeline: ~12 minggu** (termasuk Meta verification yang bisa paralel)

---

## Acceptance Criteria Dokumen Migration Plan

- [x] Prerequisites lengkap (Meta setup, env vars, cost)
- [x] Fase migrasi bertahap dengan rollback
- [x] Feature parity matrix
- [x] Data migration strategy
- [x] Rollback strategy di setiap level
- [x] Monitoring dan success criteria
- [x] Timeline yang realistis
