# 09 — Prompt Architecture Document

> **Versi:** 1.0 | **Tanggal:** 2026-05-29

---

## Ringkasan Eksekutif

Dokumen ini menjelaskan arsitektur prompt AI untuk CRM-AI, termasuk analisis prompt saat ini, rekomendasi perbaikan, dan desain target yang modular, testable, dan configurable per-tenant.

---

## 1. Analisis Prompt Saat Ini

### 1.1 Struktur Prompt Existing

```
┌─────────────────────────────────────────┐
│          System Message #1               │
│  fullSystemInstruction (~2000+ token)    │
│  ┌───────────────────────────────────┐   │
│  │ Base Personality                   │   │
│  │ + Business Rules (hardcoded)       │   │
│  │ + Product Knowledge (from DB)      │   │
│  │ + Tool Descriptions                │   │
│  │ + Context: Customer Name/Summary   │   │
│  │ + Output Format Rules              │   │
│  │ + Anti-Fraud Rules                 │   │
│  │ + Follow-Up Awareness              │   │
│  └───────────────────────────────────┘   │
├─────────────────────────────────────────┤
│          System Message #2               │
│  draconianRules (~500 token)             │
│  ┌───────────────────────────────────┐   │
│  │ "ATURAN MUTLAK TIDAK BOLEH        │   │
│  │  DILANGGAR..."                     │   │
│  │ - No markdown                      │   │
│  │ - No long responses                │   │
│  │ - "PENALTI" language               │   │
│  └───────────────────────────────────┘   │
├─────────────────────────────────────────┤
│          Conversation History            │
│  (last 20-50 messages)                   │
├─────────────────────────────────────────┤
│          User Message                    │
│  (customer's actual message)             │
└─────────────────────────────────────────┘
```

### 1.2 Masalah Prompt Saat Ini

| # | Masalah | Impact | Severity |
|---|---------|--------|----------|
| 1 | **System prompt terlalu panjang** (~2500+ token) — mahal, memperlambat inference | Token waste, latency | P1 |
| 2 | **Dual system messages** — `fullSystemInstruction` + `draconianRules` bisa bertentangan | AI confusion, inconsistency | P1 |
| 3 | **Bahasa ancaman** ("PENALTI", "MUTLAK") — tidak efektif untuk LLM modern | Inconsistent behavior | P2 |
| 4 | **Business logic hardcoded** — harga (37rb/59rb), bank (Mandiri), sapaan (bunda/bun) | Tidak scalable multi-tenant | P1 |
| 5 | **Tool descriptions inline** — mixed dengan personality dan rules | Hard to maintain | P2 |
| 6 | **Tidak ada prompt versioning** — tidak bisa A/B test atau rollback | No quality control | P2 |
| 7 | **Context window bloat** — seluruh prompt dikirim setiap request | Cost inefficiency | P1 |
| 8 | **Model-agnostic prompt** — Llama dan GPT punya behavior berbeda tapi dapat prompt identik | Sub-optimal performance | P2 |
| 9 | **Summary prompt terpisah** — menggunakan model berbeda tanpa alignment | Inconsistent summarization | P2 |

### 1.3 Token Usage Analysis (per AI Request)

| Component | Est. Tokens | % of Total |
|-----------|:-----------:|:----------:|
| System prompt (personality + rules) | ~800 | 22% |
| Product knowledge | ~400 | 11% |
| Business rules + anti-fraud | ~300 | 8% |
| Tool descriptions | ~400 | 11% |
| Context (customer summary) | ~200 | 6% |
| Draconian rules | ~300 | 8% |
| Chat history (20 messages) | ~1000 | 28% |
| User message | ~200 | 6% |
| **Total per request** | **~3600** | **100%** |

**Cost implication:** Dengan GPT-4o-mini ($0.15/1M input tokens):
- Per request: ~$0.00054
- 1000 chats/day: ~$0.54/day = ~$16/month
- Dengan optimasi: bisa turun 30-40%

