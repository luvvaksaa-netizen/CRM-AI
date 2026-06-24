/**
 * @file costTracker.js
 * @description Per-request cost tracking for OpenAI API calls.
 * Mencatat token usage setiap request OpenAI dan menghitung estimasi biaya.
 * Biaya ditampilkan dalam USD.
 */

const { OpenAICostLog } = require('../models');
const logger = require('../utils/logger');

// ─── MODEL PRICING (per 1M tokens, USD) ───
// Update sesuai harga terbaru OpenAI & DeepSeek
const MODEL_PRICING = {
  // DeepSeek Models (V3 Pricing - Cache Miss)
  'deepseek-chat':       { input: 0.270,  output: 1.100 },
  'deepseek-coder':      { input: 0.270,  output: 1.100 },
  'deepseek-v4-pro':     { input: 0.270,  output: 1.100 },  // DeepSeek V4 Pro
  
  // OpenAI Models
  'gpt-4o-mini':         { input: 0.150,  output: 0.600 },
  'gpt-4o':              { input: 2.50,   output: 10.00 },
  'gpt-4o-2024-08-06':   { input: 2.50,   output: 10.00 },
  'gpt-4o-2024-05-13':   { input: 5.00,   output: 15.00 },
  'gpt-4-turbo':         { input: 10.00,  output: 30.00 },
  'gpt-4':               { input: 30.00,  output: 60.00 },
  'gpt-3.5-turbo':       { input: 0.50,   output: 1.50 },
  'whisper-1':           { input: 100.0,  output: 0 }, // $0.006 per min = $0.0001 per sec (1M sec = $100)
};

const DEFAULT_PRICING = { input: 2.50, output: 10.00 }; // Default: gpt-4o

/**
 * Hitung biaya berdasarkan model dan jumlah token.
 * @param {string} model - Nama model OpenAI
 * @param {number} promptTokens - Input tokens
 * @param {number} completionTokens - Output tokens
 * @returns {{ input_cost: number, output_cost: number, total_cost: number }}
 */
function calculateCost(model, promptTokens, completionTokens) {
  const pricing = MODEL_PRICING[model] || DEFAULT_PRICING;
  const inputCost = (promptTokens / 1_000_000) * pricing.input;
  const outputCost = (completionTokens / 1_000_000) * pricing.output;

  // Guard: pastikan tidak NaN/Infinity yang bisa sebabkan validasi DECIMAL gagal
  const safeInput = Number.isFinite(inputCost) ? inputCost : 0;
  const safeOutput = Number.isFinite(outputCost) ? outputCost : 0;

  return {
    input_cost: parseFloat(safeInput.toFixed(8)),
    output_cost: parseFloat(safeOutput.toFixed(8)),
    total_cost: parseFloat((safeInput + safeOutput).toFixed(8)),
  };
}

/**
 * Catat satu request AI ke database.
 * @param {object} options
 * @param {string} options.model            - Nama model (contoh: 'gpt-4o-mini', 'deepseek-chat')
 * @param {number} options.promptTokens     - Jumlah prompt tokens
 * @param {number} options.completionTokens - Jumlah completion tokens
 * @param {string} [options.endpoint]       - Tipe endpoint ('chat', 'audio', dll)
 * @param {string} [options.functionName]   - Nama fungsi pemanggil (untuk tracking)
 * @param {string} [options.storeWaId]      - WA ID store yang memicu request (opsional)
 * @param {string} [options.contactId]      - ID kontak WhatsApp (opsional, misal: 6281234@c.us)
 * @param {string} [options.contactPhone]   - Nomor HP bersih (opsional, misal: 6281234)
 */
// ─── Log throttle: max 1 error per 60 detik ───
let lastCostTrackerErrorTime = 0;
const COST_TRACKER_ERROR_COOLDOWN_MS = 60000;

