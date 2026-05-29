# 03 — Software Design Document (SDD)

> **Versi:** 1.0 | **Tanggal:** 2026-05-29

---

## Ringkasan Eksekutif

Dokumen ini mendeskripsikan arsitektur teknis target untuk CRM-AI v2.0. Desain mengikuti prinsip **Domain-Driven Design (DDD)** dengan pemisahan yang jelas antara Channel Adapter, Conversation Service, AI Orchestrator, CRM Core, Notification Queue, Policy Guard, dan Dashboard.

---

## 1. Arsitektur Overview

### 1.1 Layer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      PRESENTATION LAYER                         │
│  ┌──────────────────┐  ┌──────────────────┐                     │
│  │   React/Next.js  │  │   Socket.IO      │                     │
│  │   Dashboard SPA  │  │   Real-time      │                     │
│  └────────┬─────────┘  └────────┬─────────┘                     │
├───────────┼──────────────────────┼──────────────────────────────┤
│           │    APPLICATION LAYER │                               │
│  ┌────────▼─────────────────────▼────────────────────┐          │
│  │              Express.js API Gateway                │          │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────────────┐ │          │
│  │  │ Auth MW  │ │ Rate     │ │ Policy Guard MW    │ │          │
│  │  │ (JWT)    │ │ Limiter  │ │ (24h, consent)     │ │          │
│  │  └──────────┘ └──────────┘ └────────────────────┘ │          │
│  └──────────────────┬────────────────────────────────┘          │
├─────────────────────┼───────────────────────────────────────────┤
│                     │    DOMAIN LAYER                            │
│  ┌──────────────────▼────────────────────────────────────────┐  │
│  │                                                            │  │
│  │  ┌─────────────┐  ┌────────────┐  ┌──────────────────┐    │  │
│  │  │ Channel     │  │Conversation│  │ AI Orchestrator   │    │  │
│  │  │ Adapter     │  │ Service    │  │                    │    │  │
│  │  │             │  │            │  │ ┌──────────────┐   │    │  │
│  │  │ ┌─────────┐ │  │ ┌────────┐ │  │ │ Prompt       │   │    │  │
│  │  │ │ WA Cloud│ │  │ │Message │ │  │ │ Engine       │   │    │  │
│  │  │ │ API     │ │→ │ │Pipeline│ │→ │ │              │   │    │  │
│  │  │ └─────────┘ │  │ └────────┘ │  │ └──────────────┘   │    │  │
│  │  │ ┌─────────┐ │  │ ┌────────┐ │  │ ┌──────────────┐   │    │  │
│  │  │ │ WWebJS  │ │  │ │Summary │ │  │ │ Tool         │   │    │  │
│  │  │ │ Legacy  │ │  │ │Engine  │ │  │ │ Executor     │   │    │  │
│  │  │ └─────────┘ │  │ └────────┘ │  │ └──────────────┘   │    │  │
│  │  └─────────────┘  └────────────┘  └──────────────────┘    │  │
│  │                                                            │  │
│  │  ┌─────────────┐  ┌────────────┐  ┌──────────────────┐    │  │
│  │  │ CRM Core    │  │Notification│  │ Policy Guard      │    │  │
│  │  │             │  │ Queue      │  │                    │    │  │
│  │  │ ┌─────────┐ │  │ ┌────────┐ │  │ ┌──────────────┐   │    │  │
│  │  │ │Customer │ │  │ │FollowUp│ │  │ │ Consent      │   │    │  │
│  │  │ │ Profile │ │  │ │Scheduler│ │  │ │ Registry     │   │    │  │
│  │  │ └─────────┘ │  │ └────────┘ │  │ └──────────────┘   │    │  │
│  │  │ ┌─────────┐ │  │ ┌────────┐ │  │ ┌──────────────┐   │    │  │
│  │  │ │ Label   │ │  │ │Template│ │  │ │ Audit Log    │   │    │  │
│  │  │ │ Manager │ │  │ │Manager │ │  │ │              │   │    │  │
│  │  │ └─────────┘ │  │ └────────┘ │  │ └──────────────┘   │    │  │
│  │  └─────────────┘  └────────────┘  └──────────────────┘    │  │
│  └────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                    INFRASTRUCTURE LAYER                          │
│  ┌──────────┐  ┌──────────┐  ┌────────┐  ┌───────────────────┐ │
│  │PostgreSQL│  │ Redis    │  │ S3/    │  │ Groq/OpenAI API  │ │
│  │          │  │ (Cache + │  │ MinIO  │  │ (LLM Provider)   │ │
│  │          │  │  Queue)  │  │ (Media)│  │                   │ │
│  └──────────┘  └──────────┘  └────────┘  └───────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Directory Structure (Target)