---

## 2. Arsitektur Prompt Target

### 2.1 Modular Prompt Builder

```
┌─────────────────────────────────────────────────────────────────┐
│                    PROMPT BUILDER                                │
│                                                                  │
│  ┌──────────────┐  ┌─────────────────┐  ┌──────────────────┐   │
│  │ Base         │  │ Agent Config     │  │ Runtime Context  │   │
│  │ Personality  │  │ (from Database)  │  │ (per-request)    │   │
│  │ (Static)     │  │                  │  │                  │   │
│  │              │  │ • system_prompt  │  │ • customer_name  │   │
│  │ • Tone       │  │ • product_knowl  │  │ • chat_summary   │   │
│  │ • Style      │  │ • auto_labels    │  │ • current_time   │   │
│  │ • Constraints│  │ • bot_name       │  │ • pending_data   │   │
│  │ • Format     │  │                  │  │ • followup_status│   │
│  └──────┬───────┘  └────────┬────────┘  └────────┬─────────┘   │
│         │                   │                     │              │
│         └───────────┬───────┘                     │              │
│                     │                             │              │
│              ┌──────▼──────┐              ┌───────▼────────┐    │
│              │  Assembly   │              │  Tool Defs     │    │
│              │  Engine     │◄────────────►│  (Dynamic)     │    │
│              └──────┬──────┘              └────────────────┘    │
│                     │                                           │
│              ┌──────▼──────┐                                    │
│              │  FINAL      │                                    │
│              │  PROMPT     │                                    │
│              └─────────────┘                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Prompt Layers

```javascript
// src/domain/ai/prompt-builder.js

class PromptBuilder {
  constructor(agent, context) {
    this.agent = agent;         // BotAgent from DB
    this.context = context;     // Runtime context
  }

  /**
   * Build final system prompt dari komponen modular.
   */
  build() {
    return [
      this._buildPersonality(),
      this._buildProductKnowledge(),
      this._buildBusinessRules(),
      this._buildContextBlock(),
      this._buildOutputRules(),
    ]
    .filter(Boolean)
    .join('\n\n---\n\n');
  }

  /** Layer 1: Base Personality (static per agent) */
  _buildPersonality() {
    return `# IDENTITAS
Kamu adalah ${this.agent.bot_name}, customer service yang ramah dan profesional.

## Gaya Komunikasi
- Bahasa santai tapi sopan, seperti chat teman
- 1 bubble = 1-2 kalimat pendek
- Gunakan emoji secukupnya 😊
- Variasikan kata, hindari pengulangan
- Setiap respons diakhiri pertanyaan yang mendorong ke closing

## Batasan
- Sapaan pembuka hanya 1x di awal
- Jangan ulangi pertanyaan yang sudah dijawab
- Jangan tanya hal yang sudah ada di konteks
- Fokus pada closing (ambil data order)`;
  }

  /** Layer 2: Product Knowledge (from database, per agent) */
  _buildProductKnowledge() {
    if (!this.agent.product_knowledge) return null;
    return `# PRODUCT KNOWLEDGE\n${this.agent.product_knowledge}`;
  }

  /** Layer 3: Business Rules (from agent config) */
  _buildBusinessRules() {
    // Extracted from agent's system_prompt or separate field
    const rules = this.agent.system_prompt || '';
    if (!rules) return null;
    return `# ATURAN BISNIS\n${rules}`;
  }

  /** Layer 4: Runtime Context (dynamic per request) */
  _buildContextBlock() {
    const parts = ['# KONTEKS PERCAKAPAN'];
    
    if (this.context.customerName) {
      parts.push(`Nama Customer: ${this.context.customerName}`);
    }
    if (this.context.chatSummary) {
      parts.push(`Rekap Sebelumnya: ${this.context.chatSummary}`);
    }
    if (this.context.currentTime) {
      parts.push(`Waktu Sekarang: ${this.context.currentTime}`);
    }
    if (this.context.pendingFollowUp) {
      parts.push(`Follow-Up Pending: ${this.context.pendingFollowUp}`);
    }
    
    return parts.join('\n');
  }

