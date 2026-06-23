import logger from '../utils/logger';
import axios from 'axios';
import { OpenAIUsageLog, AppConfig } from '../models';
import { sendDailyBillingReport, sendThresholdAlert, sendTelegramMessage } from './telegramNotifier.service';

// ─── Types ───
interface BillingUsageResponse {
  object: string;
  daily_costs: { timestamp: number; line_items: { name: string; cost: number }[] }[];
  total_usage: number | null;
}

interface CreditGrantsResponse {
  object: string;
  total_granted: number;
  total_used: number;
  total_available: number;
  balance: number;
}

let billingInterval: ReturnType<typeof setInterval> | null = null;
let dailyReportInterval: ReturnType<typeof setInterval> | null = null;

// ─── Config helper ───
async function getConfig(key: string, defaultVal: string): Promise<string> {
  const rec = await AppConfig.findOne({ where: { key } });
  return rec?.getDataValue('value') || defaultVal;
}

async function setConfig(key: string, value: string): Promise<void> {
  await AppConfig.upsert({ key, value } as any);
}

// ─── Get OpenAI API Key ───
function getApiKey(): string {
  // Use billing-specific key if available, otherwise fall back to main API key
  return process.env.OPENAI_ORG_API_KEY || process.env.OPENAI_API_KEY || '';
}

function getOrgId(): string {
  return process.env.OPENAI_ORG_ID || '';
}

function getUsageDate(): string {
  // OpenAI billing API uses UTC dates
  const now = new Date();
  return now.toISOString().split('T')[0];
}

// ─── Fetch usage from OpenAI API ───
export async function fetchBillingUsage(): Promise<{ total_usage: number; total_balance: number } | null> {
  // API /dashboard/billing/usage dan /credit_grants sudah DEPRECATED oleh OpenAI (selalu 403).
  // Data biaya kini diambil dari CostTracker internal (logRequest) yang akurat per-request.
  // Fungsi ini dipertahankan untuk backward-compat tapi tidak melakukan external call.
  logger.info('[OpenAI Billing] External API deprecated. Menggunakan CostTracker internal.');
  return null;
}

// ─── Fetch DeepSeek Balance ───
export async function fetchDeepSeekBalance(): Promise<number | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await axios.get('https://api.deepseek.com/user/balance', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      },
      timeout: 10000
    });
    
    // DeepSeek returns: { is_available: true, balance_infos: [{ currency: "CNY", total_balance: "10.00" }] }
    // Asumsikan kita ambil balance USD atau yang pertama jika tidak ada keterangan spesifik
    if (res.data && res.data.is_available) {
      // Karena kita butuh angka saja, coba ambil yang pertama atau total
      const infos = res.data.balance_infos || [];
      if (infos.length > 0) {
        // DeepSeek bisa USD atau CNY. Biasanya USD untuk internasional.
        const balanceInfo = infos.find((i: any) => i.currency === 'USD') || infos[0];
        return parseFloat(balanceInfo.total_balance || '0');
      }
    }
    return null;
  } catch (err: any) {
    logger.warn(`[DeepSeek Billing] Gagal fetch balance: ${err.message}`);
    return null;
  }
}

// ─── Get recent usage history ───
export async function getUsageHistory(days: number = 30) {
  const records = await OpenAIUsageLog.findAll({
    order: [['date', 'DESC']],
    limit: Math.min(days, 365),
  });
  return records.map(r => r.toJSON()).reverse();
}

// ─── Get latest usage + balance ───
export async function getLatestBilling() {
  const latest = await OpenAIUsageLog.findOne({
    order: [['date', 'DESC']],
  });
  if (!latest) {
    return { total_usage: 0, total_balance: 0, date: getUsageDate(), fetched_at: null };
  }
  return latest.toJSON();
}

