import { DataTypes, Model } from "sequelize";
import { sequelize } from "../config/database";

export { sequelize };

export class BotAgent extends Model {}
BotAgent.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: true },
    bot_name: { type: DataTypes.STRING, defaultValue: "CS Bot" },
    system_prompt: { type: DataTypes.TEXT, defaultValue: "" },
    product_knowledge: { type: DataTypes.TEXT, defaultValue: "" },
    auto_labels: { type: DataTypes.TEXT, defaultValue: "" },
    // Hasil learning otomatis — dipisah dari system_prompt agar tidak merusak prompt asli
    learned_prompt_addon: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
    },
  },
  { sequelize, modelName: "BotAgent" },
);

export class Store extends Model {}
Store.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    wa_id: { type: DataTypes.STRING, unique: true },
    name: { type: DataTypes.STRING, defaultValue: "Perangkat Baru" },
    agent_id: { type: DataTypes.INTEGER, allowNull: true },
    is_bot_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    last_active: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    bot_phone: { type: DataTypes.STRING, allowNull: true },
    followup_config: { type: DataTypes.TEXT, allowNull: true },
    connection_mode: { type: DataTypes.STRING, defaultValue: "wwebjs" },
    roketchat_token: { type: DataTypes.STRING, allowNull: true },
    roketchat_device_id: { type: DataTypes.STRING, allowNull: true },
    roketchat_phone: { type: DataTypes.STRING, allowNull: true },
    bot_name: { type: DataTypes.STRING },
    system_prompt: { type: DataTypes.TEXT },
    product_knowledge: { type: DataTypes.TEXT },
  },
  { sequelize, modelName: "Store" },
);

BotAgent.hasMany(Store, { foreignKey: "agent_id" });
Store.belongsTo(BotAgent, { foreignKey: "agent_id" });

export class MediaAsset extends Model {}
MediaAsset.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    agent_id: { type: DataTypes.INTEGER, allowNull: true },
    store_wa_id: { type: DataTypes.STRING, allowNull: true },
    filename: { type: DataTypes.STRING, allowNull: true },
    original_name: { type: DataTypes.STRING },
    type: { type: DataTypes.ENUM("image", "video"), allowNull: true },
    label: { type: DataTypes.STRING },
    description: { type: DataTypes.TEXT },
    ai_analysis: { type: DataTypes.TEXT, defaultValue: "" },
    video_transcript: { type: DataTypes.TEXT, defaultValue: "" },
    trigger_words: { type: DataTypes.STRING, defaultValue: "" },
    purpose: {
      type: DataTypes.ENUM("both", "knowledge_only", "send_only"),
      defaultValue: "both",
    },
    analysis_status: {
      type: DataTypes.ENUM("pending", "processing", "done", "failed"),
      defaultValue: "pending",
    },
  },
  { sequelize, modelName: "MediaAsset" },
);

BotAgent.hasMany(MediaAsset, { foreignKey: "agent_id" });
MediaAsset.belongsTo(BotAgent, { foreignKey: "agent_id" });

export class ChatMessage extends Model {}
ChatMessage.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    store_wa_id: { type: DataTypes.STRING, allowNull: false },
    contact_id: { type: DataTypes.STRING, allowNull: false },
    wa_message_id: { type: DataTypes.STRING, allowNull: true },
    sender_name: { type: DataTypes.STRING },
    contact_display_name: { type: DataTypes.STRING, allowNull: true },
    contact_phone: { type: DataTypes.STRING, allowNull: true },
    contact_lid: { type: DataTypes.STRING, allowNull: true },
    contact_type: { type: DataTypes.STRING, allowNull: true },
    contact_source: { type: DataTypes.STRING, allowNull: true },
    quoted_message_id: { type: DataTypes.STRING, allowNull: true },
    quoted_body: { type: DataTypes.TEXT, allowNull: true },
    quoted_from_me: { type: DataTypes.BOOLEAN, allowNull: true },
    quoted_sender_name: { type: DataTypes.STRING, allowNull: true },
    body: { type: DataTypes.TEXT },
    type: { type: DataTypes.STRING, defaultValue: "chat" },
    is_from_me: { type: DataTypes.BOOLEAN, defaultValue: false },
    is_read: { type: DataTypes.BOOLEAN, defaultValue: false },
    timestamp: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { sequelize, modelName: "ChatMessage" },
);

