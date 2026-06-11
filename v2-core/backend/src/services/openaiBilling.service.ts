import axios from 'axios';
import { OpenAIUsageLog, AppConfig } from '../models';
import { sendDailyBillingReport, sendThresholdAlert } from './telegramNotifier.service';

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
  const apiKey = getApiKey();
  if (!apiKey) {
    console.log('[OpenAI Billing] No API key configured. Set OPENAI_API_KEY in .env');
    return null;
  }

  const today = getUsageDate();
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (getOrgId()) {
    headers['OpenAI-Organization'] = getOrgId();
  }

  try {
    // Fetch daily usage (latest 1 day)
    const usageUrl = `https://api.openai.com/v1/dashboard/billing/usage?start_date=${today}&end_date=${today}`;
    const usageRes = await axios.get<BillingUsageResponse>(usageUrl, { headers });
    const totalUsage = usageRes.data.total_usage ?? 0;

    // Fetch credit grants (balance)
    let totalBalance = 0;
    try {
      const grantsUrl = 'https://api.openai.com/v1/dashboard/billing/credit_grants';
      const grantsRes = await axios.get<CreditGrantsResponse>(grantsUrl, { headers });
      totalBalance = grantsRes.data.total_available ?? 0;
    } catch (e: any) {
      console.warn('[OpenAI Billing] Gagal fetch credit grants:', e.message);
    }

    // Save to DB
    await OpenAIUsageLog.upsert({
      date: today,
      total_usage: totalUsage,
      total_balance: totalBalance,
      n_requests: 0,
      raw_response: JSON.stringify({ usage: usageRes.data }),
      fetched_at: new Date(),
    } as any);

    // Check threshold
    const thresholdStr = await getConfig('openai_billing_daily_threshold', '10');
    const threshold = parseFloat(thresholdStr);
    if (!isNaN(threshold) && totalUsage > threshold) {
      await sendThresholdAlert(totalUsage, threshold);
    }

    console.log(`[OpenAI Billing] Fetched: usage=$${totalUsage.toFixed(4)}, balance=$${totalBalance.toFixed(4)}`);
    return { total_usage: totalUsage, total_balance: totalBalance };
  } catch (err: any) {
    console.error('[OpenAI Billing] Gagal fetch:', err.message);
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
  const enabled = await getConfig('openai_billing_enabled', 'true');
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
  const enabled = await getConfig('openai_billing_enabled', 'true');
  if (enabled !== 'true') {
    console.log('[OpenAI Billing] Scheduler disabled by config.');
    return;
  }

  const intervalMinStr = await getConfig('openai_billing_interval_min', '360');
  const intervalMs = (parseInt(intervalMinStr) || 360) * 60 * 1000;

  // Run immediately on start
  console.log('[OpenAI Billing] Initial fetch on startup...');
  await fetchBillingUsage();

  // Schedule periodic fetch
  if (billingInterval) clearInterval(billingInterval);
  billingInterval = setInterval(async () => {
    console.log('[OpenAI Billing] Scheduled fetch...');
    await fetchBillingUsage();
  }, intervalMs);

  console.log(`[OpenAI Billing] Scheduler started (interval: ${intervalMinStr} menit).`);

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
        await sendDailyBillingReport(
          latest.total_usage,
          latest.total_balance,
          latest.date || getUsageDate()
        );
      }
    } catch (e: any) {
      console.error('[OpenAI Billing] Daily report error:', e.message);
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
  console.log('[OpenAI Billing] Scheduler stopped.');
}

export function restartScheduler() {
  stopScheduler();
  startScheduler();
}

// ─── API key check (for frontend to know if key is set) ───
export function hasApiKey(): boolean {
  // Check if we can do org billing (has org key) or just basic tracking
  return !!(process.env.OPENAI_ORG_API_KEY || process.env.OPENAI_API_KEY);
}

export function hasOrgApiKey(): boolean {
  return !!process.env.OPENAI_ORG_API_KEY;
}