async function logRequest({ model, promptTokens, completionTokens, endpoint, functionName, storeWaId, contactId, contactPhone }) {
  try {
    const prompt = promptTokens || 0;
    const completion = completionTokens || 0;
    const total = prompt + completion;
    const { input_cost, output_cost, total_cost } = calculateCost(model, prompt, completion);

    // Validasi: pastikan nilai dalam range DECIMAL(12,8) — max 9999.99999999
    const maxDecimal = 9999.99999999;
    const safeInputCost = Math.min(Math.max(input_cost || 0, 0), maxDecimal);
    const safeOutputCost = Math.min(Math.max(output_cost || 0, 0), maxDecimal);
    const safeTotalCost = Math.min(Math.max(total_cost || 0, 0), maxDecimal);

    // PENTING: gunakan toFixed(8) string bukan float!
    // Sequelize DECIMAL validator menolak scientific notation (e.g. 1.5e-7).
    // "0.00000015" (string) lolos isDecimal(), tapi 1.5e-7 (float) gagal.
    await OpenAICostLog.create({
      model: model || 'unknown',
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: total,
      input_cost: safeInputCost.toFixed(8),
      output_cost: safeOutputCost.toFixed(8),
      total_cost: safeTotalCost.toFixed(8),
      endpoint: endpoint || 'chat',
      function_name: functionName || null,
      // Context fields — opsional, null jika tidak disediakan
      store_wa_id: storeWaId || null,
      contact_id: contactId || null,
      contact_phone: contactPhone || null,
      created_at: new Date(),
    });

    logger.info(`[CostTracker] ${model}: ${prompt}in + ${completion}out = $${total_cost.toFixed(6)}${storeWaId ? ` [${storeWaId}/${contactPhone || contactId}]` : ''}`);
  } catch (e) {
    // Non-blocking — error logging tidak boleh crash main flow
    const detail = e.errors ? e.errors.map(er => er.message).join(', ') : e.message;
    const now = Date.now();
    if (now - lastCostTrackerErrorTime > COST_TRACKER_ERROR_COOLDOWN_MS) {
      lastCostTrackerErrorTime = now;
      logger.error(`[CostTracker] Gagal log request: ${detail} | values: model=${model} prompt=${promptTokens} comp=${completionTokens} cost=${total_cost?.toFixed?.(8) || 'N/A'}`);
    }
  }
}

/**
 * Ambil ringkasan biaya untuk periode tertentu.
 * @param {number} days - Jumlah hari ke belakang (default 30)
 * @returns {Promise<object>}
 */
async function getCostSummary(days = 30) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { Op } = require('sequelize');

  const rows = await OpenAICostLog.findAll({
    where: {
      created_at: { [Op.gte]: since }, // Sequelize v6: gunakan Op.gte bukan $gte
    },
    order: [['created_at', 'DESC']],
  });


  const summary = {
    total_requests: rows.length,
    total_cost: 0,
    total_cost_openai: 0,
    total_cost_deepseek: 0,
    total_prompt_tokens: 0,
    total_completion_tokens: 0,
    total_tokens: 0,
    by_model: {},
    by_date: {},
    by_function: {},
    daily: [],
    latest: rows.length > 0 ? rows[0].toJSON() : null,
  };

  const dateMap = {};

  for (const row of rows) {
    const r = row.toJSON();
    const dateKey = new Date(r.created_at).toISOString().split('T')[0];
    const model = r.model || 'unknown';
    const func = r.function_name || 'unknown';
    const cost = parseFloat(r.total_cost || 0);

    summary.total_cost += cost;
    if (model.includes('deepseek')) {
      summary.total_cost_deepseek += cost;
    } else {
      summary.total_cost_openai += cost;
    }
    summary.total_prompt_tokens += r.prompt_tokens || 0;
    summary.total_completion_tokens += r.completion_tokens || 0;
    summary.total_tokens += r.total_tokens || 0;

    // Per model
    if (!summary.by_model[model]) summary.by_model[model] = { requests: 0, cost: 0, tokens: 0 };
    summary.by_model[model].requests++;
    summary.by_model[model].cost += parseFloat(r.total_cost || 0);
    summary.by_model[model].tokens += r.total_tokens || 0;

    // Per function
    if (!summary.by_function[func]) summary.by_function[func] = { requests: 0, cost: 0, tokens: 0 };
    summary.by_function[func].requests++;
    summary.by_function[func].cost += parseFloat(r.total_cost || 0);
    summary.by_function[func].tokens += r.total_tokens || 0;

    // Per date
    if (!dateMap[dateKey]) dateMap[dateKey] = { date: dateKey, requests: 0, cost: 0, tokens: 0 };
    dateMap[dateKey].requests++;
    dateMap[dateKey].cost += parseFloat(r.total_cost || 0);
    dateMap[dateKey].tokens += r.total_tokens || 0;
  }

  // Daily breakdown (sorted by date)
  summary.daily = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));

  // Round costs
  summary.total_cost = parseFloat(summary.total_cost.toFixed(6));
  summary.total_cost_openai = parseFloat(summary.total_cost_openai.toFixed(6));
  summary.total_cost_deepseek = parseFloat(summary.total_cost_deepseek.toFixed(6));
  for (const key of Object.keys(summary.by_model)) {
    summary.by_model[key].cost = parseFloat(summary.by_model[key].cost.toFixed(6));
  }
  for (const key of Object.keys(summary.by_function)) {
    summary.by_function[key].cost = parseFloat(summary.by_function[key].cost.toFixed(6));
  }

  // Add IDR conversion (async, non-blocking)
  try {
    const { usdToIdr } = require('./exchangeRate.service');
    summary.total_cost_idr = await usdToIdr(summary.total_cost);
    summary.total_cost_idr = parseFloat(summary.total_cost_idr.toFixed(0));
    // Also convert daily
    for (const day of summary.daily) {
      day.cost_idr = await usdToIdr(day.cost);
      day.cost_idr = parseFloat(day.cost_idr.toFixed(0));
    }
    // Per model
    for (const key of Object.keys(summary.by_model)) {
      summary.by_model[key].cost_idr = await usdToIdr(summary.by_model[key].cost);
      summary.by_model[key].cost_idr = parseFloat(summary.by_model[key].cost_idr.toFixed(0));
    }
    // Per function
    for (const key of Object.keys(summary.by_function)) {
      summary.by_function[key].cost_idr = await usdToIdr(summary.by_function[key].cost);
      summary.by_function[key].cost_idr = parseFloat(summary.by_function[key].cost_idr.toFixed(0));
    }
  } catch (e) {
    // Non-blocking
  }

  return summary;
}

