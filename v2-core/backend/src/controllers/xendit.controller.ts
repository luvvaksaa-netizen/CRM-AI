import { Request, Response, NextFunction } from 'express';
import {
  listTransactions,
  createQrisPayment,
  getQrStatus,
  getInvoice,
  expireInvoice,
  processWebhook,
  getTransactionStats,
  fetchBalance,
  syncTransactions,
  getXenditConfig,
  updateXenditConfig,
  startScheduler,
  hasApiKey,
} from '../services/xendit.service';

// ─── GET /api/xendit/transactions?limit=50&offset=0&status=ALL ───
export const getTransactions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const status = (req.query.status as string) || 'ALL';
    const result = await listTransactions(limit, offset, status);
    res.json(result);
  } catch (e) {
    next(e);
  }
};

// ─── GET /api/xendit/transactions/stats?days=30 ───
export const getStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const stats = await getTransactionStats(days);
    res.json(stats);
  } catch (e) {
    next(e);
  }
};

// ─── POST /api/xendit/qris ───
// Membuat QRIS dinamis via endpoint Xendit /qr_codes.
// Untuk NON-COD / Transfer saja. TIDAK untuk COD.
export const createNewInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { amount, description, contact_id, contact_phone, store_wa_id, tipe_bayar } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Amount wajib diisi dan harus > 0' });
    }

    if (!hasApiKey()) {
      return res.status(400).json({ error: 'XENDIT_API_KEY belum dikonfigurasi. Set di .env' });
    }

    const referenceId = `QRIS-${tipe_bayar || 'PAY'}-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const result = await createQrisPayment({
      reference_id: referenceId,
      amount: Math.round(Number(amount)),
      description: description || `Pembayaran QRIS Rp ${Number(amount).toLocaleString('id-ID')}`,
      contact_id,
      contact_phone: contact_phone || contact_id,
      store_wa_id,
      tipe_bayar: tipe_bayar || 'LUNAS',
    });

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Gagal membuat QRIS di Xendit' });
    }

    // Return base64 PNG jika buffer tersedia
    const qrisImageBase64 = result.qrisImageBuffer
      ? `data:image/png;base64,${result.qrisImageBuffer.toString('base64')}`
      : null;

    res.json({
      success: true,
      data: {
        reference_id: result.reference_id,
        qr_id: result.qr_id,
        amount: result.amount,
        tipe_bayar: tipe_bayar || 'LUNAS',
        status: 'PENDING',
        expires_at: result.expires_at,
        payment_method: 'QRIS',
        qris_image_base64: qrisImageBase64,
        qr_string: result.qr_string,
      },
    });
  } catch (e) {
    next(e);
  }
};

// ─── GET /api/xendit/qr-status/:referenceId ───
export const getQrStatusHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const referenceId = req.params.referenceId as string;
    const qr = await getQrStatus(referenceId);
    if (!qr) {
      return res.status(404).json({ error: 'QR tidak ditemukan di Xendit' });
    }
    res.json(qr);
  } catch (e) {
    next(e);
  }
};

// ─── GET /api/xendit/invoice/:externalId ───
export const getInvoiceStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const externalId = req.params.externalId as string;
    const invoice = await getInvoice(externalId);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice tidak ditemukan' });
    }
    res.json(invoice);
  } catch (e) {
    next(e);
  }
};

// ─── POST /api/xendit/invoice/:externalId/expire ───
export const expireInvoiceHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const externalId = req.params.externalId as string;
    const ok = await expireInvoice(externalId);
    if (ok) {
      res.json({ success: true, message: 'Invoice berhasil di-expire' });
    } else {
      res.status(400).json({ error: 'Gagal expire invoice' });
    }
  } catch (e) {
    next(e);
  }
};

// ─── POST /api/xendit/webhook (PUBLIC endpoint — dipanggil oleh Xendit) ───
// QRIS Webhook: { reference_id, status: 'SUCCEEDED', amount, ... }
// Invoice Webhook: { external_id, status: 'PAID', amount, ... }
export const handleWebhook = async (req: Request, res: Response) => {
  try {
    console.log('[Xendit] Webhook received:', JSON.stringify(req.body).substring(0, 300));

    // Inject sendWaNotification ke processWebhook agar bisa kirim notif WA ke customer
    let sendWaNotification: ((storeWaId: string, contactId: string, message: string) => Promise<void>) | undefined;
    try {
      const waSvc = require('../whatsapp_service');
      if (typeof waSvc.sendFollowUpMessage === 'function') {
        sendWaNotification = async (storeWaId: string, contactId: string, message: string) => {
          await waSvc.sendFollowUpMessage(storeWaId, contactId, message);
        };
      }
    } catch (_) {
      // whatsapp_service tidak wajib ada di semua env (misal test env)
    }

    const result = await processWebhook(req.body, { sendWaNotification });
    // Xendit butuh HTTP 200 agar tidak retry
    res.status(200).json(result);
  } catch (e: any) {
    console.error('[Xendit] Webhook error:', e.message);
    // Tetap return 200 agar Xendit tidak terus-menerus retry
    res.status(200).json({ received: false, error: e.message });
  }
};

// ─── GET /api/xendit/balance ───
export const getBalance = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const balance = await fetchBalance();
    if (balance === null) {
      return res.status(400).json({ error: 'Gagal fetch balance. Cek XENDIT_API_KEY di .env' });
    }
    res.json({ balance, currency: 'IDR' });
  } catch (e) {
    next(e);
  }
};

// ─── POST /api/xendit/sync ───
export const forceSync = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const count = await syncTransactions();
    res.json({ success: true, synced: count });
  } catch (e) {
    next(e);
  }
};

// ─── GET /api/xendit/config ───
export const getConfig = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await getXenditConfig();
    res.json(config);
  } catch (e) {
    next(e);
  }
};

// ─── PUT /api/xendit/config ───
export const updateConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = req.body;
    const config = await updateXenditConfig(data);
    res.json({ success: true, config });
  } catch (e) {
    next(e);
  }
};
