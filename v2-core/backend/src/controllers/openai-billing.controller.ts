import { Request, Response, NextFunction } from 'express';
import {
  fetchBillingUsage,
  getLatestBilling,
  getUsageHistory,
  getBillingConfig,
  updateBillingConfig,
  restartScheduler,
  hasApiKey,
  hasOrgApiKey,
} from '../services/openaiBilling.service';
import { sendTestNotification } from '../services/telegramNotifier.service';

// ─── GET /api/openai/billing/latest ───
export const getLatest = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getLatestBilling();
    res.json(data);
  } catch (e) {
    next(e);
  }
};

// ─── GET /api/openai/billing/history?days=30 ───
export const getHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const data = await getUsageHistory(days);
    res.json(data);
  } catch (e) {
    next(e);
  }
};

// ─── POST /api/openai/billing/fetch ───
export const fetchNow = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await fetchBillingUsage();
    if (!result) {
      return res.status(400).json({ success: false, message: 'Gagal fetch billing. Cek OPENAI_API_KEY di .env' });
    }
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
};

// ─── GET /api/openai/billing/config ───
export const getConfig = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await getBillingConfig();
    res.json({ ...config, has_api_key: hasApiKey(), has_org_api_key: hasOrgApiKey() });
  } catch (e) {
    next(e);
  }
};

// ─── PUT /api/openai/billing/config ───
export const updateConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = req.body;
    const config = await updateBillingConfig(data);
    res.json({ success: true, config: { ...config, has_api_key: hasApiKey(), has_org_api_key: hasOrgApiKey() } });
  } catch (e) {
    next(e);
  }
};

// ─── POST /api/openai/billing/test-telegram ───
export const testTelegram = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const ok = await sendTestNotification();
    res.json({ success: ok, message: ok ? 'Notifikasi Telegram berhasil terkirim!' : 'Gagal kirim notifikasi. Cek TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID di .env' });
  } catch (e) {
    next(e);
  }
};

// ─── GET /api/openai/billing/actual-costs?days=30 ───
export const getActualCosts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { getCostSummary } = require('../services/costTracker');
    const { fetchDeepSeekBalance } = require('../services/openaiBilling.service');
    const days = parseInt(req.query.days as string) || 30;
    const summary = await getCostSummary(days);
    
    // Inject real-time deepseek balance
    const dsBalance = await fetchDeepSeekBalance();
    summary.deepseek_balance = dsBalance;
    
    res.json(summary);
  } catch (e) {
    next(e);
  }
};

// ─── GET /api/openai/billing/exchange-rate ───
export const getExchangeRate = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { getRateInfo } = require('../services/exchangeRate.service');
    const info = await getRateInfo();
    res.json(info);
  } catch (e) {
    next(e);
  }
};

// ─── GET /api/openai/billing/usage-logs?days=30&page=1&limit=50&model=deepseek-chat ───
export const getUsageLogsList = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { getUsageLogs } = require('../services/costTracker');
    const days  = Math.min(parseInt(req.query.days  as string) || 30, 365);
    const page  = Math.max(parseInt(req.query.page  as string) || 1,  1);
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const model = (req.query.model as string) || null;

    const result = await getUsageLogs({ days, page, limit, model });
    res.json(result);
  } catch (e) {
    next(e);
  }
};