  /** Layer 5: Output Rules (static, optimized per model) */
  _buildOutputRules() {
    return `# FORMAT OUTPUT
- Gunakan teks biasa, TANPA markdown
- Jangan gunakan **, __, \`\`, ###, atau format apapun
- Jangan sertakan link URL, email, atau ID internal
- Jika respons panjang, pisahkan dengan baris kosong sebagai pemisah bubble
- Maksimal 3 bubble per respons`;
  }
}
```

### 2.3 Tool Definition (Separated)

```javascript
// src/domain/ai/tool-definitions.js

const TOOL_DEFINITIONS = {
  cek_ongkir: {
    type: 'function',
    function: {
      name: 'cek_ongkir',
      description: 'Cek ongkos kirim ke kota/kabupaten tertentu',
      parameters: {
        type: 'object',
        properties: {
          destination_city: {
            type: 'string',
            description: 'Nama kota/kabupaten tujuan pengiriman'
          }
        },
        required: ['destination_city']
      }
    }
  },
  
  kirim_media_katalog: {
    type: 'function',
    function: {
      name: 'kirim_media_katalog',
      description: 'Kirim foto/video produk dari katalog',
      parameters: {
        type: 'object',
        properties: {
          search_keyword: {
            type: 'string',
            description: 'Kata kunci untuk mencari media produk yang relevan'
          }
        },
        required: ['search_keyword']
      }
    }
  }
};

/**
 * Get tools available for a specific agent.
 * @param {object} agent - BotAgent
 * @param {object} options - { hasMediaAssets, hasShippingAPI }
 */
function getToolsForAgent(agent, options = {}) {
  const tools = [];
  
  if (options.hasShippingAPI) {
    tools.push(TOOL_DEFINITIONS.cek_ongkir);
  }
  
  if (options.hasMediaAssets) {
    tools.push(TOOL_DEFINITIONS.kirim_media_katalog);
  }
  
  return tools;
}
```

---

## 3. Model-Specific Optimizations

### 3.1 Llama 3.3 (Groq) — Primary

| Characteristic | Optimization |
|---------------|-------------|
| Instruction following | Lebih rigid — gunakan markdown headers (#) untuk section |
| Tool calling | Perlu format tool descriptions lebih eksplisit |
| Token efficiency | Lebih hemat — bisa include lebih banyak context |
| Bahasa Indonesia | Cukup baik, tapi kadang mix English — tambahkan "Selalu jawab dalam Bahasa Indonesia" |

### 3.2 GPT-4o-mini (OpenAI) — Fallback

| Characteristic | Optimization |
|---------------|-------------|
| Instruction following | Sangat baik — bisa lebih compact |
| Tool calling | Native support, format standar |
| Token efficiency | Lebih mahal — prioritaskan compression |
| Bahasa Indonesia | Sangat baik, natural |

### 3.3 Model Router Logic

```javascript
// src/domain/ai/model-router.js

class ModelRouter {
  /**
   * Pilih model dan optimasi prompt berdasarkan konteks.
   */
  selectModel(messageType, retryCount = 0) {
    // Voice note transcription → selalu Whisper
    if (messageType === 'audio') return { provider: 'openai', model: 'whisper-1' };
    
    // Image analysis → selalu GPT Vision
    if (messageType === 'image') return { provider: 'openai', model: 'gpt-4o-mini' };
    
    // Chat summary → Llama 8B (cukup untuk summarization)
    if (messageType === 'summary') return { provider: 'groq', model: 'llama-3.1-8b-instant' };
    
    // Main chat → Groq primary, OpenAI fallback
    if (retryCount === 0) return { provider: 'groq', model: 'llama-3.3-70b-versatile' };
    
    // Fallback
    return { provider: 'openai', model: 'gpt-4o-mini' };
  }
}
```

---

## 4. Context Window Management

### 4.1 Token Budget Allocation

```
Total Budget: 4000 tokens (untuk menjaga response quality + cost)

