# 01 — Product Requirements Document (PRD)

> **Versi:** 1.0 | **Tanggal:** 2026-05-29
> **Produk:** CRM-AI WhatsApp Customer Service Platform
> **Product Owner:** [Nama Anda]

---

## Ringkasan Eksekutif

CRM-AI adalah platform yang membantu tim Customer Service (CS) mengelola percakapan WhatsApp secara efisien menggunakan kecerdasan buatan. Platform ini memungkinkan AI membantu CS menjawab pertanyaan customer, mengirim katalog produk, melacak progress closing, dan melakukan follow-up otomatis — semuanya melalui WhatsApp Business Platform resmi yang aman dan compliant.

**Visi:** Menjadi platform CRM-AI WhatsApp yang paling efektif untuk bisnis kecil-menengah di Indonesia, dengan fokus pada closing rate dan customer experience.

**Misi:** Mengurangi beban CS hingga 60% sambil meningkatkan closing rate 20% melalui AI yang cerdas, compliance yang ketat, dan UX yang intuitif.

---

## 1. Problem Statement

### 1.1 Pain Points Saat Ini

| # | Pain Point | Impact |
|---|-----------|--------|
| 1 | CS kewalahan menjawab banyak chat sekaligus | Response time lambat, customer kabur |
| 2 | Informasi produk tidak konsisten antar CS | Customer bingung, trust menurun |
| 3 | Tidak ada tracking progress per customer | Peluang closing terlewat |
| 4 | Follow-up manual sering terlupa | Revenue loss dari lead yang sudah hot |
| 5 | Tidak ada dashboard analitik | Tidak bisa ukur performa CS/AI |
| 6 | WhatsApp nomor sering kena banned | Gangguan operasional, kehilangan riwayat chat |
| 7 | Tidak ada audit trail | Tidak bisa review kualitas layanan |

### 1.2 Target User

| Persona | Deskripsi | Kebutuhan Utama |
|---------|-----------|-----------------|
| **Admin/Owner** | Pemilik bisnis yang mengelola 1-5 nomor WA | Dashboard analytics, manage CS, review AI quality |
| **CS Operator** | Staff yang menjawab chat customer | Chat interface, quick replies, customer context |
| **Customer** | Pembeli yang menghubungi via WhatsApp | Respons cepat, informasi akurat, tidak di-spam |

---

## 2. Product Goals & Success Metrics

### 2.1 Goals

| Goal | Target | Timeline |
|------|--------|----------|
| **Zero ban risk** | Migrasi 100% ke WhatsApp Cloud API | Sprint 3-5 |
| **Faster response** | AI response < 5 detik untuk 80% pesan | Sprint 2 |
| **Higher closing** | Closing rate naik 20% dari baseline | Sprint 6 |
| **CS productivity** | Reduce manual work 60% | Sprint 4 |
| **Compliance** | 100% compliant dengan WhatsApp Business Policy | Sprint 3 |

### 2.2 Key Metrics (North Star)

- **Closing Rate** = (Jumlah order / Jumlah lead baru) × 100%
- **AI Handling Rate** = (Pesan dibalas AI / Total pesan masuk) × 100%
- **Average Response Time** = Rata-rata waktu dari pesan masuk → balasan terkirim
- **Follow-Up Conversion** = (Customer respond follow-up / Total follow-up terkirim) × 100%
- **Customer Satisfaction** = Rating dari customer feedback (jika tersedia)

---

## 3. Features & Prioritas

### 3.1 Feature Map

#### Phase 1: Foundation & Security (Sprint 1-2)

| Feature | Prioritas | Deskripsi |
|---------|-----------|-----------|
| F1.1 Auth Hardening | P0 | Password hashing, session security, CSRF, Socket.IO auth |
| F1.2 Repo Cleanup | P0 | Hapus secrets, binaries, database dari repo |
| F1.3 Channel Adapter Pattern | P0 | Abstract WhatsApp engine di balik interface |
| F1.4 Health Check API | P1 | `/api/health` endpoint untuk monitoring |
| F1.5 Structured Logging | P1 | JSON logging dengan request tracing |

#### Phase 2: WhatsApp Migration (Sprint 3-5)

| Feature | Prioritas | Deskripsi |
|---------|-----------|-----------|
| F2.1 WhatsApp Cloud API Adapter | P0 | Implementasi adapter baru menggunakan Cloud API |
| F2.2 Webhook Receiver | P0 | Endpoint untuk menerima webhook dari Meta |
| F2.3 Message Template System | P0 | Sistem template yang teregistrasi di Meta |
| F2.4 24-Hour Window Enforcer | P0 | Hanya kirim free-form message dalam 24 jam |
| F2.5 Opt-In/Opt-Out Registry | P0 | Database consent management |
| F2.6 Human Takeover Protocol | P1 | Eskalasi otomatis ke CS manusia |

#### Phase 3: CRM Intelligence (Sprint 6-8)

| Feature | Prioritas | Deskripsi |
|---------|-----------|-----------|
| F3.1 Customer Profile | P1 | Unified customer view dengan semua data |
| F3.2 Smart Follow-Up (Compliant) | P1 | Follow-up via approved templates dengan opt-in |
| F3.3 AI Summary Dashboard | P1 | Rekap otomatis per customer yang actionable |
| F3.4 Label Pipeline | P2 | Auto-labeling berdasarkan conversation status |
| F3.5 Analytics v2 | P2 | Cohort analysis, funnel visualization |

#### Phase 4: Scale & Polish (Sprint 9-12)