```
wa-ai-cs/
├── src/
│   ├── adapters/               # Channel Adapters
│   │   ├── wa-cloud-api/       # WhatsApp Cloud API adapter
│   │   │   ├── webhook.js      # Webhook receiver
│   │   │   ├── sender.js       # Message sender
│   │   │   └── types.js        # WA Cloud API types
│   │   ├── wwebjs/             # Legacy WWebJS adapter
│   │   │   ├── client.js       # WWebJS client wrapper
│   │   │   └── bridge.js       # WA-JS bridge (legacy)
│   │   └── interface.js        # Channel adapter interface (contract)
│   │
│   ├── domain/                 # Domain Layer (business logic)
│   │   ├── conversation/       # Conversation bounded context
│   │   │   ├── message-pipeline.js
│   │   │   ├── debouncer.js
│   │   │   └── summary-engine.js
│   │   ├── crm/                # CRM bounded context
│   │   │   ├── customer-service.js
│   │   │   ├── label-service.js
│   │   │   └── media-service.js
│   │   ├── ai/                 # AI bounded context
│   │   │   ├── orchestrator.js
│   │   │   ├── prompt-builder.js
│   │   │   ├── tool-executor.js
│   │   │   └── model-router.js
│   │   ├── notification/       # Notification bounded context
│   │   │   ├── followup-scheduler.js
│   │   │   ├── template-manager.js
│   │   │   └── rate-limiter.js
│   │   └── policy/             # Policy bounded context
│   │       ├── consent-registry.js
│   │       ├── twenty-four-hour-window.js
│   │       └── audit-logger.js
│   │
│   ├── infrastructure/         # Infrastructure Layer
│   │   ├── database/
│   │   │   ├── models/         # Sequelize models
│   │   │   ├── migrations/     # Versioned migrations
│   │   │   └── index.js        # DB connection
│   │   ├── cache/              # Redis cache layer
│   │   ├── storage/            # Media file storage
│   │   └── external/           # External API clients
│   │       ├── groq-client.js
│   │       ├── openai-client.js
│   │       └── shipping-client.js
│   │
│   ├── api/                    # API Layer (Express routes)
│   │   ├── middleware/         # Auth, CSRF, rate limit
│   │   ├── routes/             # Route handlers
│   │   └── socket/             # Socket.IO handlers
│   │
│   └── config/                 # Configuration
│       ├── index.js
│       ├── database.js
│       └── constants.js
│
├── frontend/                   # React/Next.js Frontend
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── stores/             # State management
│   │   └── api/                # API client
│   └── package.json
│
├── tests/                      # Test suite
│   ├── unit/
│   ├── integration/
│   └── fixtures/
│
├── docs/                       # Documentation
├── scripts/                    # Utility scripts
├── migrations/                 # Database migrations
└── docker-compose.yml
```

---

## 2. Component Design

### 2.1 Channel Adapter Interface