export class ChatSummary extends Model {}
ChatSummary.init(
  {
    store_wa_id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
    contact_id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
    contact_name: { type: DataTypes.STRING, defaultValue: "" },
    contact_phone: {
      type: DataTypes.STRING,
      defaultValue: null,
      allowNull: true,
    },
    contact_lid: {
      type: DataTypes.STRING,
      defaultValue: null,
      allowNull: true,
    },
    summary: { type: DataTypes.TEXT, defaultValue: "Belum ada rekapan." },
    wa_labels: { type: DataTypes.TEXT, defaultValue: "[]" },
    label_timestamps: { type: DataTypes.TEXT, defaultValue: "{}" },
    last_updated: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { sequelize, modelName: "ChatSummary" },
);

Store.hasMany(ChatSummary, { foreignKey: "store_wa_id", sourceKey: "wa_id" });
ChatSummary.belongsTo(Store, { foreignKey: "store_wa_id", targetKey: "wa_id" });

export class PausedContact extends Model {}
PausedContact.init(
  {
    store_wa_id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
    contact_id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
    paused_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    paused_until: { type: DataTypes.DATE, allowNull: true },
    paused_by: { type: DataTypes.STRING, defaultValue: "manual" },
  },
  { sequelize, modelName: "PausedContact" },
);

export class FollowUp extends Model {}
FollowUp.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    store_wa_id: { type: DataTypes.STRING, allowNull: false },
    contact_id: { type: DataTypes.STRING, allowNull: false },
    contact_name: { type: DataTypes.STRING, defaultValue: "" },
    stage: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    scheduled_at: { type: DataTypes.DATE, allowNull: false },
    status: { type: DataTypes.STRING, defaultValue: "pending" },
    last_chat_context: { type: DataTypes.TEXT, defaultValue: "" },
    sent_at: { type: DataTypes.DATE, allowNull: true },
    cancel_reason: { type: DataTypes.STRING, allowNull: true },
  },
  { sequelize, modelName: "FollowUp" },
);

export class ClosingPattern extends Model {}
ClosingPattern.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    agent_id: { type: DataTypes.INTEGER, allowNull: true },
    product_type: { type: DataTypes.STRING, defaultValue: "generic" },
    teknik: { type: DataTypes.STRING, allowNull: false },
    contoh_kalimat: { type: DataTypes.TEXT, allowNull: true },
    konteks: { type: DataTypes.TEXT, allowNull: true },
    dampak: { type: DataTypes.TEXT, allowNull: true },
    frequency: { type: DataTypes.INTEGER, defaultValue: 1 },
    confidence: { type: DataTypes.FLOAT, defaultValue: 0.5 },
    is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    source_type: { type: DataTypes.STRING, defaultValue: "auto" },
    source_file: { type: DataTypes.STRING, allowNull: true },
    last_seen_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { sequelize, modelName: "ClosingPattern" },
);

BotAgent.hasMany(ClosingPattern, { foreignKey: "agent_id" });
ClosingPattern.belongsTo(BotAgent, { foreignKey: "agent_id" });

export class AdminConfig extends Model {}
AdminConfig.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    username: { type: DataTypes.STRING, allowNull: false, unique: true },
    password_hash: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.STRING, defaultValue: "admin" },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { sequelize, modelName: "AdminConfig" },
);

