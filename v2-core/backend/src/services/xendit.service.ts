import axios from 'axios';
import * as QRCode from 'qrcode';
import { XenditTransaction, AppConfig, ChatSummary } from '../models';
import { sendTelegramMessage } from './telegramNotifier.service';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface XenditInvoiceResponse {
  id: string;
  external_id: string;
  user_id: string;
  status: string;
  merchant_name: string;
  merchant_profile_picture_url: string;
  amount: number;
  payer_email: string;
  description: string;
  invoice_url: string;
  expiry_date: string;
  available_banks: any[];
  available_retail_outlets: any[];
  should_exclude_credit_card: boolean;
  should_send_email: boolean;
  created: string;
  updated: string;
  paid_at: string | null;
  currency: string;
}

/** Response dari endpoint /qr_codes Xendit */
interface XenditQrResponse {
  id: string;
  reference_id: string;
  type: 'DYNAMIC' | 'STATIC';
  currency: string;
  amount: number;
  channel_code: string;
  status: 'ACTIVE' | 'INACTIVE';
  qr_string: string;
  created: string;
  updated: string;
  expires_at?: string;
  metadata?: Record<string, string>;
}

interface XenditBalanceResponse {
  balance: number;
}

/** Parameter untuk membuat QRIS dinamis */
export interface CreateQrisParams {
  /** Reference ID unik per order/transaksi */
  reference_id: string;
  /** Nominal dalam Rupiah — WAJIB sesuai rekap yang sudah dikonfirmasi customer */
  amount: number;
  /** Deskripsi pembayaran */
  description?: string;
  /** ID contact (contact_id WhatsApp) */
  contact_id?: string;
  /** Nomor HP customer untuk kirim notif WA */
  contact_phone?: string;
  /** WA ID toko */
  store_wa_id?: string;
  /** 'DP' = bayar sebagian, 'LUNAS' = bayar penuh */
  tipe_bayar?: 'DP' | 'LUNAS';
  /** 'COD' | 'TRANSFER' — untuk validasi backend: kalau COD, QRIS akan ditolak */
  payment_type?: 'COD' | 'TRANSFER';
}

export interface QrisPaymentResult {
  /** True jika berhasil */
  success: boolean;
  /** Buffer PNG gambar QRIS siap kirim ke WA */
  qrisImageBuffer?: Buffer;
  /** Raw qr_string dari Xendit (untuk backup/regenerasi) */
  qr_string?: string;
  /** ID QR dari Xendit */
  qr_id?: string;
  /** Reference ID */
  reference_id?: string;
  /** Waktu expired QRIS */
  expires_at?: string;
  /** Nominal */
  amount?: number;
  /** Pesan error jika gagal */
  error?: string;
}

// ═══════════════════════════════════════════════════════════════
// SCHEDULER STATE
// ═══════════════════════════════════════════════════════════════

let xenditInterval: ReturnType<typeof setInterval> | null = null;

// ═══════════════════════════════════════════════════════════════
// CONFIG HELPERS
// ═══════════════════════════════════════════════════════════════

async function getConfig(key: string, defaultVal: string): Promise<string> {
  const rec = await AppConfig.findOne({ where: { key } });
  return rec?.getDataValue('value') || defaultVal;
}

async function setConfig(key: string, value: string): Promise<void> {
  await AppConfig.upsert({ key, value } as any);
}

// ═══════════════════════════════════════════════════════════════
// API KEY & CLIENT
// ═══════════════════════════════════════════════════════════════

export function getApiKey(): string {
  return process.env.XENDIT_API_KEY || '';
}

export function hasApiKey(): boolean {
  return !!getApiKey();
}

function getWebhookSecret(): string {
  return process.env.XENDIT_WEBHOOK_VERIFICATION_TOKEN || '';
}

/** Buat axios instance dengan Basic Auth Xendit */
function getClient() {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  return axios.create({
    baseURL: 'https://api.xendit.co',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + Buffer.from(apiKey + ':').toString('base64'),
    },
    timeout: 15000,
  });
}

// ═══════════════════════════════════════════════════════════════
// QRCODE RENDERER
// ═══════════════════════════════════════════════════════════════