┌──────────────────────────────────┐
│  System Prompt: 800 tokens max   │ (20%)
│  Product Knowledge: 400 tokens   │ (10%)
│  Business Rules: 200 tokens      │ (5%)
│  Tools: 300 tokens               │ (7.5%)
│  Runtime Context: 200 tokens     │ (5%)
│  Output Rules: 100 tokens        │ (2.5%)
│  ──────────────────────────────  │
│  Chat History: 1800 tokens max   │ (45%) ← Sliding window
│  User Message: 200 tokens        │ (5%)
│  ──────────────────────────────  │
│  Total: ~4000 tokens             │
└──────────────────────────────────┘
```

### 4.2 Chat History Windowing

```javascript
/**
 * Smart chat history windowing.
 * Prioritas: pesan terbaru > summary lama > truncation.
 */
function buildChatHistory(messages, maxTokens = 1800) {
  const recentMessages = messages.slice(-20); // Last 20 messages
  
  let tokenCount = 0;
  const result = [];
  
  // Include dari terbaru ke terlama
  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const msg = recentMessages[i];
    const msgTokens = estimateTokens(msg.body);
    
    if (tokenCount + msgTokens > maxTokens) break;
    
    result.unshift({
      role: msg.is_from_me ? 'assistant' : 'user',
      content: msg.body
    });
    tokenCount += msgTokens;
  }
  
  return result;
}
```

---

## 5. Summary Prompt Architecture

### 5.1 Current Issues
- Summary prompt hardcoded di `ai_service.js`
- Menggunakan model berbeda (8B) tanpa alignment
- Output format tidak consistent
- Tidak ada schema validation

### 5.2 Target Summary Prompt

```javascript
const SUMMARY_PROMPT = `Buat ringkasan percakapan customer service berikut.

FORMAT OUTPUT (WAJIB diikuti persis):
NAMA: [nama customer jika diketahui, atau "Belum diketahui"]
PRODUK: [produk yang dibahas]
JUMLAH: [jumlah pesanan jika ada]
ALAMAT: [alamat lengkap jika ada]
STATUS: [satu dari: Opening | Gali Kebutuhan | Negosiasi | Menunggu Alamat | Menunggu Rekap | Menunggu Transfer | Closing | Selesai]
CATATAN: [informasi penting lainnya, maks 2 kalimat]
WA_LABELS: [label WA yang sesuai, contoh: Hot Lead, Closing]

RULES:
- Hanya gunakan informasi dari chat, jangan mengarang
- STATUS harus persis salah satu opsi di atas
- Jika data belum lengkap, tulis "Belum diketahui"
- Ringkas dan factual, tanpa opini`;
```

### 5.3 Summary Validation

```javascript
function validateSummary(summaryText) {
  const requiredFields = ['NAMA:', 'PRODUK:', 'STATUS:'];
  const validStatuses = [
    'Opening', 'Gali Kebutuhan', 'Negosiasi',
    'Menunggu Alamat', 'Menunggu Rekap', 'Menunggu Transfer',
    'Closing', 'Selesai'
  ];
  
  // Check required fields exist
  for (const field of requiredFields) {
    if (!summaryText.includes(field)) {
      return { valid: false, reason: `Missing field: ${field}` };
    }
  }
  
  // Check status is valid
  const statusMatch = summaryText.match(/STATUS:\s*(.+)/i);
  if (statusMatch) {
    const status = statusMatch[1].trim();
    if (!validStatuses.includes(status)) {
      return { valid: false, reason: `Invalid status: ${status}` };
    }
  }
  
  return { valid: true };
}
```

---

## 6. Prompt Versioning Strategy

### 6.1 Version Control

```javascript
// Setiap versi prompt disimpan dengan ID
const PROMPT_VERSIONS = {
  'v1.0.0': {
    personality: '...',
    outputRules: '...',
    summaryPrompt: '...',
    createdAt: '2026-05-29',
    notes: 'Initial structured prompt'
  },
  'v1.1.0': {
    personality: '...',
    outputRules: '...',
    summaryPrompt: '...',
    createdAt: '2026-06-15',
    notes: 'Improved closing rate with more direct CTAs'
  }
};
```

### 6.2 A/B Testing Framework

```javascript
class PromptExperiment {
  constructor(experimentId, variants, trafficSplit) {
    this.experimentId = experimentId;
    this.variants = variants;   // { 'control': promptV1, 'treatment': promptV2 }
    this.trafficSplit = trafficSplit; // { 'control': 50, 'treatment': 50 }
  }
  
