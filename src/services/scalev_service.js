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

/**
 * Variant ID produk "Order CRM AI" (harga Rp 1) di Scalev.
 * Dipakai sebagai carrier harga dinamis:
 *   quantity = nominal_tagihan → gross_revenue = qty x Rp1 = nominal_tagihan
 * Wajib diisi di .env sebagai SCALEV_CUSTOM_VARIANT_ID.
 */
function getCustomVariantId() {
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
function firstString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
}

function firstActionUrl(...actionGroups) {
    for (const actions of actionGroups) {
        if (!Array.isArray(actions)) continue;
        const selected = actions.find(action =>
            ['AUTH', 'CREATE', 'PAY', 'CHECKOUT', 'OPEN'].includes(String(action?.action || action?.type || '').toUpperCase())
        ) || actions[0];
        const url = firstString(selected?.url, selected?.href, selected?.link);
        if (url) return url;
    }
    return null;
}

function extractQrString(data) {
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

function extractPaymentUrl(data) {
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

function extractPublicOrderUrl(data) {
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
 *
 * DYNAMIC PRICING STRATEGY:
 * Scalev tidak mendukung harga bebas/custom per order (gross_revenue harus berasal
 * dari harga varian produk yang sudah terdaftar di database Scalev).
 *
 * Solusi: Gunakan produk "Order CRM AI" (harga Rp 1, is_editable=true) dengan
 * quantity = nominal_tagihan (dalam rupiah). Sehingga:
 *   qty 50000 x Rp1 = Rp 50.000 gross_revenue yang tepat.
 *
 * Rincian produk asli (nama, varian, jumlah) dimasukkan ke field `notes`
 * agar tetap terbaca di dashboard Scalev.
 *
 * @param {Object} params
 * @param {number} [params.amount]     - Nominal tagihan (Rp). Jika ada, override ordervariants.
 * @param {string} [params.notes]      - Catatan order (akan digabung dengan rincian produk).
 * @param {Array}  [params.ordervariants] - Rincian produk asli (untuk notes saja, tidak dikirim ke Scalev).
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
        };

        if (params.customer_phone) payload.customer_phone = params.customer_phone;
        if (params.address) payload.address = params.address;
        if (params.metadata) payload.metadata = params.metadata;
        if (params.agent_context) payload.agent_context = params.agent_context;

        // ── DYNAMIC PRICING VIA "Order CRM AI" VARIANT (Rp 1) ──────────────────
        // Scalev hanya menerima harga dari produk yang sudah terdaftar.
        // Kita gunakan variant_Y4Cwyl66kZqnIrMHvD48uJOh (Order CRM AI, Rp1)
        // dengan quantity = nominal tagihan sehingga gross_revenue = nominal yang tepat.
        const customVariantId = getCustomVariantId();
        const amount = params.amount ? Math.round(Number(params.amount)) : 0;

        if (customVariantId && amount > 0) {
            // Pakai custom variant dengan quantity = amount (dalam rupiah)
            payload.ordervariants = [{
                variant_unique_id: customVariantId,
                quantity: amount, // qty 50000 x Rp1 = Rp 50.000
            }];

            // Rincian produk asli masuk ke notes agar kelihatan di dashboard
            const detailLines = [];
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

        } else if (customVariantId && params.shipping_cost && !amount) {
            // Hanya ada ongkir tanpa amount: pakai ongkir sebagai qty fallback
            console.warn('[Scalev] amount tidak ada, menggunakan shipping_cost sebagai fallback qty');
            payload.ordervariants = [{
                variant_unique_id: customVariantId,
                quantity: Math.round(Number(params.shipping_cost)),
            }];
            if (params.notes) payload.notes = params.notes;

        } else if (!customVariantId) {
            // Tidak ada SCALEV_CUSTOM_VARIANT_ID — fallback ke ordervariants lama (akan error gross_revenue=0)
            console.warn('[Scalev] ⚠️  SCALEV_CUSTOM_VARIANT_ID tidak dikonfigurasi! Order mungkin gagal karena gross_revenue=0.');
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

        console.log(`[Scalev] ✅ Order created: ${order.order_id || order.id} | customer: ${params.customer_name} | Rp ${amount}`);

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
 * 
 * Scalev menggunakan Xendit sebagai payment gateway.
 * Struktur response payment endpoint (POST /v3/orders/:id/payment):
 *   - payment_method.type: "QR_CODE"
 *   - payment_method.qr_code.qr_string: isi QR code yang bisa di-render
 *   - actions: array link aksi (checkout url)
 * 
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

        let qrisImageBuffer;
        if (qrString) {
            const buf = await renderQrisImage(qrString);
            if (buf) qrisImageBuffer = buf;
        }

        console.log(`[Scalev] ✅ Payment created for order ${orderId}: method=${paymentMethodStr}, qris=${!!qrString}, image=${!!qrisImageBuffer}`);

        return {
            success: true,
            public_order_url: publicOrderUrl,
            payment_url: paymentUrl,
            qr_string: qrString,
            qrisImageBuffer,
            payment_method: paymentMethodStr,
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
        const errMsg = typeof paymentResult.error === 'object'
            ? JSON.stringify(paymentResult.error)
            : (paymentResult.error || 'Unknown payment error');
        console.warn(`[Scalev] Order ${orderId} berhasil tapi payment gagal: ${errMsg}`);
        return {
            success: true,
            order_id: orderId,
            payment_method: params.payment_method,
            error: `Payment gagal: ${errMsg}. Order ID: ${orderId}`,
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
    getCustomVariantId,
    renderQrisImage,
    createOrder,
    createPaymentForOrder,
    createOrderAndPay,
    checkPaymentStatus,
    processWebhook,
};