export class ClosingAnalytic extends Model {}
ClosingAnalytic.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    store_wa_id: { type: DataTypes.STRING, allowNull: true },
    contact_id: { type: DataTypes.STRING, allowNull: true },
    agent_id: { type: DataTypes.INTEGER, allowNull: true },
    product_type: { type: DataTypes.STRING, defaultValue: "generic" },
    conversation_score: { type: DataTypes.INTEGER, defaultValue: 0 },
    pesan_sampai_closing: { type: DataTypes.INTEGER, defaultValue: 0 },
    metode_bayar: { type: DataTypes.STRING, allowNull: true },
    alur_lengkap: { type: DataTypes.BOOLEAN, defaultValue: false },
    data_lengkap: { type: DataTypes.BOOLEAN, defaultValue: false },
    ada_komplain: { type: DataTypes.BOOLEAN, defaultValue: false },
    closing_probability: { type: DataTypes.INTEGER, allowNull: true }, // 0-100
    patterns_extracted: { type: DataTypes.INTEGER, defaultValue: 0 },
    analysis_json: { type: DataTypes.TEXT, allowNull: true },
    source_type: { type: DataTypes.STRING, defaultValue: "production" },
    source_file: { type: DataTypes.STRING, allowNull: true },
    analyzed_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { sequelize, modelName: "ClosingAnalytic" },
);

// ─── ClosingAnalytic associations (after init) ───────────────────
ClosingAnalytic.belongsTo(ChatSummary, {
  foreignKey: "store_wa_id",
  targetKey: "store_wa_id",
  constraints: false,
});
ClosingAnalytic.belongsTo(Store, {
  foreignKey: "store_wa_id",
  targetKey: "wa_id",
  constraints: false,
});
BotAgent.hasMany(ClosingAnalytic, { foreignKey: "agent_id" });
ClosingAnalytic.belongsTo(BotAgent, { foreignKey: "agent_id" });
// ─── OpenAI Usage Log ─────────────────────────────────
export class OpenAIUsageLog extends Model {}
OpenAIUsageLog.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    date: { type: DataTypes.STRING, allowNull: false, unique: true },
    total_usage: { type: DataTypes.DECIMAL(10, 4), defaultValue: 0 },
    total_balance: { type: DataTypes.DECIMAL(10, 4), defaultValue: 0 },
    n_requests: { type: DataTypes.INTEGER, defaultValue: 0 },
    raw_response: { type: DataTypes.TEXT, allowNull: true },
    fetched_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { sequelize, modelName: "OpenAIUsageLog" },
);

// ─── AppConfig (key-value config store) ───────────────
export class AppConfig extends Model {}
AppConfig.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    key: { type: DataTypes.STRING, allowNull: false, unique: true },
    value: { type: DataTypes.TEXT, allowNull: true },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { sequelize, modelName: "AppConfig" },
);

// ─── Xendit Transaction ──────────────────────────────
export class XenditTransaction extends Model {}
XenditTransaction.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    // ── Identitas transaksi ──
    external_id: { type: DataTypes.STRING, allowNull: false, unique: true },
    // ── Field khusus QRIS Dinamis (/qr_codes) ──
    /** reference_id = field unik dari Xendit QR API (bisa beda dari external_id) */
    reference_id: { type: DataTypes.STRING, allowNull: true },
    /** ID QR dari Xendit (untuk cek status & expire) */
    qr_id: { type: DataTypes.STRING, allowNull: true },
    /** Raw qr_string QRIS (payload text) — untuk regenerasi gambar jika perlu */
    qr_string: { type: DataTypes.TEXT, allowNull: true },
    /** Path file PNG QRIS yang sudah di-generate (relative dari uploads dir) */
    qris_image_path: { type: DataTypes.STRING, allowNull: true },
    /** Kapan QRIS ini expired (untuk countdown & auto-expire) */
    qris_expired_at: { type: DataTypes.DATE, allowNull: true },
    // ── Field umum ──
    invoice_url: { type: DataTypes.STRING, allowNull: true },
    amount: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    /** 'PENDING' | 'SUCCEEDED' | 'PAID' | 'EXPIRED' | 'FAILED' */
    status: { type: DataTypes.STRING, defaultValue: "PENDING" },
    /** 'QRIS' | 'BANK_TRANSFER' | dll */
    payment_method: { type: DataTypes.STRING, allowNull: true },
    bank: { type: DataTypes.STRING, allowNull: true },
    payer_email: { type: DataTypes.STRING, allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    /** 'DP' | 'LUNAS' */
    tipe_bayar: { type: DataTypes.STRING, defaultValue: "LUNAS" },
    contact_id: { type: DataTypes.STRING, allowNull: true },
    /** Nomor HP customer (untuk kirim notif WA) */
    contact_phone: { type: DataTypes.STRING, allowNull: true },
    store_wa_id: { type: DataTypes.STRING, allowNull: true },
    paid_at: { type: DataTypes.DATE, allowNull: true },
    expiry_date: { type: DataTypes.DATE, allowNull: true },
    /** Sudah kirim notif WA ke customer setelah PAID? */
    notif_sent: { type: DataTypes.BOOLEAN, defaultValue: false },
    /** 'qris' | 'invoice' — untuk membedakan sumber transaksi */
    source_type: { type: DataTypes.STRING, defaultValue: "invoice" },
    raw_response: { type: DataTypes.TEXT, allowNull: true },
    metadata: { type: DataTypes.TEXT, allowNull: true },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { sequelize, modelName: "XenditTransaction" },
);