// ─── Get billing config ───
export async function getBillingConfig() {
  const enabled = await getConfig('openai_billing_enabled', 'false');
  const interval = await getConfig('openai_billing_interval_min', '360');
  const threshold = await getConfig('openai_billing_daily_threshold', '10');
  const telegramToken = await getConfig('openai_billing_telegram_token', '');
  const telegramChatId = await getConfig('openai_billing_telegram_chat_id', '');
  const telegramEnabled = await getConfig('openai_billing_telegram_enabled', 'false');

  return {
    enabled: enabled === 'true',
    interval_min: parseInt(interval) || 360,
    daily_threshold: parseFloat(threshold) || 10,
    telegram_token: telegramToken ? '••••••' + telegramToken.slice(-4) : '',
    telegram_token_raw: telegramToken,
    telegram_chat_id: telegramChatId,
    telegram_enabled: telegramEnabled === 'true',
  };
}

// ─── Update billing config ───
export async function updateBillingConfig(data: Record<string, string>) {
  const validKeys = [
    'openai_billing_enabled',
    'openai_billing_interval_min',
    'openai_billing_daily_threshold',
    'openai_billing_telegram_token',
    'openai_billing_telegram_chat_id',
    'openai_billing_telegram_enabled',
  ];

  for (const [key, value] of Object.entries(data)) {
    if (validKeys.includes(key)) {
      await setConfig(key, String(value));
    }
  }

  // If interval changed, restart scheduler
  if ('openai_billing_interval_min' in data) {
    restartScheduler();
  }

  return getBillingConfig();
}

// ─── Scheduler ───
export async function startScheduler() {
  const enabled = await getConfig('openai_billing_enabled', 'false');
  if (enabled !== 'true') {
    logger.info('[OpenAI Billing] Scheduler disabled by config.');
    return;
  }

  const intervalMinStr = await getConfig('openai_billing_interval_min', '360');
  const intervalMs = (parseInt(intervalMinStr) || 360) * 60 * 1000;

  // Run immediately on start
  logger.info('[OpenAI Billing] Initial fetch on startup...');
  await fetchBillingUsage();

  // Schedule periodic fetch
  if (billingInterval) clearInterval(billingInterval);
  billingInterval = setInterval(async () => {
    logger.info('[OpenAI Billing] Scheduled fetch...');
    await fetchBillingUsage();
  }, intervalMs);

  logger.info(`[OpenAI Billing] Scheduler started (interval: ${intervalMinStr} menit).`);

  // Schedule daily report via Telegram (check every minute, send at 08:00 WIB)
  dailyReportInterval = setInterval(async () => {
    try {
      const cfg = await getBillingConfig();
      if (!cfg.telegram_enabled) return;

      const now = new Date();
      const hour = now.getUTCHours() + 7; // WIB
      const minutes = now.getMinutes();

      // Send daily report at 08:00 WIB ± 5 min tolerance
      if (hour === 8 && minutes >= 0 && minutes <= 5) {
        const latest = await getLatestBilling();
        const dsBalance = await fetchDeepSeekBalance();
        await sendDailyBillingReport(
          latest.total_usage,
          dsBalance !== null ? dsBalance : latest.total_balance,
          latest.date || getUsageDate()
        );
      }

      // Check Low Balance Alert (Setiap jam pada menit 0)
      if (minutes === 0) {
         const dsBalance = await fetchDeepSeekBalance();
         if (dsBalance !== null && dsBalance <= 2.00) {
            await sendTelegramMessage(`⚠️ SALDO DEEPSEEK MENIPIS! Sisa saldo saat ini: $${dsBalance.toFixed(2)}. Segera top-up agar AI tidak mati.`);
         }
      }

    } catch (e: any) {
      logger.error('[OpenAI Billing] Daily report error:', e.message);
    }
  }, 60000); // Check every minute for daily report timing
}

export function stopScheduler() {
  if (billingInterval) {
    clearInterval(billingInterval);
    billingInterval = null;
  }
  if (dailyReportInterval) {
    clearInterval(dailyReportInterval);
    dailyReportInterval = null;
  }
  logger.info('[OpenAI Billing] Scheduler stopped.');
}

export function restartScheduler() {
  stopScheduler();
  startScheduler();
}

// ─── API key check (for frontend to know if key is set) ───
export function hasApiKey(): boolean {
  // Check if we can do billing tracking (has any AI key)
  return !!(process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY);
}

export function hasOrgApiKey(): boolean {
  return !!process.env.OPENAI_ORG_API_KEY;
}