/**
 * Mengubah qr_string QRIS menjadi Buffer PNG siap kirim ke WhatsApp.
 * Menggunakan library `qrcode` (zero-dependency, ringan).
 * 
 * @param qrString Raw qr_string dari Xendit QR API
 * @returns Buffer PNG, atau null jika gagal
 */
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
    console.error('[Xendit] Gagal render QRIS image:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// FETCH BALANCE
// ═══════════════════════════════════════════════════════════════

export async function fetchBalance(): Promise<number | null> {
  const client = getClient();
  if (!client) return null;
  try {
    const res = await client.get<XenditBalanceResponse>('/balance');
    return res.data.balance;
  } catch (err: any) {
    console.error('[Xendit] Gagal fetch balance:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// CREATE QRIS DINAMIS — ENDPOINT UTAMA
// ═══════════════════════════════════════════════════════════════

/**
 * Membuat QRIS dinamis via endpoint /qr_codes Xendit.
 * 
 * PERBEDAAN dari createQrisInvoice (yang lama):
 * - Endpoint: /qr_codes (bukan /v2/invoices)
 * - Output: qr_string yang dirender jadi PNG — bisa langsung dikirim ke WA
 * - Tidak menghasilkan halaman web checkout
 * - Hanya QRIS — tidak ada VA bank, retail outlet, dll
 * 
 * Rules:
 * - HANYA untuk NON-COD / Transfer
 * - Nominal WAJIB sesuai rekap yang sudah dikonfirmasi customer
 * - Jangan panggil ini untuk order COD
 */
/**
 * P1 FIX: Validasi backend sebelum membuat payment link QRIS.
 * Guard tambahan untuk mencegah AI hallucination membuat payment link
 * saat customer belum konfirmasi, pilih COD, atau nominal tidak jelas.
 * 
 * Rules:
 * - Kalau payment_type = 'COD' → reject
 * - Cek ChatSummary: jika summary mengandung indikasi COD → reject
 * - Pastikan ChatSummary sudah di-update (ada rekap) dalam 24 jam terakhir
 */
async function validateOrderBeforePayment(params: CreateQrisParams): Promise<{ valid: boolean; error?: string }> {
  const { contact_id, store_wa_id, payment_type, amount } = params;

  // ── Guard 0: Nominal harus valid (positive integer) ──────────────
  const safeAmount = Math.round(Number(amount));
  if (!safeAmount || safeAmount <= 0) {
    return { valid: false, error: `Nominal tidak valid: ${amount}. Nominal HARUS diambil dari rekap pesanan yang sudah dikonfirmasi customer.` };
  }

  // ── Guard 1: Explicit COD reject ────────────────────────────────
  if (payment_type === 'COD') {
    return {
      valid: false,
      error: 'Pembayaran COD tidak memerlukan link pembayaran QRIS. Jangan panggil tool ini untuk order COD. Untuk COD, cukup kirim ucapan terima kasih + estimasi pengerjaan/pengiriman.'
    };
  }

  // ── Guard 2: Cek ChatSummary untuk deteksi COD & konfirmasi ─────
  if (contact_id && store_wa_id) {
    try {
      // Normalize contact_id: ChatSummary pakai format @c.us
      let lookupId = contact_id;
      if (!lookupId.includes('@')) {
        lookupId = `${contact_id}@c.us`;
      }

      const summary = await ChatSummary.findOne({
        where: { store_wa_id, contact_id: lookupId }
      });

      if (!summary) {
        // Coba tanpa @c.us
        const plainId = contact_id.replace('@c.us', '');
        const summary2 = await ChatSummary.findOne({
          where: { store_wa_id, contact_id: plainId }
        });
        if (!summary2) {
          // Tidak ada summary — customer belum pernah rekap. Tolak.
          return {
            valid: false,
            error: 'Belum ada rekap pesanan untuk customer ini. Customer harus melalui proses rekap & konfirmasi terlebih dahulu sebelum payment link dibuat.'
          };
        }
        // Gunakan summary yang ditemukan
        const summaryText = String(summary2.getDataValue('summary') || '');
        const lastUpdated = summary2.getDataValue('last_updated');
        return validateSummaryText(summaryText, lastUpdated, payment_type);
      }

      const summaryText = String(summary.getDataValue('summary') || '');
      const lastUpdated = summary.getDataValue('last_updated');
      return validateSummaryText(summaryText, lastUpdated, payment_type);
    } catch (dbErr: any) {
      // DB query gagal bukan berarti payment gagal — log dan lanjut
      console.warn('[Xendit] Validasi ChatSummary gagal (non-blocking):', dbErr.message);
    }
  }

  return { valid: true };
}

/**
 * Parse summary text untuk deteksi COD dan status konfirmasi.
 */
function validateSummaryText(
  summaryText: string,
  lastUpdated: Date | null,
  explicitPaymentType?: string
): { valid: boolean; error?: string } {
  // ── Deteksi COD dari summary ──────────────────────────────────
  const upperSummary = summaryText.toUpperCase();
  
  // Pattern COD detection
  const codPatterns = [
    'PENGIRIMAN = COD',
    'PENGIRIMAN : COD', 
    'PENGIRIMAN COD',
    'METODE BAYAR.*COD',
    'METODE PEMBAYARAN.*COD',
    'PEMBAYARAN.*COD',
    'BAYAR DI TEMPAT',
    'CASH ON DELIVERY',
    'BAYAR KE KURIR',
    'DIBAYAR KE KURIR',
  ];

  for (const pattern of codPatterns) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(summaryText)) {
      // Double-check: kalau payment_type explicit 'TRANSFER', override
      if (explicitPaymentType === 'TRANSFER') {
        break; // Lanjut — explicit TRANSFER overrides deteksi COD
      }
      return {
        valid: false,
        error: 'Order ini menggunakan metode pembayaran COD (Bayar di Tempat). COD tidak memerlukan QRIS atau link pembayaran. Jangan panggil tool ini untuk order COD. Kirimkan saja ucapan terima kasih dan estimasi pengerjaan.'
      };
    }
  }

  // ── Cek apakah summary sudah di-update (rekap) ──────────────────
  if (lastUpdated) {
    const hoursAgo = (Date.now() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60);
    if (hoursAgo > 48) {
      return {
        valid: false,
        error: `Rekap pesanan sudah lama tidak diupdate (${Math.round(hoursAgo)} jam yang lalu). Pastikan customer baru saja mengkonfirmasi rekap sebelum membuat payment link.`
      };
    }
  }

  // ── Cek indikasi konfirmasi di summary ──────────────────────────
  const confirmPatterns = [
    'TOTAL HARUS DIBAYAR',
    'TOTAL DIBAYAR',
    'SUDAH KONFIRMASI',
    'KONFIRMASI',
  ];
  const hasConfirmation = confirmPatterns.some(p => upperSummary.includes(p));

  if (!hasConfirmation && summaryText === 'Belum ada rekapan.') {
    return {
      valid: false,
      error: 'Customer belum memiliki rekap pesanan. Tanyakan dulu produk, varian, jumlah, dan alamat. Rekap hanya dikirim setelah semua data lengkap dan customer konfirmasi.'
    };
  }

  if (!hasConfirmation && summaryText !== 'Belum ada rekapan.') {
    console.warn('[Xendit] Summary sudah ada tapi tidak mengandung konfirmasi — lanjutkan dengan hati-hati');
  }

  return { valid: true };
}

export async function createQrisPayment(params: CreateQrisParams): Promise<QrisPaymentResult> {
  // P1 FIX: Validasi backend sebelum membuat QRIS
  const validation = await validateOrderBeforePayment(params);
  if (!validation.valid) {
    console.warn(`[Xendit] QRIS creation BLOCKED: ${validation.error}`);
    return { success: false, error: validation.error };
  }

  const client = getClient();
  if (!client) {
    console.log('[Xendit] No API key — QRIS tidak bisa dibuat. Set XENDIT_API_KEY di .env');
    return { success: false, error: 'XENDIT_API_KEY belum dikonfigurasi' };
  }

  // Guard: nominal wajib positif dan integer
  const safeAmount = Math.round(Number(params.amount));
  if (!safeAmount || safeAmount <= 0) {
    console.error('[Xendit] Nominal QRIS tidak valid:', params.amount);
    return { success: false, error: `Nominal tidak valid: ${params.amount}` };
  }

  const tipeBayar = params.tipe_bayar || 'LUNAS';
  const contactPhone = params.contact_phone || params.contact_id || 'unknown';
  const desc = params.description || `Pembayaran ${params.reference_id}`;

  try {
    // ── Buat QRIS via Xendit /qr_codes ──────────────────────────
    const qrPayload = {
      reference_id: params.reference_id,
      type: 'DYNAMIC',
      currency: 'IDR',
      amount: safeAmount,
      // expires_at: 30 menit dari sekarang (Xendit menerima ISO string)
      // Jika tidak diset, Xendit default ke waktu cukup lama
      // Kita set 30 menit untuk UX yang lebih baik
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      metadata: {
        tipe_bayar: tipeBayar,
        contact_phone: contactPhone,
        description: desc,
        created_by: 'bot_ai',
      },
    };

    const res = await client.post<XenditQrResponse>('/qr_codes', qrPayload, {
      headers: { 'api-version': '2022-07-31' },
    });
    const qrData = res.data;

    // ── Render qr_string → Buffer PNG ───────────────────────────
    const qrisImageBuffer = await renderQrisImage(qrData.qr_string);

    // ── Simpan ke database ────────────────────────────────────────
    try {
      await XenditTransaction.create({
        external_id: params.reference_id,
        reference_id: qrData.reference_id,
        qr_id: qrData.id,
        qr_string: qrData.qr_string,
        amount: safeAmount,
        status: 'PENDING',
        description: desc,
        tipe_bayar: tipeBayar,
        contact_id: params.contact_id || null,
        contact_phone: contactPhone,
        store_wa_id: params.store_wa_id || null,
        qris_expired_at: qrData.expires_at ? new Date(qrData.expires_at) : null,
        source_type: 'qris',
        metadata: JSON.stringify({
          tipe_bayar: tipeBayar,
          contact_phone: contactPhone,
        }),
        notif_sent: false,
        raw_response: JSON.stringify(qrData),
      } as any);
    } catch (dbErr: any) {
      // DB error tidak boleh menggagalkan create QRIS — log saja
      console.error('[Xendit] Gagal simpan ke DB:', dbErr.message);
    }

    console.log(
      `[Xendit] ✅ QRIS created: ${qrData.reference_id} — Rp ${safeAmount.toLocaleString('id-ID')} [${tipeBayar}] contact: ${contactPhone}`
    );

    return {
      success: true,
      qrisImageBuffer: qrisImageBuffer || undefined,
      qr_string: qrData.qr_string,
      qr_id: qrData.id,
      reference_id: qrData.reference_id,
      expires_at: qrData.expires_at,
      amount: safeAmount,
    };
  } catch (err: any) {
    console.error('[Xendit] Gagal create QRIS:', err.message);
    if (err.response) {
      console.error('[Xendit] Response:', JSON.stringify(err.response.data));
    }
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// GET QR STATUS
// ═══════════════════════════════════════════════════════════════

/** Cek status QRIS dari Xendit berdasarkan reference_id */
export async function getQrStatus(referenceId: string): Promise<XenditQrResponse | null> {
  const client = getClient();
  if (!client) return null;
  try {
    const res = await client.get<XenditQrResponse[]>(`/qr_codes?reference_id=${referenceId}`, {
      headers: { 'api-version': '2022-07-31' },
    });
    const items = Array.isArray(res.data) ? res.data : [res.data];
    return items[0] || null;
  } catch (err: any) {
    console.error(`[Xendit] Gagal get QR status ${referenceId}:`, err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// INVOICE (LAMA — tetap ada untuk backward compat & admin manual)
// ═══════════════════════════════════════════════════════════════

/**
 * Buat invoice halaman web Xendit (untuk admin dashboard atau kasus khusus).
 * BUKAN untuk dikirim ke WA — gunakan createQrisPayment untuk itu.
 */
export async function createInvoice(params: {
  external_id: string;
  amount: number;
  payer_email?: string;
  description?: string;
  contact_id?: string;
  store_wa_id?: string;
  success_redirect_url?: string;
  failure_redirect_url?: string;
  metadata?: Record<string, string>;
}): Promise<XenditInvoiceResponse | null> {
  const client = getClient();
  if (!client) {
    console.log('[Xendit] No API key configured. Set XENDIT_API_KEY in .env');
    return null;
  }

  const safeAmount = Math.round(Number(params.amount));
  if (!safeAmount || safeAmount <= 0) {
    console.error('[Xendit] Nominal invoice tidak valid:', params.amount);
    return null;
  }

  try {
    const payload: Record<string, any> = {
      external_id: params.external_id,
      amount: safeAmount,
      description: params.description || `Pembayaran ${params.external_id}`,
      invoice_duration: 86400,
      currency: 'IDR',
      should_exclude_credit_card: true,
    };
    if (params.payer_email) payload.payer_email = params.payer_email;
    if (params.success_redirect_url) payload.success_redirect_url = params.success_redirect_url;
    if (params.failure_redirect_url) payload.failure_redirect_url = params.failure_redirect_url;
    if (params.metadata) payload.metadata = params.metadata;

    const res = await client.post<XenditInvoiceResponse>('/v2/invoices', payload);
    const invoice = res.data;

    await XenditTransaction.create({
      external_id: invoice.external_id,
      invoice_url: invoice.invoice_url,
      amount: safeAmount,
      status: invoice.status,
      payer_email: invoice.payer_email || null,
      description: invoice.description || null,
      contact_id: params.contact_id || null,
      store_wa_id: params.store_wa_id || null,
      expiry_date: invoice.expiry_date ? new Date(invoice.expiry_date) : null,
      source_type: 'invoice',
      raw_response: JSON.stringify(invoice),
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    } as any);

    console.log(`[Xendit] Invoice created: ${invoice.external_id} — Rp ${safeAmount.toLocaleString('id-ID')}`);
    return invoice;
  } catch (err: any) {
    console.error('[Xendit] Gagal create invoice:', err.message);
    if (err.response) console.error('[Xendit] Response:', JSON.stringify(err.response.data));
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// BACKWARD COMPAT — createQrisInvoice (alias ke createQrisPayment)
// ═══════════════════════════════════════════════════════════════

/** @deprecated Gunakan createQrisPayment. Ini alias untuk backward compat. */
export async function createQrisInvoice(params: {
  external_id: string;
  amount: number;
  description?: string;
  contact_id?: string;
  store_wa_id?: string;
  tipe_bayar?: 'DP' | 'LUNAS';
  contact_phone?: string;
}): Promise<XenditInvoiceResponse | null> {
  // Delegate ke createQrisPayment (endpoint yang benar)
  const result = await createQrisPayment({
    reference_id: params.external_id,
    amount: params.amount,
    description: params.description,
    contact_id: params.contact_id,
    store_wa_id: params.store_wa_id,
    tipe_bayar: params.tipe_bayar || 'LUNAS',
    contact_phone: params.contact_phone,
  });
  // Return null-compatible untuk backward compat
  if (!result.success) return null;
  // Fake invoice response shape yang dipakai caller lama
  return {
    id: result.qr_id || '',
    external_id: result.reference_id || params.external_id,
    invoice_url: '',
  } as any;
}

// ═══════════════════════════════════════════════════════════════
// GET INVOICE (lama — untuk invoice list di controller)
// ═══════════════════════════════════════════════════════════════

export async function getInvoice(externalId: string): Promise<XenditInvoiceResponse | null> {
  const client = getClient();
  if (!client) return null;
  try {
    const res = await client.get<XenditInvoiceResponse>(`/v2/invoices?external_id=${externalId}`);
    const invoices = res.data as any;
    const invoice = Array.isArray(invoices) ? invoices[0] : invoices;
    return invoice || null;
  } catch (err: any) {
    console.error(`[Xendit] Gagal get invoice ${externalId}:`, err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPIRE INVOICE
// ═══════════════════════════════════════════════════════════════

export async function expireInvoice(externalId: string): Promise<boolean> {
  const client = getClient();
  if (!client) return false;
  try {
    await client.post(`/invoices/${externalId}/expire!`);
    console.log(`[Xendit] Invoice expired: ${externalId}`);
    return true;
  } catch (err: any) {
    console.error(`[Xendit] Gagal expire invoice ${externalId}:`, err.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// PROCESS WEBHOOK — Handler untuk callback dari Xendit
// ═══════════════════════════════════════════════════════════════

/**
 * Memproses webhook dari Xendit.
 * 
 * QRIS Webhook: status = 'SUCCEEDED' (bukan 'PAID')
 * Invoice Webhook: status = 'PAID'
 * 
 * Idempotent: jika status sudah sama, skip update.
 */
export async function processWebhook(
  body: any,
  opts?: {
    /** Fungsi untuk mengirim notifikasi WA ke customer setelah PAID */
    sendWaNotification?: (storeWaId: string, contactId: string, message: string) => Promise<void>;
  }
): Promise<{ received: boolean; status: string }> {
  // QRIS webhook menggunakan 'reference_id', Invoice menggunakan 'external_id'
  const externalId = body.external_id || body.reference_id;
  const status = body.status;

  if (!externalId || !status) {
    return { received: false, status: 'invalid_payload' };
  }

  // Normalize: Xendit QRIS pakai 'SUCCEEDED', unifikasi ke 'PAID' untuk konsistensi internal
  const normalizedStatus = status === 'SUCCEEDED' ? 'PAID' : status;

  console.log(`[Xendit] Webhook: ${externalId} → ${status} (normalized: ${normalizedStatus})`);

  try {
    // Cari di DB (coba external_id atau reference_id)
    let existing = await XenditTransaction.findOne({ where: { external_id: externalId } });
    if (!existing) {
      existing = await XenditTransaction.findOne({ where: { reference_id: externalId } } as any);
    }

    if (existing) {
      const currentStatus = existing.getDataValue('status');

      // ── Idempotency: skip jika status sudah sama ──────────────
      if (currentStatus === normalizedStatus) {
        console.log(`[Xendit] Webhook idempotent skip: ${externalId} sudah ${normalizedStatus}`);
        return { received: true, status: normalizedStatus };
      }

      const updates: Record<string, any> = {
        status: normalizedStatus,
        raw_response: JSON.stringify(body),
        updated_at: new Date(),
      };
      if (body.payment_method) updates.payment_method = String(body.payment_method);
      if (body.paid_at || body.updated) updates.paid_at = new Date(body.paid_at || body.updated);
      if (body.bank) updates.bank = body.bank;

      await XenditTransaction.update(updates, { where: { external_id: existing.getDataValue('external_id') } });
      console.log(`[Xendit] ✅ Transaction ${externalId} updated → ${normalizedStatus}`);

      // ── PAID: kirim notifikasi WA + Telegram ─────────────────
      if (normalizedStatus === 'PAID') {
        const amount = existing.getDataValue('amount');
        const description = existing.getDataValue('description') || externalId;
        const tipeBayar = existing.getDataValue('tipe_bayar') || 'LUNAS';
        const storeWaId = existing.getDataValue('store_wa_id');
        const contactId = existing.getDataValue('contact_id');
        const notifSent = existing.getDataValue('notif_sent');

        // Kirim notif WA ke customer (hanya sekali)
        if (!notifSent && storeWaId && contactId && opts?.sendWaNotification) {
          const waNotif = tipeBayar === 'DP'
            ? `Alhamdulillah, DP Rp ${Number(amount).toLocaleString('id-ID')} sudah kami terima bund! 🎉\n\nPesanan sudah kami catat. Sisa pembayaran dibayar ke kurir saat barang tiba ya bund 🙏\n\nEstimasi pengerjaan: 2-3 hari.\nNanti kurir akan menghubungi bunda 😊`
            : `Alhamdulillah, pembayaran Rp ${Number(amount).toLocaleString('id-ID')} sudah kami terima bund! 🎉\n\nEstimasi pengerjaan: 2-3 hari.\n📦 Pulau Jawa: 3-5 hari\n📦 Pulau Bali: 5-6 hari\n📦 Pulau Sumatra: 7-8 hari kerja\n📦 Kalimantan/Sulawesi: 8-9 hari kerja\nDitunggu ya bund, semoga produknya sesuai harapan 🙏`;

          try {
            await opts.sendWaNotification(storeWaId, contactId, waNotif);
            // Tandai notif sudah terkirim
            await XenditTransaction.update(
              { notif_sent: true } as any,
              { where: { external_id: existing.getDataValue('external_id') } }
            );
            console.log(`[Xendit] ✅ Notif WA terkirim ke ${contactId}`);
          } catch (waErr: any) {
            console.error(`[Xendit] Gagal kirim notif WA: ${waErr.message}`);
          }
        }

        // Telegram notif
        const telegramMsg = `💳 <b>Pembayaran QRIS Diterima!</b>\n\n📋 ${description}\n💰 Jumlah: <b>Rp ${Number(amount).toLocaleString('id-ID')}</b>\n🏷 Tipe: ${tipeBayar}\n📊 Status: ✅ PAID\n🆔 Ref: ${externalId}\n⏱ Waktu: ${new Date().toLocaleString('id-ID')}`;
        await sendTelegramMessage(telegramMsg).catch(() => {});

        // Emit Socket.IO update ke dashboard
        try {
          const { socketService } = require('./socket.service');
          socketService.emitDashboardUpdate();
        } catch (_) {}
      }

      // ── EXPIRED ───────────────────────────────────────────────
      if (normalizedStatus === 'EXPIRED') {
        const amount = existing.getDataValue('amount');
        const telegramMsg = `⏰ <b>QRIS Expired</b>\n\n📋 ${externalId}\n💰 Jumlah: <b>Rp ${Number(amount).toLocaleString('id-ID')}</b>\n📊 Status: ❌ EXPIRED\n⏱ Waktu: ${new Date().toLocaleString('id-ID')}\n\nCustomer belum bayar tepat waktu.`;
        await sendTelegramMessage(telegramMsg).catch(() => {});
      }
    } else {
      // Transaksi baru dari webhook (edge case)
      await XenditTransaction.create({
        external_id: externalId,
        reference_id: body.reference_id || null,
        amount: body.amount || 0,
        status: normalizedStatus,
        payment_method: body.payment_method || 'QRIS',
        source_type: body.qr_string ? 'qris' : 'invoice',
        paid_at: (normalizedStatus === 'PAID' && body.updated) ? new Date(body.updated) : null,
        raw_response: JSON.stringify(body),
      } as any);
      console.log(`[Xendit] New transaction created from webhook: ${externalId} → ${normalizedStatus}`);
    }

    return { received: true, status: normalizedStatus };
  } catch (err: any) {
    console.error('[Xendit] Webhook processing error:', err.message);
    return { received: false, status: 'error' };
  }
}

// ═══════════════════════════════════════════════════════════════
// LIST TRANSACTIONS
// ═══════════════════════════════════════════════════════════════

export async function listTransactions(limit: number = 50, offset: number = 0, status?: string) {
  const where: Record<string, any> = {};
  if (status && status !== 'ALL') where.status = status;

  const records = await XenditTransaction.findAndCountAll({
    where,
    order: [['created_at', 'DESC']],
    limit,
    offset,
  });

  return {
    transactions: records.rows.map(r => r.toJSON()),
    total: records.count,
  };
}

// ═══════════════════════════════════════════════════════════════
// TRANSACTION STATS
// ═══════════════════════════════════════════════════════════════

export async function getTransactionStats(days: number = 30) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { Op } = require('sequelize');
  const all = await XenditTransaction.findAll({
    where: { created_at: { [Op.gte]: since } },
    order: [['created_at', 'DESC']],
  });

  const total = all.length;
  const paid = all.filter(r => r.getDataValue('status') === 'PAID');
  const pending = all.filter(r => r.getDataValue('status') === 'PENDING');
  const expired = all.filter(r => r.getDataValue('status') === 'EXPIRED');
  const totalAmount = paid.reduce((sum, r) => sum + Number(r.getDataValue('amount') || 0), 0);

  const dailyMap: Record<string, { date: string; total: number; count: number; paid: number }> = {};
  for (const r of all) {
    const created = r.getDataValue('created_at');
    const dateStr = created ? new Date(created).toISOString().split('T')[0] : 'unknown';
    if (!dailyMap[dateStr]) dailyMap[dateStr] = { date: dateStr, total: 0, count: 0, paid: 0 };
    dailyMap[dateStr].count++;
    dailyMap[dateStr].total += Number(r.getDataValue('amount') || 0);
    if (r.getDataValue('status') === 'PAID') dailyMap[dateStr].paid++;
  }

  return {
    summary: {
      total_transactions: total,
      total_paid: paid.length,
      total_pending: pending.length,
      total_expired: expired.length,
      total_amount: totalAmount,
      success_rate: total > 0 ? Math.round((paid.length / total) * 100) : 0,
    },
    daily: Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// ═══════════════════════════════════════════════════════════════
// SYNC TRANSACTIONS (dari Xendit ke DB lokal)
// ═══════════════════════════════════════════════════════════════

export async function syncTransactions(): Promise<number> {
  const client = getClient();
  if (!client) return 0;

  let synced = 0;

  try {
    // Sync QRIS transactions
    try {
      const qrRes = await client.get('/qr_codes', {
        params: { limit: 100 },
        headers: { 'api-version': '2022-07-31' },
      });
      const qrItems = Array.isArray(qrRes.data) ? qrRes.data : [];

      for (const qr of qrItems) {
        const refId = qr.reference_id;
        if (!refId) continue;
        const existing = await XenditTransaction.findOne({ where: { external_id: refId } } as any)
          || await XenditTransaction.findOne({ where: { reference_id: refId } } as any);

        const normalizedStatus = qr.status === 'SUCCEEDED' ? 'PAID'
          : qr.status === 'INACTIVE' ? 'EXPIRED'
          : qr.status;

        if (existing) {
          if (existing.getDataValue('status') !== normalizedStatus) {
            await XenditTransaction.update(
              { status: normalizedStatus, updated_at: new Date(), raw_response: JSON.stringify(qr) },
              { where: { external_id: existing.getDataValue('external_id') } }
            );
            synced++;
          }
        }
      }
    } catch (qrErr: any) {
      console.warn('[Xendit] Sync QRIS gagal (mungkin fitur belum aktif):', qrErr.message);
    }

    // Sync Invoice transactions (lama)
    try {
      const invRes = await client.get('/v2/invoices', { params: { limit: 100, status: 'ALL' } });
      const invoices = Array.isArray(invRes.data) ? invRes.data : [];

      for (const inv of invoices) {
        const existing = await XenditTransaction.findOne({ where: { external_id: inv.external_id } });
        if (existing) {
          if (existing.getDataValue('status') !== inv.status) {
            await XenditTransaction.update(
              { status: inv.status, paid_at: inv.paid_at ? new Date(inv.paid_at) : null, updated_at: new Date(), raw_response: JSON.stringify(inv) },
              { where: { external_id: inv.external_id } }
            );
            synced++;
          }
        } else {
          await XenditTransaction.create({
            external_id: inv.external_id,
            invoice_url: inv.invoice_url || null,
            amount: inv.amount || 0,
            status: inv.status,
            payment_method: inv.payment_method || null,
            payer_email: inv.payer_email || null,
            description: inv.description || null,
            source_type: 'invoice',
            paid_at: inv.paid_at ? new Date(inv.paid_at) : null,
            expiry_date: inv.expiry_date ? new Date(inv.expiry_date) : null,
            raw_response: JSON.stringify(inv),
          } as any);
          synced++;
        }
      }
    } catch (invErr: any) {
      console.warn('[Xendit] Sync Invoice gagal:', invErr.message);
    }

    console.log(`[Xendit] Sync completed: ${synced} transactions updated/created`);
    return synced;
  } catch (err: any) {
    console.error('[Xendit] Sync error:', err.message);
    return 0;
  }
}

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

export async function getXenditConfig() {
  const enabled = await getConfig('xendit_enabled', 'true');
  const interval = await getConfig('xendit_sync_interval_min', '60');
  const webhookUrl = await getConfig('xendit_webhook_url', '');
  const telegramEnabled = await getConfig('xendit_telegram_enabled', 'true');

  return {
    enabled: enabled === 'true',
    interval_min: parseInt(interval) || 60,
    has_api_key: !!getApiKey(),
    is_development: getApiKey().startsWith('xnd_development'),
    webhook_verification_token: getWebhookSecret() ? '••••' + getWebhookSecret().slice(-4) : '',
    webhook_url: webhookUrl,
    telegram_enabled: telegramEnabled === 'true',
  };
}

export async function updateXenditConfig(data: Record<string, string>) {
  const validKeys = [
    'xendit_enabled',
    'xendit_sync_interval_min',
    'xendit_webhook_url',
    'xendit_telegram_enabled',
  ];
  for (const [key, value] of Object.entries(data)) {
    if (validKeys.includes(key)) await setConfig(key, String(value));
  }
  if ('xendit_sync_interval_min' in data) restartScheduler();
  return getXenditConfig();
}

// ═══════════════════════════════════════════════════════════════
// SCHEDULER
// ═══════════════════════════════════════════════════════════════

export async function startScheduler() {
  const enabled = await getConfig('xendit_enabled', 'true');
  if (enabled !== 'true') { console.log('[Xendit] Scheduler disabled.'); return; }
  const apiKey = getApiKey();
  if (!apiKey) { console.log('[Xendit] No API key — scheduler skipped.'); return; }

  const intervalMinStr = await getConfig('xendit_sync_interval_min', '60');
  const intervalMs = (parseInt(intervalMinStr) || 60) * 60 * 1000;

  console.log('[Xendit] Initial sync on startup...');
  await syncTransactions();

  if (xenditInterval) clearInterval(xenditInterval);
  xenditInterval = setInterval(async () => {
    console.log('[Xendit] Scheduled sync...');
    await syncTransactions();
  }, intervalMs);

  console.log(`[Xendit] Scheduler started (interval: ${intervalMinStr} menit).`);
}

export function stopScheduler() {
  if (xenditInterval) { clearInterval(xenditInterval); xenditInterval = null; }
  console.log('[Xendit] Scheduler stopped.');
}

export function restartScheduler() {
  stopScheduler();
  startScheduler();
}