```javascript
// src/adapters/interface.js
/**
 * @interface IChannelAdapter
 * Kontrak yang harus dipenuhi oleh setiap channel adapter.
 */
class IChannelAdapter {
  /** Kirim pesan teks ke customer */
  async sendTextMessage(to, body, options) {}
  
  /** Kirim media (image/video/document) ke customer */
  async sendMediaMessage(to, mediaUrl, caption, type) {}
  
  /** Kirim message template (untuk outbound di luar 24h window) */
  async sendTemplate(to, templateName, parameters) {}
  
  /** Mark chat as read */
  async markAsRead(chatId) {}
  
  /** Get connection status */
  async getStatus() {}
  
  /** Setup incoming message handler */
  onMessage(callback) {}
  
  /** Setup status update handler */
  onStatusUpdate(callback) {}
}
```

### 2.2 WhatsApp Cloud API Adapter

```javascript
// src/adapters/wa-cloud-api/sender.js
class WACloudAPISender {
  constructor(phoneNumberId, accessToken) {
    this.baseUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
    this.accessToken = accessToken;
  }

  async sendTextMessage(to, body) {
    return axios.post(this.baseUrl, {
      messaging_product: 'whatsapp',
      to: to,
      type: 'text',
      text: { body }
    }, {
      headers: { Authorization: `Bearer ${this.accessToken}` }
    });
  }

  async sendTemplate(to, templateName, languageCode, components) {
    return axios.post(this.baseUrl, {
      messaging_product: 'whatsapp',
      to: to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components: components
      }
    }, {
      headers: { Authorization: `Bearer ${this.accessToken}` }
    });
  }
}
```

### 2.3 Message Pipeline

```
Incoming Message Flow:
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ Webhook  │→ │ Validate │→ │ Enrich   │→ │ Policy   │→ │ Debounce │
│ Receive  │  │ & Dedup  │  │ Contact  │  │ Check    │  │ Buffer   │
└──────────┘  └──────────┘  └──────────┘  └──────────┘  └────┬─────┘
                                                              │
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────▼─────┐
│ Update   │← │ Log      │← │ Send     │← │ AI       │← │ Process  │
│ Summary  │  │ to DB    │  │ Response │  │ Generate │  │ Batch    │
└──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘
```

### 2.4 Policy Guard (24-Hour Window)

```javascript
// src/domain/policy/twenty-four-hour-window.js
class TwentyFourHourWindow {
  /**
   * Cek apakah boleh kirim free-form message ke customer.
   * @param {string} customerId
   * @returns {{ allowed: boolean, reason: string, expiresAt: Date }}
   */
  async canSendFreeFormMessage(customerId) {
    const lastIncomingMessage = await this.getLastCustomerMessage(customerId);
    
    if (!lastIncomingMessage) {
      return { allowed: false, reason: 'No prior customer message', expiresAt: null };
    }
    
    const windowEnd = new Date(lastIncomingMessage.timestamp.getTime() + 24 * 60 * 60 * 1000);
    const now = new Date();
    
    if (now > windowEnd) {
      return { 
        allowed: false, 
        reason: '24-hour window expired. Use approved template.',
        expiresAt: windowEnd 
      };
    }
    
    return { allowed: true, reason: 'Within 24-hour window', expiresAt: windowEnd };
  }
}
```

---

## 3. Database Design

### 3.1 Entity Relationship Diagram

