import { Request, Response } from 'express';
import * as scalevService from '../services/scalev.service';

// ═══════════════════════════════════════════════════════════════
// WEBHOOK — Public endpoint (Scalev callback saat order PAID)
// ═══════════════════════════════════════════════════════════════

export async function handleWebhook(req: Request, res: Response) {
  try {
    const body = req.body;
    console.log('[Scalev] Webhook received:', JSON.stringify(body).slice(0, 200));

    // Dapatkan WA service untuk kirim notif
    let sendWaNotification: ((storeWaId: string, contactId: string, message: string) => Promise<void>) | undefined;
    let defaultStoreWaId: string | undefined;

    try {
      const waSvc = require('../whatsapp_service');
      // Ambil store WA ID default dari env atau config
      defaultStoreWaId = process.env.SCALEV_DEFAULT_STORE_WA_ID || '';

      sendWaNotification = async (storeWaId: string, contactId: string, message: string) => {
        const client = waSvc.getActiveClient ? waSvc.getActiveClient(storeWaId) : null;
        if (client) {
          const { assertWaChatId } = require('../utils/wa_id');
          const chatId = assertWaChatId(contactId);
          const msg = await client.sendMessage(chatId, message);
          const msgId = msg?.id?._serialized || msg?.id?.id;
          if (msgId && waSvc.trackBotSentMessage) waSvc.trackBotSentMessage(msgId);
        }
      };
    } catch (e) {
      // Non-critical: log saja
      console.warn('[Scalev] WA service tidak tersedia untuk webhook notif');
    }

    const result = await scalevService.processWebhook(body, {
      sendWaNotification,
      defaultStoreWaId,
    });

    res.json({ received: result.received, status: result.status });
  } catch (err: any) {
    console.error('[Scalev] Webhook handler error:', err.message);
    res.status(200).json({ received: false, error: err.message }); // Selalu 200 agar Scalev tidak retry
  }
}

// ═══════════════════════════════════════════════════════════════
// CREATE ORDER (Admin)
// ═══════════════════════════════════════════════════════════════

export async function createOrderHandler(req: Request, res: Response) {
  try {
    const params = req.body as scalevService.ScalevOrderParams;
    const result = await scalevService.createOrderAndPay(params);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (err: any) {
    console.error('[Scalev] createOrderHandler error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// GET ORDER (Admin)
// ═══════════════════════════════════════════════════════════════

export async function getOrderHandler(req: Request, res: Response) {
  try {
    const orderId = req.params.orderId as string;
    const order = await scalevService.getOrder(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order tidak ditemukan' });
    }
    res.json(order);
  } catch (err: any) {
    console.error('[Scalev] getOrderHandler error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// LIST PRODUCTS (Admin — untuk dapat variant_unique_id)
// ═══════════════════════════════════════════════════════════════

export async function listProductsHandler(req: Request, res: Response) {
  try {
    const storeUniqueId = (req.query.store_unique_id as string) || undefined;
    const products = await scalevService.listProducts(storeUniqueId);
    res.json({ products, total: products.length });
  } catch (err: any) {
    console.error('[Scalev] listProductsHandler error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

export async function getConfigHandler(req: Request, res: Response) {
  res.json({
    hasApiKey: scalevService.hasApiKey(),
    storeUniqueId: scalevService.getStoreUniqueId() || null,
    apiBaseUrl: 'https://api.scalev.com',
    docsUrl: 'https://docs.scalev.com',
  });
}

export async function updateConfigHandler(req: Request, res: Response) {
  res.json({ message: 'Update config via .env file (SCALEV_API_KEY, SCALEV_STORE_UNIQUE_ID)' });
}