  getVariant(contactId) {
    // Deterministic assignment based on contact ID hash
    const hash = hashCode(contactId);
    const bucket = hash % 100;
    
    let cumulative = 0;
    for (const [variant, pct] of Object.entries(this.trafficSplit)) {
      cumulative += pct;
      if (bucket < cumulative) return variant;
    }
    return 'control';
  }
}
```

---

## 7. Quality Guardrails

### 7.1 Output Sanitization Pipeline

```
AI Output → Strip Markdown → Strip URLs → Strip IDs →
  Validate Length → Split Bubbles → Send
```

### 7.2 Content Safety

```javascript
const BLOCKED_PATTERNS = [
  /\b(password|secret|token|api.?key)\b/i,  // Prevent leaking system info
  /\b(kompetitor|pesaing)\b/i,               // No competitor mentions
  /\b(rasis|sara|porno)\b/i,                 // No offensive content
];

function sanitizeAIOutput(text) {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(text)) {
      logger.warn(`[AI-Safety] Blocked pattern detected in output`);
      return 'Mohon maaf kak, bisa diulangi pertanyaannya? 😊';
    }
  }
  return text;
}
```

### 7.3 Hallucination Prevention

- Product knowledge disediakan secara eksplisit — AI TIDAK boleh mengarang fitur/harga
- Jika informasi tidak ada di knowledge base, AI harus menjawab "Saya konfirmasi dulu ya kak"
- Validasi harga yang disebut AI vs product knowledge

---

## 8. Metrics & Observability

### 8.1 Prompt Performance Metrics

| Metric | Cara Ukur | Target |
|--------|-----------|--------|
| Token per request (input) | Count dari API response | < 4000 |
| Token per request (output) | Count dari API response | < 500 |
| Response latency (p95) | Timestamp diff | < 5s |
| Fallback rate | Groq fail → OpenAI | < 10% |
| Tool call accuracy | Manual review | > 90% |
| Summary quality | Schema validation pass rate | > 95% |
| Closing rate per prompt version | A/B test results | Tracked |

### 8.2 Cost Tracking

```javascript
function logAIUsage(provider, model, inputTokens, outputTokens, latencyMs) {
  const costs = {
    'groq/llama-3.3-70b': { input: 0, output: 0 },        // Free
    'groq/llama-3.1-8b': { input: 0, output: 0 },          // Free
    'openai/gpt-4o-mini': { input: 0.15, output: 0.60 },   // per 1M tokens
  };
  
  const key = `${provider}/${model}`;
  const rate = costs[key] || { input: 0, output: 0 };
  const cost = (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
  
  // Log ke database untuk tracking
  AIUsageLog.create({
    provider, model, inputTokens, outputTokens, latencyMs, cost,
    timestamp: new Date()
  });
}
```

---

## Acceptance Criteria Dokumen Prompt Architecture

- [x] Analisis prompt saat ini dengan masalah teridentifikasi
- [x] Arsitektur prompt target yang modular
- [x] Prompt builder implementation guide
- [x] Model-specific optimizations
- [x] Context window management strategy
- [x] Summary prompt architecture
- [x] Prompt versioning dan A/B testing
- [x] Quality guardrails (sanitization, safety, hallucination)
- [x] Metrics dan cost tracking
