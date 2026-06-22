import logger from '../utils/logger';
import axios from 'axios';
import * as QRCode from 'qrcode';
import { sendTelegramMessage } from './telegramNotifier.service';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ScalevOrderParams {
  /** Unique ID toko Scalev (dari dashboard Setting > Bisnis > Store ID) */
  store_unique_id: string;
  /** Nama customer */
  customer_name: string;
  /** Nomor HP customer */
  customer_phone?: string;
  /** Alamat lengkap customer */
  address?: string;
  /** Ongkos kirim dalam Rupiah */
  shipping_cost?: number;
  /** Metode pembayaran: 'qris' | 'bank_transfer' | 'cod' */
  payment_method?: 'qris' | 'bank_transfer' | 'cod' | 'va' | 'invoice';
  /**
   * Nominal tagihan dalam Rupiah (dipakai untuk dynamic pricing via Rp1 variant).
   * Jika diisi, scalev_service akan menggunakan custom variant dengan qty = amount.
   */
  amount?: number;
  /**
   * Rincian produk yang dipesan. Jika `amount` ada, field ini dipakai sebagai
   * keterangan notes saja (tidak dikirim ke Scalev sebagai ordervariants).
   * Format fleksibel: bisa berisi variant_unique_id atau product_name+price.
   */
  ordervariants?: Array<{
    variant_unique_id?: string;
    product_name?: string;
    variant_name?: string;
    quantity?: number;
    price?: number;
  }>;
  /** Catatan pesanan */
  notes?: string;
  /** Diskon produk */
  product_discount?: number;
  /** Diskon ongkir */
  shipping_discount?: number;
  /** Metadata tambahan */
  metadata?: Record<string, any>;
  /** Agent context (untuk attribution) */
  agent_context?: Record<string, any>;
}

export interface ScalevOrderResult {
  success: boolean;
  /** Order ID dari Scalev */
  order_id?: string;
  /** Unique key order */
  unique_key?: string;
  /** Payment method */
  payment_method?: string;
  error?: string;
  raw?: any;
}

export interface ScalevPaymentResult {
  success: boolean;
  /** URL halaman order publik (untuk dikirim ke customer) */
  public_order_url?: string;
  /** URL payment hosted Scalev */
  payment_url?: string;
  /** QR string QRIS untuk di-render jadi gambar */
  qr_string?: string;
  /** Buffer PNG gambar QRIS siap kirim ke WA */
  qrisImageBuffer?: Buffer;
  /** Method pembayaran */
  payment_method?: string;
  error?: string;
  raw?: any;
}