```
┌────────────────┐     ┌────────────────┐     ┌────────────────┐
│   BotAgent     │     │     Store      │     │   Customer     │
├────────────────┤     ├────────────────┤     ├────────────────┤
│ id (PK)        │←──→ │ id (PK)        │     │ id (PK)        │
│ name           │  1:N│ wa_id          │  N:1│ phone          │
│ bot_name       │     │ name           │←────│ wa_id          │
│ system_prompt  │     │ agent_id (FK)  │     │ display_name   │
│ product_knowl. │     │ is_bot_active  │     │ consent_status │
│ auto_labels    │     │ phone_number_id│     │ opt_in_at      │
│ created_at     │     │ wa_access_token│     │ opt_out_at     │
│ updated_at     │     │ adapter_type   │     │ created_at     │
└────────────────┘     │ created_at     │     └────────────────┘
                       └────────────────┘              │
                              │                        │
                              │ 1:N                    │ 1:N
                              ▼                        ▼
                       ┌────────────────┐     ┌────────────────┐
                       │  ChatMessage   │     │  ChatSummary   │
                       ├────────────────┤     ├────────────────┤
                       │ id (PK)        │     │ store_wa_id    │
                       │ store_wa_id    │     │ customer_id    │
                       │ customer_id    │     │ summary        │
                       │ wa_message_id  │     │ wa_labels      │
                       │ body           │     │ last_updated   │
                       │ type           │     └────────────────┘
                       │ is_from_me     │
                       │ sender_type    │  ← 'ai' | 'cs_manual' | 'cs_dashboard' | 'customer'
                       │ timestamp      │
                       └────────────────┘

┌────────────────┐     ┌────────────────┐     ┌────────────────┐
│  MediaAsset    │     │   FollowUp     │     │   AuditLog     │
├────────────────┤     ├────────────────┤     ├────────────────┤
│ id (PK)        │     │ id (PK)        │     │ id (PK)        │
│ agent_id (FK)  │     │ store_wa_id    │     │ actor          │
│ filename       │     │ customer_id    │     │ action         │
│ type           │     │ stage          │     │ target         │
│ label          │     │ scheduled_at   │     │ metadata (JSON)│
│ description    │     │ status         │     │ ip_address     │
│ ai_analysis    │     │ template_id    │     │ timestamp      │
│ trigger_words  │     │ sent_at        │     └────────────────┘
│ purpose        │     └────────────────┘
└────────────────┘
                       ┌────────────────┐
                       │ConsentRegistry │
                       ├────────────────┤
                       │ customer_id    │
                       │ channel        │
                       │ opted_in       │
                       │ opt_in_at      │
                       │ opt_out_at     │
                       │ opt_out_reason │
                       └────────────────┘
```

### 3.2 Index Strategy

```sql
-- High-frequency queries
CREATE INDEX idx_messages_contact_store ON ChatMessages(contact_id, store_wa_id, timestamp DESC);
CREATE INDEX idx_messages_wa_id ON ChatMessages(wa_message_id);
CREATE INDEX idx_messages_timestamp ON ChatMessages(timestamp DESC);
CREATE INDEX idx_summaries_store_contact ON ChatSummaries(store_wa_id, contact_id);
CREATE INDEX idx_followups_status_scheduled ON FollowUps(status, scheduled_at);
CREATE INDEX idx_audit_actor_timestamp ON AuditLogs(actor, timestamp DESC);
CREATE INDEX idx_consent_customer ON ConsentRegistry(customer_id, channel);
```

---

## 4. API Design

### 4.1 REST API Endpoints

```
Authentication:
  POST   /api/auth/login          # Login with credentials
  POST   /api/auth/logout         # Logout
  GET    /api/auth/session         # Current session info

Webhook (WhatsApp Cloud API):
  GET    /api/webhook              # Webhook verification challenge
  POST   /api/webhook              # Incoming messages/status updates

Stores:
  GET    /api/stores               # List all stores
  POST   /api/stores               # Create store
  PUT    /api/stores/:id           # Update store
  DELETE /api/stores/:id           # Delete store
  GET    /api/stores/:id/status    # Store connection status

Agents:
  GET    /api/agents               # List all agents
  POST   /api/agents               # Create agent
  PUT    /api/agents/:id           # Update agent
  DELETE /api/agents/:id           # Delete agent (cascade)

Conversations:
  GET    /api/conversations        # List active conversations
  GET    /api/conversations/:id    # Chat history for a customer
  POST   /api/conversations/:id/messages  # Send manual message
  PUT    /api/conversations/:id/pause     # Pause AI for contact
  PUT    /api/conversations/:id/resume    # Resume AI for contact

Media:
  GET    /api/media                # List media assets
  POST   /api/media/upload         # Upload media
  PUT    /api/media/:id            # Update media metadata
  DELETE /api/media/:id            # Delete media

Follow-ups:
  GET    /api/followups            # List follow-ups
  DELETE /api/followups/:id        # Cancel follow-up

Analytics:
  GET    /api/analytics/overview   # Dashboard overview
  GET    /api/analytics/leads      # Lead drill-down
  GET    /api/analytics/followups  # Follow-up stats

Health:
  GET    /api/health               # System health check
```