| Feature | Prioritas | Deskripsi |
|---------|-----------|-----------|
| F4.1 Frontend Rewrite | P1 | React/Next.js SPA dengan proper UX |
| F4.2 Multi-Tenant | P2 | Support multiple business accounts |
| F4.3 PostgreSQL Migration | P1 | Production-grade database |
| F4.4 CI/CD Pipeline | P1 | Automated testing + deployment |
| F4.5 Plugin Architecture | P3 | Extensible shipping/payment integrations |

---

## 4. User Stories

### 4.1 Admin/Owner Stories

```
US-01: Sebagai Admin, saya ingin melihat dashboard realtime
       agar saya bisa monitor performa CS dan AI.
       AC: Dashboard menampilkan: total leads, closing rate, AI handling rate,
           per-store breakdown, trend 30 hari.

US-02: Sebagai Admin, saya ingin mengelola Agent AI (prompt, knowledge)
       agar setiap nomor WA bisa punya personality yang berbeda.
       AC: CRUD agent, assign ke store, preview prompt.

US-03: Sebagai Admin, saya ingin melihat semua chat customer
       agar saya bisa review kualitas layanan AI dan CS.
       AC: Chat list dengan filter (store, status, date), chat detail
           dengan indikator siapa yang membalas (AI/CS).

US-04: Sebagai Admin, saya ingin receive alert jika AI melakukan kesalahan
       agar saya bisa segera intervensi.
       AC: Notification saat AI mem-pause diri, saat customer complaint terdeteksi.
```

### 4.2 CS Operator Stories

```
US-05: Sebagai CS, saya ingin melihat konteks lengkap customer
       agar saya bisa melanjutkan percakapan tanpa bertanya ulang.
       AC: Panel customer menampilkan: nama, nomor, history, rekap AI,
           status order, label.

US-06: Sebagai CS, saya ingin bisa take over chat dari AI
       agar saya bisa handle kasus yang memerlukan sentuhan manusia.
       AC: Toggle "Pause AI" per kontak, AI berhenti membalas,
           CS bisa chat langsung.

US-07: Sebagai CS, saya ingin bisa mengirim katalog produk
       agar customer bisa melihat pilihan produk.
       AC: Media picker dari katalog agent, preview sebelum kirim.

US-08: Sebagai CS, saya ingin melihat rekap order customer
       agar saya bisa memproses pesanan dengan cepat.
       AC: Panel rekap menampilkan: nama, produk, jumlah, alamat, ongkir,
           metode bayar, status — semua dari AI summary.
```

### 4.3 Compliance Stories

```
US-09: Sebagai sistem, saya harus menghormati 24-hour window
       agar tidak melanggar WhatsApp Business Policy.
       AC: Setelah 24 jam tanpa respon customer, hanya approved templates
           yang bisa dikirim.

US-10: Sebagai customer, saya ingin bisa opt-out dari follow-up
       agar saya tidak diganggu jika tidak tertarik.
       AC: Customer kirim "STOP" → semua follow-up dibatalkan,
           ditandai opt-out di registry.

US-11: Sebagai sistem, saya harus menyimpan audit log
       agar setiap aksi bisa dipertanggungjawabkan.
       AC: Log mencakup: who, what, when, outcome untuk setiap message sent,
           toggle change, config update.
```

---

## 5. Non-Functional Requirements

| Requirement | Target | Rationale |
|------------|--------|-----------|
| **Response Time** | AI reply < 5s (p95) | Customer expectation |
| **Availability** | 99.5% uptime | Bisnis jalan 7 hari |
| **Scalability** | 10 nomor WA, 1000 chat/hari | Growth projection 6 bulan |
| **Security** | OWASP Top 10 compliance | Data customer protection |
| **Data Retention** | Chat history 90 hari | Business requirement |
| **Backup** | Daily automated backup | Data protection |
| **Recovery** | RTO < 1 jam, RPO < 1 hari | Business continuity |

---

## 6. Out of Scope (v1.0)

- Multi-language support (selain Bahasa Indonesia)
- Mobile app native (Android/iOS)
- WhatsApp Group management
- E-commerce integration (Shopee/Tokopedia)
- Payment gateway integration
- Voice call support
- Broadcast to large lists (> 256 contacts)

---

## 7. Risiko & Mitigasi

| Risiko | Likelihood | Impact | Mitigasi |
|--------|:---:|:---:|---------|
| Akun WA Cloud API di-suspend karena violation | Medium | Critical | Strict template approval, rate limiting, opt-out |
| AI memberikan informasi salah | High | High | Human review pipeline, knowledge validation |
| Data breach | Low | Critical | Encryption at rest, audit log, access control |
| Customer complaint tentang bot | Medium | Medium | Human takeover protocol, empathy training |
| Meta mengubah Cloud API pricing | Low | Medium | BSP comparison, cost projection |
| Groq/OpenAI downtime | Medium | High | Multi-provider fallback, offline queue |

---

## 8. Acceptance Criteria Dokumen PRD

- [x] Problem statement terdefinisi jelas
- [x] Target user dan persona terdokumentasi
- [x] Feature map dengan prioritas
- [x] User stories dengan acceptance criteria
- [x] Non-functional requirements
- [x] Scope dan out-of-scope
- [x] Risk assessment

---

## Referensi

- WhatsApp Business Platform Documentation: https://developers.facebook.com/docs/whatsapp
- WhatsApp Business Policy: https://www.whatsapp.com/legal/business-policy
- Meta Business Help Center: https://www.facebook.com/business/help