export interface ScalevCreateOrderAndPayResult {
  success: boolean;
  order_id?: string;
  public_order_url?: string;
  payment_url?: string;
  qr_string?: string;
  qrisImageBuffer?: Buffer;
  payment_method?: string;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════
// CONFIG HELPERS
// ═══════════════════════════════════════════════════════════════

export function getApiKey(): string {
  return process.env.SCALEV_API_KEY || '';
}

export function hasApiKey(): boolean {
  return !!getApiKey();
}

export function getStoreUniqueId(): string {
  return process.env.SCALEV_STORE_UNIQUE_ID || '';
}

/**
 * Variant ID produk "Order CRM AI" (harga Rp 1) di Scalev.
 * Dipakai sebagai carrier harga dinamis:
 *   quantity = nominal_tagihan → gross_revenue = qty x Rp1 = nominal_tagihan
 * Wajib diisi di .env sebagai SCALEV_CUSTOM_VARIANT_ID.
 */
export function getCustomVariantId(): string {
  return process.env.SCALEV_CUSTOM_VARIANT_ID || '';
}

/** Buat axios instance dengan Bearer Auth Scalev */
function getClient() {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  return axios.create({
    baseURL: 'https://api.scalev.com',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    timeout: 20000,
  });
}

// ═══════════════════════════════════════════════════════════════
// QRCODE RENDERER
// ═══════════════════════════════════════════════════════════════

/**
 * Mengubah qr_string QRIS menjadi Buffer PNG siap kirim ke WhatsApp.
 */
function firstString(...values: any[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function firstActionUrl(...actionGroups: any[]): string | null {
  for (const actions of actionGroups) {
    if (!Array.isArray(actions)) continue;
    const selected = actions.find((action: any) =>
      ['AUTH', 'CREATE', 'PAY', 'CHECKOUT', 'OPEN'].includes(String(action?.action || action?.type || '').toUpperCase())
    ) || actions[0];
    const url = firstString(selected?.url, selected?.href, selected?.link);
    if (url) return url;
  }
  return null;
}

function extractQrString(data: any): string | null {
  return firstString(
    data?.qr_string,
    data?.qris,
    data?.qris_string,
    data?.qr_code?.qr_string,
    data?.qr_code?.content,
    data?.payment_method?.qr_code?.qr_string,
    data?.payment_method?.qr_string,
    data?.pg_payment_info?.qr_string,
    data?.payment?.qr_string,
    data?.payment?.qr_code?.qr_string,
    data?.payment?.payment_method?.qr_code?.qr_string,
    data?.data?.qr_string,
    data?.data?.payment_method?.qr_code?.qr_string
  );
}

function extractPaymentUrl(data: any): string | null {
  return firstString(
    data?.payment_url,
    data?.checkout_url,
    data?.invoice_url,
    data?.payment?.payment_url,
    data?.payment?.checkout_url,
    data?.payment?.invoice_url,
    data?.data?.payment_url,
    data?.data?.checkout_url,
    data?.data?.invoice_url
  ) || firstActionUrl(data?.actions, data?.payment?.actions, data?.data?.actions);
}

function extractPublicOrderUrl(data: any): string | null {
  return firstString(
    data?.public_order_url,
    data?.order_url,
    data?.public_url,
    data?.order?.public_order_url,
    data?.order?.public_url,
    data?.data?.public_order_url,
    data?.data?.order_url
  );
}

export async function renderQrisImage(qrString: string): Promise<Buffer | null> {
  if (!qrString) return null;
  try {
    const buffer = await QRCode.toBuffer(qrString, {
      errorCorrectionLevel: 'M',
      type: 'png',
      width: 400,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });
    return buffer;
  } catch (err: any) {
    logger.error('[Scalev] Gagal render QRIS image:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// CREATE ORDER
// ═══════════════════════════════════════════════════════════════

/**
 * Membuat order baru di Scalev via POST /v3/orders.
 *
 * Scalev akan:
 * - Mencatat order di dashboard
 * - Mengembalikan order_id yang dipakai untuk membuat payment
 */
export async function createOrder(params: ScalevOrderParams): Promise<ScalevOrderResult> {
  const client = getClient();
  if (!client) {
    logger.info('[Scalev] No API key — order tidak bisa dibuat. Set SCALEV_API_KEY di .env');
    return { success: false, error: 'SCALEV_API_KEY belum dikonfigurasi' };
  }

  const storeUniqueId = params.store_unique_id || getStoreUniqueId();
  if (!storeUniqueId) {
    return { success: false, error: 'store_unique_id tidak tersedia. Set SCALEV_STORE_UNIQUE_ID di .env' };
  }

  if (!params.customer_name) {
    return { success: false, error: 'customer_name wajib diisi' };
  }

  try {
    const payload: Record<string, any> = {
      store_unique_id: storeUniqueId,
      customer_name: params.customer_name,
      payment_method: params.payment_method || 'qris',
    };

    if (params.customer_phone) payload.customer_phone = params.customer_phone;
    if (params.address) payload.address = params.address;
    if (params.metadata) payload.metadata = params.metadata;
    if (params.agent_context) payload.agent_context = params.agent_context;

    // ── DYNAMIC PRICING VIA "Order CRM AI" VARIANT (Rp 1) ──────────────────
    // Scalev tidak mendukung harga bebas/custom per order.
    // Gunakan produk "Order CRM AI" (Rp 1, is_editable=true) dengan
    // quantity = nominal tagihan sehingga gross_revenue = nominal yang tepat.
    const customVariantId = getCustomVariantId();
    const amount = params.amount ? Math.round(Number(params.amount)) : 0;

    if (customVariantId && amount > 0) {
      payload.ordervariants = [{
        variant_unique_id: customVariantId,
        quantity: amount, // qty 50000 x Rp1 = Rp 50.000
      }];

      // Rincian produk asli masuk ke notes agar kelihatan di dashboard Scalev
      const detailLines: string[] = [];
      if (params.ordervariants && params.ordervariants.length > 0) {
        params.ordervariants.forEach((v, i) => {
          const nama = v.product_name || 'Produk';
          const varian = v.variant_name ? ` (${v.variant_name})` : '';
          const qty = v.quantity ? `x${v.quantity}` : '';
          const harga = v.price ? ` @ Rp ${Number(v.price).toLocaleString('id-ID')}` : '';
          detailLines.push(`${i + 1}. ${nama}${varian} ${qty}${harga}`.trim());
        });
      }

      const baseNote = params.notes || '';
      const detailNote = detailLines.length > 0 ? `\n\nRincian Pesanan:\n${detailLines.join('\n')}` : '';
      payload.notes = (baseNote + detailNote).trim();

    } else if (!customVariantId) {
      logger.warn('[Scalev] ⚠️  SCALEV_CUSTOM_VARIANT_ID tidak dikonfigurasi! Order mungkin gagal karena gross_revenue=0.');
      if (params.ordervariants && params.ordervariants.length > 0) payload.ordervariants = params.ordervariants;
      if (params.notes) payload.notes = params.notes;
    }

    // Jika tidak menggunakan customVariantId, kirim ongkir/diskon seperti biasa
    if (!customVariantId) {
      if (params.shipping_cost != null) payload.shipping_cost = params.shipping_cost;
      if (params.product_discount != null) payload.product_discount = params.product_discount;
      if (params.shipping_discount != null) payload.shipping_discount = params.shipping_discount;
    }

    const res = await client.post('/v3/orders', payload);
    const order = res.data;

    logger.info(`[Scalev] ✅ Order created: ${order.order_id || order.id} | customer: ${params.customer_name} | Rp ${amount}`);

    return {
      success: true,
      order_id: order.order_id || String(order.id),
      unique_key: order.unique_key,
      payment_method: order.payment_method,
      raw: order,
    };
  } catch (err: any) {
    logger.error('[Scalev] Gagal create order:', err.message);
    if (err.response) {
      logger.error('[Scalev] Response:', JSON.stringify(err.response.data));
    }
    return {
      success: false,
      error: err.response?.data?.message || err.response?.data?.error || err.message,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// CREATE PAYMENT (QRIS/Bank Transfer/COD)
// ═══════════════════════════════════════════════════════════════

/**
 * Membuat payment request untuk order yang sudah ada.
 * 
 * Scalev menggunakan Xendit sebagai payment gateway.
 * Struktur response payment endpoint (POST /v3/orders/:id/payment):
 *   - payment_method: object Xendit dengan type="QR_CODE"
 *   - payment_method.qr_code.qr_string: isi QR code yang bisa di-render
 *   - actions: array link aksi (checkout url)
 */
export async function createPaymentForOrder(orderId: string): Promise<ScalevPaymentResult> {
  const client = getClient();
  if (!client) {
    return { success: false, error: 'SCALEV_API_KEY belum dikonfigurasi' };
  }

  try {
    const res = await client.post(`/v3/orders/${orderId}/payment`);
    const data = res.data;

    // ── Ekstrak payment_method yang bisa berupa string atau object (Xendit format) ──
    let paymentMethodStr = 'qris';
    if (data.payment_method && typeof data.payment_method === 'object') {
      paymentMethodStr = (data.payment_method.type || 'QR_CODE').toLowerCase();
    } else if (typeof data.payment_method === 'string') {
      paymentMethodStr = data.payment_method;
    }

    // ── Ekstrak QR string dari Xendit response structure ──
    // Xendit format: payment_method.qr_code.qr_string
    const qrString = extractQrString(data);
    

    // ── Ekstrak payment URL dari actions array (Xendit format) ──
    const paymentUrl = extractPaymentUrl(data);
    const publicOrderUrl = extractPublicOrderUrl(data);

    let qrisImageBuffer: Buffer | undefined;
    if (qrString) {
      const buf = await renderQrisImage(qrString);
      if (buf) qrisImageBuffer = buf;
    }

    logger.info(`[Scalev] ✅ Payment created for order ${orderId}: method=${paymentMethodStr}, qris=${!!qrString}, image=${!!qrisImageBuffer}`);

    return {
      success: true,
      public_order_url: publicOrderUrl ?? undefined,
      payment_url: paymentUrl ?? undefined,
      qr_string: qrString ?? undefined,
      qrisImageBuffer,
      payment_method: paymentMethodStr,
      raw: data,
    };
  } catch (err: any) {
    logger.error('[Scalev] Gagal create payment:', err.message);
    if (err.response) {
      logger.error('[Scalev] Response:', JSON.stringify(err.response.data));
    }
    return {
      success: false,
      error: err.response?.data?.message || err.response?.data?.error || err.message,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// CREATE ORDER + PAYMENT (SATU LANGKAH — UNTUK AI TOOL)
// ═══════════════════════════════════════════════════════════════

/**
 * Membuat order DAN payment sekaligus dalam satu panggilan.
 * Ini adalah fungsi utama yang dipanggil dari AI tool `buat_order_scalev`.
 *
 * Flow:
 * 1. POST /v3/orders → dapat order_id
 * 2. POST /v3/orders/{id}/payment → dapat qr_string (QRIS) atau public_order_url
 * 3. Render qr_string → Buffer PNG
 * 4. Return semua hasilnya
 */
export async function createOrderAndPay(params: ScalevOrderParams): Promise<ScalevCreateOrderAndPayResult> {
  // Step 1: Buat order
  const orderResult = await createOrder(params);
  if (!orderResult.success || !orderResult.order_id) {
    return {
      success: false,
      error: `Gagal buat order: ${orderResult.error}`,
    };
  }

  const orderId = orderResult.order_id;

  // Step 2: Buat payment
  const paymentResult = await createPaymentForOrder(orderId);
  if (!paymentResult.success) {
    // Order berhasil tapi payment gagal — kembalikan public_order_url saja
    logger.warn(`[Scalev] Order ${orderId} berhasil tapi payment gagal: ${paymentResult.error}`);
    return {
      success: true, // order tetap terbuat
      order_id: orderId,
      public_order_url: undefined,
      payment_url: undefined,
      payment_method: params.payment_method,
      error: `Payment gagal: ${paymentResult.error}. Order ID: ${orderId}`,
    };
  }

  return {
    success: true,
    order_id: orderId,
    public_order_url: paymentResult.public_order_url,
    payment_url: paymentResult.payment_url,
    qr_string: paymentResult.qr_string,
    qrisImageBuffer: paymentResult.qrisImageBuffer,
    payment_method: paymentResult.payment_method,
    error: (paymentResult.qrisImageBuffer || paymentResult.payment_url || paymentResult.public_order_url)
      ? undefined
      : 'Scalev payment response tidak berisi QRIS image, payment URL, atau public order URL.',
  };
}

// ═══════════════════════════════════════════════════════════════
// GET ORDER
// ═══════════════════════════════════════════════════════════════

export async function getOrder(orderId: string): Promise<any | null> {
  const client = getClient();
  if (!client) return null;
  try {
    const res = await client.get(`/v3/orders/${orderId}`);
    return res.data;
  } catch (err: any) {
    logger.error(`[Scalev] Gagal get order ${orderId}:`, err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// CHECK PAYMENT STATUS
// ═══════════════════════════════════════════════════════════════

export async function checkPaymentStatus(orderId: string): Promise<{ paid: boolean; status: string } | null> {
  const client = getClient();
  if (!client) return null;
  try {
    const res = await client.get(`/v3/orders/${orderId}/payment-status`);
    const data = res.data;
    return {
      paid: data.is_paid === true || data.payment_status === 'paid',
      status: data.payment_status || 'unknown',
    };
  } catch (err: any) {
    logger.error(`[Scalev] Gagal check payment status ${orderId}:`, err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// LIST PRODUCTS (untuk mendapatkan variant_unique_id)
// ═══════════════════════════════════════════════════════════════

export async function listProducts(storeUniqueId?: string): Promise<any[]> {
  const client = getClient();
  if (!client) return [];
  try {
    const res = await client.get('/v3/products', {
      params: { limit: 100, store_unique_id: storeUniqueId || getStoreUniqueId() }
    });
    return res.data?.data || res.data || [];
  } catch (err: any) {
    logger.error('[Scalev] Gagal list products:', err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// PROCESS WEBHOOK — Handler untuk callback dari Scalev
// ═══════════════════════════════════════════════════════════════

/**
 * Memproses webhook dari Scalev saat order LUNAS.
 *
 * Scalev mengirim webhook ketika status order berubah (paid, shipped, dll).
 * Kita handle status 'paid' untuk kirim notif WA ke customer.
 */
export async function processWebhook(
  body: any,
  opts?: {
    /** Fungsi untuk kirim notif WA ke customer setelah PAID */
    sendWaNotification?: (storeWaId: string, contactId: string, message: string) => Promise<void>;
    /** Store WA ID default jika tidak ada di body */
    defaultStoreWaId?: string;
  }
): Promise<{ received: boolean; status: string }> {
  try {
    // Scalev webhook fields: event, order (object), data, status
    const event = body.event || body.type || '';
    const orderData = body.order || body.data || body;
    const orderId = orderData.order_id || orderData.id || body.order_id || '';
    const status = orderData.payment_status || orderData.status || body.status || '';

    logger.info(`[Scalev] Webhook received: event=${event} order=${orderId} status=${status}`);

    if (!orderId) {
      return { received: false, status: 'invalid_payload' };
    }

    // Tangani event paid/lunas
    const isPaid = status === 'paid' || status === 'completed' ||
                   event === 'order.paid' || event === 'order.completed' ||
                   (body.payment_status === 'paid');

    if (isPaid) {
      const customerPhone = orderData.customer?.phone || orderData.customer_phone || '';
      const customerName = orderData.customer?.name || orderData.customer_name || '';
      const totalAmount = orderData.total_price || orderData.grand_total || orderData.amount || 0;
      const storeWaId = opts?.defaultStoreWaId || '';

      logger.info(`[Scalev] ✅ ORDER PAID: ${orderId} customer: ${customerName} ${customerPhone} Rp ${totalAmount}`);

      // Kirim notif WA ke customer
      if (customerPhone && opts?.sendWaNotification && storeWaId) {
        const waNotif = [
          `Alhamdulillah, pembayaran Rp ${Number(totalAmount).toLocaleString('id-ID')} sudah kami terima bund! 🎉`,
          ``,
          `Estimasi pengerjaan: 2-3 hari kerja.`,
          `📦 Pulau Jawa: 3-5 hari`,
          `📦 Luar Jawa: 5-9 hari kerja`,
          ``,
          `Ditunggu ya bund, semoga produknya sesuai harapan 🙏`,
        ].join('\n');

        try {
          await opts.sendWaNotification(storeWaId, customerPhone, waNotif);
          logger.info(`[Scalev] ✅ Notif WA terkirim ke ${customerPhone}`);
        } catch (waErr: any) {
          logger.error(`[Scalev] Gagal kirim notif WA: ${waErr.message}`);
        }
      }

      // Kirim Telegram notif
      const telegramMsg = `💳 <b>Pembayaran Scalev Diterima!</b>\n\n📋 Order: ${orderId}\n👤 Customer: ${customerName}\n📱 HP: ${customerPhone}\n💰 Jumlah: <b>Rp ${Number(totalAmount).toLocaleString('id-ID')}</b>\n📊 Status: ✅ PAID\n⏱ Waktu: ${new Date().toLocaleString('id-ID')}`;
      await sendTelegramMessage(telegramMsg).catch(() => {});

      // Emit Socket.IO update ke dashboard
      try {
        const { socketService } = require('./socket.service');
        socketService.emitDashboardUpdate();
      } catch (_) {}
    }

    return { received: true, status };
  } catch (err: any) {
    logger.error('[Scalev] Webhook processing error:', err.message);
    return { received: false, status: 'error' };
  }
}

// ═══════════════════════════════════════════════════════════════
// CANCEL ORDER
// ═══════════════════════════════════════════════════════════════

export async function cancelOrderIfManualTransfer(storeUniqueId: string, customerPhone: string): Promise<boolean> {
  const client = getClient();
  if (!client) return false;
  if (!customerPhone) return false;

  try {
    // Cari order terakhir berdasarkan nomor HP
    // Scalev v3 list order endpoint: GET /v3/orders
    const res = await client.get('/v3/orders', {
      params: { 
        limit: 20, 
        store_unique_id: storeUniqueId || getStoreUniqueId(),
      }
    });

    const orders = res.data?.data || res.data || [];
    
    // Normalisasi phone (hapus +62, 08, dsb agar matching lebih kebal)
    const normalizePhone = (p: string) => (p || '').replace(/\D/g, '').replace(/^(62|0)/, '');
    const targetPhone = normalizePhone(customerPhone);

    const pendingOrder = orders.find((o: any) => {
       const oPhone = normalizePhone(o.customer?.phone || o.customer_phone || '');
       const isUnpaid = o.payment_status === 'unpaid' || o.payment_status === 'pending';
       const isNotCanceled = o.status !== 'canceled' && o.status !== 'cancelled';
       return oPhone === targetPhone && isUnpaid && isNotCanceled;
    });

    if (pendingOrder) {
       const orderId = pendingOrder.order_id || pendingOrder.id;
       logger.info(`[Scalev] Ditemukan order menggantung (${orderId}) untuk ${customerPhone}. Mencoba cancel...`);
       
       // Sesuai dokumentasi: duplicate-and-cancel
       try {
           await client.post(`/v3/orders/${orderId}/duplicate-and-cancel`, {});
           logger.info(`[Scalev] ✅ Order ${orderId} berhasil di-duplicate-and-cancel (dibatalkan).`);
           return true;
       } catch (err1: any) {
           // Fallback: PUT status
           try {
               await client.put(`/v3/orders/${orderId}`, { status: 'canceled' });
               logger.info(`[Scalev] ✅ Order ${orderId} berhasil diubah statusnya menjadi canceled.`);
               return true;
           } catch (err2: any) {
               logger.warn(`[Scalev] Gagal cancel order ${orderId}: ${err2.message}`);
               return false;
           }
       }
    } else {
       logger.info(`[Scalev] Tidak ada order pending yang cocok untuk di-cancel bagi HP ${customerPhone}.`);
       return false;
    }
  } catch (err: any) {
    logger.error('[Scalev] Error saat check/cancel order:', err.message);
    return false;
  }
}