/**
 * Ambil log per-request secara detail (paginated).
 * Dipakai oleh Settings > AI Billing > tab "Riwayat Request".
 *
 * @param {object} opts
 * @param {number} [opts.days=30]   - Filter N hari ke belakang
 * @param {number} [opts.page=1]   - Halaman (1-based)
 * @param {number} [opts.limit=50] - Baris per halaman
 * @param {string} [opts.model]    - Filter model tertentu (opsional)
 * @returns {Promise<{logs: Array, total: number, page: number, totalPages: number}>}
 */
async function getUsageLogs({ days = 30, page = 1, limit = 50, model = null } = {}) {
  const { Op } = require('sequelize');
  const since = new Date();
  since.setDate(since.getDate() - days);

  const where = { created_at: { [Op.gte]: since } };
  if (model) where.model = model;

  const offset = (Math.max(1, page) - 1) * limit;

  const { count, rows } = await OpenAICostLog.findAndCountAll({
    where,
    order: [['created_at', 'DESC']],
    limit: Math.min(limit, 100), // Hard cap 100 baris per request
    offset,
  });

  const { usdToIdr } = require('./exchangeRate.service');
  let usdRate = 16500; // fallback
  try { usdRate = await require('./exchangeRate.service').fetchUsdToIdrRate(); } catch (_) {}

  const logs = rows.map(r => {
    const row = r.toJSON();
    const cost = parseFloat(row.total_cost || 0);
    return {
      id: row.id,
      model: row.model,
      function_name: row.function_name || '-',
      endpoint: row.endpoint || 'chat',
      prompt_tokens: row.prompt_tokens || 0,
      completion_tokens: row.completion_tokens || 0,
      total_tokens: row.total_tokens || 0,
      cost_usd: parseFloat(cost.toFixed(6)),
      cost_idr: Math.round(cost * usdRate),
      // Context — siapa yang memicu
      store_wa_id: row.store_wa_id || null,
      contact_id: row.contact_id || null,
      contact_phone: row.contact_phone || null,
      created_at: row.created_at,
    };
  });

  return {
    logs,
    total: count,
    page: Math.max(1, page),
    totalPages: Math.ceil(count / limit),
    limit,
  };
}

module.exports = {
  logRequest,
  getCostSummary,
  getUsageLogs,
  calculateCost,
};