// ─── OpenAI Cost Log (per-request cost tracking) ──────
export class OpenAICostLog extends Model {}
OpenAICostLog.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    model: { type: DataTypes.STRING, allowNull: false },
    prompt_tokens: { type: DataTypes.INTEGER, defaultValue: 0 },
    completion_tokens: { type: DataTypes.INTEGER, defaultValue: 0 },
    total_tokens: { type: DataTypes.INTEGER, defaultValue: 0 },
    input_cost: { type: DataTypes.DECIMAL(12, 8), defaultValue: 0 },
    output_cost: { type: DataTypes.DECIMAL(12, 8), defaultValue: 0 },
    total_cost: { type: DataTypes.DECIMAL(12, 8), defaultValue: 0 },
    endpoint: { type: DataTypes.STRING, allowNull: true },
    function_name: { type: DataTypes.STRING, allowNull: true },
    // ─── Context fields: siapa yang memicu request AI ini ───
    store_wa_id: { type: DataTypes.STRING, allowNull: true }, // WA ID store yang aktif
    contact_id: { type: DataTypes.STRING, allowNull: true }, // ID kontak (misal: 6281234@c.us)
    contact_phone: { type: DataTypes.STRING, allowNull: true }, // Nomor HP bersih (misal: 6281234)
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    // ─── Backward-compat: kolom lama dari era timestamps:true (NOT NULL di DB lama) ───
    // Tanpa ini, setiap INSERT gagal silent: "NOT NULL constraint failed: OpenAICostLogs.createdAt"
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    modelName: "OpenAICostLog",
    tableName: "OpenAICostLogs",
    timestamps: false, // Kita manage sendiri — createdAt/updatedAt di-set via defaultValue di atas
  },
);

// ─── Prompt Evolution Log (riwayat evolusi prompt per agent) ──
export class PromptEvolutionLog extends Model {}
PromptEvolutionLog.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    agent_id: { type: DataTypes.INTEGER, allowNull: true },
    // Snapshot prompt sebelum & sesudah revisi (untuk diff UI)
    prompt_before: { type: DataTypes.TEXT, allowNull: true },
    prompt_after: { type: DataTypes.TEXT, allowNull: true },
    // Summary perubahan yang dilakukan AI
    summary_changes: { type: DataTypes.TEXT, allowNull: true },
    // Berapa pattern yang berkontribusi ke revisi ini
    patterns_used: { type: DataTypes.INTEGER, defaultValue: 0 },
    // Score rata-rata percakapan yang memicu revisi
    avg_conversation_score: { type: DataTypes.FLOAT, defaultValue: 0 },
    // Token cost untuk revisi ini
    tokens_used: { type: DataTypes.INTEGER, defaultValue: 0 },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    modelName: "PromptEvolutionLog",
    tableName: "PromptEvolutionLogs",
    timestamps: false,
  },
);

BotAgent.hasMany(PromptEvolutionLog, { foreignKey: "agent_id" });
PromptEvolutionLog.belongsTo(BotAgent, { foreignKey: "agent_id" });