### 4.2 WebSocket Events

```
Server → Client:
  'newMessage'          # New message received/sent
  'typingStatus'        # Typing indicator update
  'storeStatusChanged'  # WA connection status change
  'summaryUpdated'      # Chat summary updated
  'followUpUpdated'     # Follow-up status change
  'systemStats'         # RAM/CPU metrics
  'systemLog'           # Real-time log messages
  'qrCode'              # QR code for WWebJS auth (legacy)
  'messageRevoked'      # Message deleted by customer

Client → Server:
  'joinStore'           # Subscribe to store events
  'leaveStore'          # Unsubscribe from store events
```

---

## 5. Security Design

### 5.1 Authentication Flow

```
Login:
  Client → POST /api/auth/login { username, password }
  Server → bcrypt.compare(password, storedHash)
  Server → Set session cookie (HttpOnly, Secure, SameSite)
  Server → 200 { user, role }

API Request:
  Client → GET /api/conversations (with session cookie)
  Server → Session middleware validates cookie
  Server → Role middleware checks permissions
  Server → 200 { data }

Socket.IO:
  Client → io.connect() with session cookie
  Server → Socket middleware extracts session
  Server → Validates session.authenticated
  Server → Allow/deny connection
```

### 5.2 Webhook Security

```
Meta → POST /api/webhook
  Headers: X-Hub-Signature-256
  
Server verification:
  1. Extract signature from header
  2. Compute HMAC-SHA256 of body with app_secret
  3. Compare signatures (timing-safe)
  4. Reject if mismatch → 403
  5. Process if match → 200
```

---

## 6. Deployment Architecture

### 6.1 Production Setup

```
┌─────────────────────────────────────────────┐
│              Cloudflare / Nginx              │
│            (Reverse Proxy + SSL)             │
└─────────────┬───────────────────────────────┘
              │
┌─────────────▼───────────────────────────────┐
│          Docker Compose                      │
│  ┌───────────┐  ┌──────────┐  ┌──────────┐ │
│  │   App     │  │PostgreSQL│  │  Redis   │ │
│  │ (Node.js) │  │          │  │          │ │
│  │ Port 3001 │  │ Port 5432│  │ Port 6379│ │
│  └───────────┘  └──────────┘  └──────────┘ │
│                                              │
│  ┌───────────┐                               │
│  │  MinIO    │ (optional, or use cloud S3)   │
│  │ (Media)   │                               │
│  └───────────┘                               │
└─────────────────────────────────────────────┘
```

---

## 7. Migration Strategy (Current → Target)

### Phase 1: Adapter Pattern (Non-Breaking)
1. Buat `IChannelAdapter` interface
2. Wrap existing WWebJS code di `WWebJSAdapter` 
3. Semua services berkomunikasi via adapter, bukan langsung ke WWebJS
4. **Zero downtime** — behavior identik

### Phase 2: Cloud API Adapter
1. Implementasi `WACloudAPIAdapter`
2. Setup webhook endpoint
3. Test dengan 1 nomor baru
4. **Parallel run** — WWebJS dan Cloud API berdampingan

### Phase 3: Gradual Migration
1. Migrasi store satu per satu
2. Monitor stability per store
3. Matikan WWebJS adapter setelah semua store migrasi
4. **Rollback ready** — bisa kembali ke WWebJS per-store

---

## Acceptance Criteria Dokumen SDD

- [x] Arsitektur overview dengan layer separation
- [x] Component design dengan interface contract
- [x] Database schema dengan indexing strategy
- [x] API design (REST + WebSocket)
- [x] Security design (auth, webhook verification)
- [x] Deployment architecture
- [x] Migration strategy dengan rollback plan
