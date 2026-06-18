/**
 * @file scalev_service.js  (LEGACY — CommonJS)
 * @description Scalev Order+Payment Service untuk ai_service.js legacy.
 * 
 * Versi ini adalah port dari v2-core/backend/src/services/scalev.service.ts
 * yang ditulis ulang dalam CommonJS agar kompatibel dengan legacy stack.
 * 
 * Docs: https://docs.scalev.com
 * Base URL: https://api.scalev.com
 */

const axios = require('axios');
const QRCode = require('qrcode');

// ═══════════════════════════════════════════════════════════════
// CONFIG HELPERS
// ═══════════════════════════════════════════════════════════════

function getApiKey() {
    return process.env.SCALEV_API_KEY || '';
}

function hasApiKey() {
    return !!getApiKey();
}

function getStoreUniqueId() {
    return process.env.SCALEV_STORE_UNIQUE_ID || '';
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
async function renderQrisImage(qrString) {
    if (!qrString) return null;
    try {
        const buffer = await QRCode.toBuffer(qrString, {
            errorCorrectionLevel: 'M',
            type: 'png',
            width: 400,
            margin: 2,
            color: { dark: '#000000', light: '#FFFFFF' },
        });
        return buffer;
    } catch (err) {
        console.error('[Scalev] Gagal render QRIS image:', err.message);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════
// CREATE ORDER
// ═══════════════════════════════════════════════════════════════

/**
 * Membuat order baru di Scalev via POST /v3/orders.
 * @param {Object} params
 * @returns {Promise<{success: boolean, order_id?: string, error?: string, raw?: any}>}
 */
async function createOrder(params) {
    const client = getClient();
    if (!client) {
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
        const payload = {
            store_unique_id: storeUniqueId,
            customer_name: params.customer_name,
            payment_method: params.payment_method || 'qris',
            shipment_provider_code: 'mengantar', // Mengantar terintegrasi native di Scalev
        };

        if (params.customer_phone) payload.customer_phone = params.customer_phone;
        if (params.address) payload.address = params.address;
        if (params.shipping_cost != null) payload.shipping_cost = params.shipping_cost;
        if (params.ordervariants && params.ordervariants.length > 0) payload.ordervariants = params.ordervariants;
        if (params.notes) payload.notes = params.notes;
        if (params.product_discount != null) payload.product_discount = params.product_discount;
        if (params.shipping_discount != null) payload.shipping_discount = params.shipping_discount;
        if (params.metadata) payload.metadata = params.metadata;
        if (params.agent_context) payload.agent_context = params.agent_context;

        const res = await client.post('/v3/orders', payload);
        const order = res.data;

        console.log(`[Scalev] ✅ Order created: ${order.order_id || order.id} customer: ${params.customer_name}`);

        return {
            success: true,
            order_id: order.order_id || String(order.id),
            unique_key: order.unique_key,
            payment_method: order.payment_method,
            raw: order,
        };
    } catch (err) {
        console.error('[Scalev] Gagal create order:', err.message);
        if (err.response) {
            console.error('[Scalev] Response:', JSON.stringify(err.response.data));
        }
        return {
            success: false,
            error: err.response?.data?.message || err.response?.data?.error || err.message,
        };
    }
}

// ═══════════════════════════════════════════════════════════════
// CREATE PAYMENT
// ═══════════════════════════════════════════════════════════════

/**
 * Membuat payment request untuk order yang sudah ada.
 * @param {string} orderId
 * @returns {Promise<{success: boolean, qrisImageBuffer?: Buffer, public_order_url?: string, payment_url?: string, qr_string?: string, payment_method?: string, error?: string}>}
 */
async function createPaymentForOrder(orderId) {
    const client = getClient();
    if (!client) {
        return { success: false, error: 'SCALEV_API_KEY belum dikonfigurasi' };
    }

    try {
        const res = await client.post(`/v3/orders/${orderId}/payment`);
        const data = res.data;

        const publicOrderUrl = data.public_order_url || null;
        const paymentUrl = data.payment_url || null;
        const paymentMethod = data.payment_method || 'unknown';
        const pgInfo = data.pg_payment_info || {};
        const qrString = pgInfo.qr_string || null;

        let qrisImageBuffer;
        if (qrString) {
            const buf = await renderQrisImage(qrString);
            if (buf) qrisImageBuffer = buf;
        }

        console.log(`[Scalev] ✅ Payment created for order ${orderId}: method=${paymentMethod}, qris=${!!qrString}`);

        return {
            success: true,
            public_order_url: publicOrderUrl,
            payment_url: paymentUrl,
            qr_string: qrString,
            qrisImageBuffer,
            payment_method: paymentMethod,
            raw: data,
        };
    } catch (err) {
        console.error('[Scalev] Gagal create payment:', err.message);
        if (err.response) {
            console.error('[Scalev] Response:', JSON.stringify(err.response.data));
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
 * Membuat order DAN payment sekaligus.
 * Ini adalah fungsi utama yang dipanggil dari AI tool `buat_order_scalev`.
 */
async function createOrderAndPay(params) {
    const orderResult = await createOrder(params);
    if (!orderResult.success || !orderResult.order_id) {
        return {
            success: false,
            error: `Gagal buat order: ${orderResult.error}`,
        };
    }

    const orderId = orderResult.order_id;
    const paymentResult = await createPaymentForOrder(orderId);

    if (!paymentResult.success) {
        console.warn(`[Scalev] Order ${orderId} berhasil tapi payment gagal: ${paymentResult.error}`);
        return {
            success: true,
            order_id: orderId,
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
    };
}

// ═══════════════════════════════════════════════════════════════
// CHECK PAYMENT STATUS
// ═══════════════════════════════════════════════════════════════

async function checkPaymentStatus(orderId) {
    const client = getClient();
    if (!client) return null;
    try {
        const res = await client.get(`/v3/orders/${orderId}/payment-status`);
        const data = res.data;
        return {
            paid: data.is_paid === true || data.payment_status === 'paid',
            status: data.payment_status || 'unknown',
        };
    } catch (err) {
        console.error(`[Scalev] Gagal check payment status ${orderId}:`, err.message);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════
// PROCESS WEBHOOK
// ═══════════════════════════════════════════════════════════════

/**
 * Memproses webhook dari Scalev saat order LUNAS.
 * 
 * MULTI-WA LOGIC:
 * 1. Coba baca store_wa_id dari metadata order (disimpan bot saat buat order)
 * 2. Fallback ke opts.defaultStoreWaId (env SCALEV_DEFAULT_STORE_WA_ID)
 * 3. Fallback ke semua WA client aktif (broadcast ke semua toko)
 */
async function processWebhook(body, opts) {
    try {
        const event = body.event || body.type || '';
        const orderData = body.order || body.data || body;
        const orderId = orderData.order_id || orderData.id || body.order_id || '';
        const status = orderData.payment_status || orderData.status || body.status || '';

        console.log(`[Scalev] Webhook received: event=${event} order=${orderId} status=${status}`);

        if (!orderId) {
            return { received: false, status: 'invalid_payload' };
        }

        const isPaid = status === 'paid' || status === 'completed' ||
                       event === 'order.paid' || event === 'order.completed' ||
                       (body.payment_status === 'paid');

        if (isPaid) {
            const customerPhone = orderData.customer?.phone || orderData.customer_phone || '';
            const customerName = orderData.customer?.name || orderData.customer_name || '';
            const totalAmount = orderData.total_price || orderData.grand_total || orderData.amount || 0;

            // ── MULTI-WA: Baca store_wa_id dari metadata order ─────────────
            // Bot menyimpan store_wa_id di metadata saat membuat order,
            // sehingga kita tahu toko mana yang handle order ini.
            const orderMetadata = orderData.metadata || orderData.meta || {};
            const metadataStoreWaId = orderMetadata.store_wa_id || '';
            
            // Priority: metadata order > default env > kosong
            const storeWaId = metadataStoreWaId || (opts && opts.defaultStoreWaId) || '';

            console.log(`[Scalev] ✅ ORDER PAID: ${orderId} | customer: ${customerName} (${customerPhone}) | Rp ${totalAmount} | store_wa: ${storeWaId || 'unknown'}`);

            // Kirim notif WA ke customer
            if (customerPhone && opts && opts.sendWaNotification) {
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
                    console.log(`[Scalev] ✅ Notif WA terkirim ke ${customerPhone} via store ${storeWaId}`);
                } catch (waErr) {
                    console.error(`[Scalev] Gagal kirim notif WA: ${waErr.message}`);
                }
            }
        }

        return { received: true, status };
    } catch (err) {
        console.error('[Scalev] Webhook processing error:', err.message);
        return { received: false, status: 'error' };
    }
}

module.exports = {
    getApiKey,
    hasApiKey,
    getStoreUniqueId,
    renderQrisImage,
    createOrder,
    createPaymentForOrder,
    createOrderAndPay,
    checkPaymentStatus,
    processWebhook,
};
