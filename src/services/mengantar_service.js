/**
 * @file mengantar_service.js
 * @description Mengantar Shipping Service — Authenticated API Integration
 *
 * FITUR:
 * - Cek ongkir via Public API (tanpa auth) → untuk bot WA
 * - Create Order/Resi via Authenticated API → untuk setelah customer bayar
 * - Get Addresses → daftar alamat pickup terdaftar
 * - Caching 7 hari untuk data lookup (address ID, destination ID)
 *
 * ENV YANG DIPERLUKAN:
 *   MENGANTAR_API_KEY      = API-NSC3GCR0XJLHRN42
 *   MENGANTAR_ADDRESS_ID   = ID alamat pickup default (686df175e63455b7eca24f22)
 *   MENGANTAR_COURIER      = Kurir default: JT (default), JNE, Sap, SiCepat, Ninja, iDexpress, lion
 */

'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

// ── Konfigurasi ──────────────────────────────────────────────────────────────
const BASE_URL = 'https://app.mengantar.com';
const PUBLIC_BASE_URL = 'https://app.mengantar.com';

const getApiKey = () => process.env.MENGANTAR_API_KEY || '';
const getDefaultAddressId = () => process.env.MENGANTAR_ADDRESS_ID || '686df175e63455b7eca24f22'; // Percetakan Jaya Sukses, Kediri
const getDefaultCourier = () => process.env.MENGANTAR_COURIER || 'JT';

// Origin ID tetap dari Kediri (Pare) — dipakai saat tidak ada API key
const KEDIRI_PARE_ORIGIN_ID = '5fc633fef8f44b34aa4c4f47';
// Origin ID Kediri Kota — dipakai untuk alamat default Percetakan Jaya Sukses
const KEDIRI_KOTA_ORIGIN_ID = '5fc63405f8f44b34aa4c4f9a';

// ── Cache ─────────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari
const CACHE_FILE = path.join(config.DATA_DIR || process.cwd(), 'mengantar_cache.json');

function _loadCache() {
    try {
        if (!fs.existsSync(CACHE_FILE)) return {};
        return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch (_) { return {}; }
}

function _persistCache(cache) {
    try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2)); } catch (_) {}
}

function _setCache(key, value) {
    const cache = _loadCache();
    cache[key] = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    _persistCache(cache);
}

function _getCache(key) {
    const cache = _loadCache();
    const entry = cache[key];
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        delete cache[key];
        _persistCache(cache);
        return null;
    }
    return entry.value;
}

// ── HTTP Client ───────────────────────────────────────────────────────────────
function _getAuthClient() {
    const apiKey = getApiKey();
    if (!apiKey) return null;
    return axios.create({
        baseURL: `${BASE_URL}/api/public/${apiKey}`,
        timeout: 20000,
        headers: { 'Content-Type': 'application/json' },
    });
}

// ── Address Search ─────────────────────────────────────────────────────────────
/**
 * Cari destination ID berdasarkan keyword.
 * Endpoint: GET /api/public/{API_KEY}/address/search?keyword=...
 * CATATAN: Menurut docs, API_KEY di endpoint ini tidak divalidasi (legacy).
 */
async function searchAddress(keyword) {
    const cacheKey = `addr_search_${keyword.toLowerCase().trim()}`;
    const cached = _getCache(cacheKey);
    if (cached) return cached;

    try {
        const url = `${BASE_URL}/api/public/legacy/address/search?keyword=${encodeURIComponent(keyword)}`;
        const res = await axios.get(url, { timeout: 10000 });
        const results = res.data?.data || [];
        if (results.length === 0) return null;

        const first = results[0];
        const result = {
            id: first._id,
            label: `${first.SUBDISTRICT_NAME}, ${first.CITY_NAME}`,
            province: first.PROVINCE_NAME,
            city: first.CITY_NAME,
            district: first.DISTRICT_NAME,
            subdistrict: first.SUBDISTRICT_NAME,
            zip: first.ZIP_CODE,
            destination_code: first.DESTINATION_CODE,
        };
        _setCache(cacheKey, result);
        return result;
    } catch (err) {
        logger.error(`[Mengantar] searchAddress error [${keyword}]: ${err.message}`);
        return null;
    }
}

// ── Get User's Pickup Addresses ───────────────────────────────────────────────
/**
 * Dapatkan daftar alamat pickup yang terdaftar di akun Mengantar.
 */
async function getAddresses() {
    const client = _getAuthClient();
    if (!client) return [];

    const cacheKey = 'mengantar_addresses';
    const cached = _getCache(cacheKey);
    if (cached) return cached;

    try {
        const res = await client.get('/address');
        const addresses = res.data?.data || [];
        _setCache(cacheKey, addresses);
        return addresses;
    } catch (err) {
        logger.error(`[Mengantar] getAddresses error: ${err.message}`);
        return [];
    }
}

// ── Get Available Pickup Times ─────────────────────────────────────────────────
/**
 * Dapatkan waktu pickup yang tersedia.
 * @param {string} addressId - ID alamat pickup
 */
async function getAvailableTimes(addressId) {
    const client = _getAuthClient();
    if (!client) return [];

    const addrId = addressId || getDefaultAddressId();
    const cacheKey = `mengantar_times_${addrId}_${new Date().toDateString()}`;
    const cached = _getCache(cacheKey);
    if (cached) return cached;

    try {
        const res = await client.get('/time', { params: { address: addrId } });
        const times = res.data?.data || [];
        // Cache 1 jam saja (times change daily)
        const cache = _loadCache();
        cache[cacheKey] = { value: times, expiresAt: Date.now() + 60 * 60 * 1000 };
        _persistCache(cache);
        return times;
    } catch (err) {
        logger.error(`[Mengantar] getAvailableTimes error: ${err.message}`);
        return [];
    }
}

// ── Check Shipping Fee (Authenticated - lebih akurat, pakai volume user) ──────
/**
 * Cek ongkir via API autentikasi (berdasarkan diskon volume user).
 * @param {string} originId - _id dari address search
 * @param {string} destinationId - _id dari address search
 * @param {number} weight - Berat dalam kg
 * @param {string} courier - Nama kurir (default: JT)
 */
async function checkShippingFeeAuth(originId, destinationId, weight = 1, courier = null) {
    const client = _getAuthClient();
    if (!client) return null;

    const courierName = courier || getDefaultCourier();
    const cacheKey = `mengantar_fee_${originId}_${destinationId}_${weight}_${courierName}`;
    const cached = _getCache(cacheKey);
    if (cached) return cached;

    try {
        const res = await client.get('/order/estimate', {
            params: {
                origin_id: originId,
                destination_id: destinationId,
                courier: courierName === 'all' ? 'all' : courierName,
                weight,
                COD_AMOUNT: 1,
            }
        });
        const data = res.data?.data;
        if (data) _setCache(cacheKey, data);
        return data;
    } catch (err) {
        logger.error(`[Mengantar] checkShippingFeeAuth error: ${err.message}`);
        return null;
    }
}

// ── Check Shipping Fee (Public - untuk bot tanpa auth context) ────────────────
async function checkShippingFeePublic(originId, destinationId, weight = 1) {
    const cacheKey = `mengantar_public_fee_${originId}_${destinationId}_${weight}`;
    const cached = _getCache(cacheKey);
    if (cached) return cached;

    try {
        const url = `${PUBLIC_BASE_URL}/api/order/allEstimatePublic`;
        const res = await axios.get(url, {
            params: { origin_id: originId, destination_id: destinationId, weight, COD_AMOUNT: 1 },
            timeout: 10000,
        });
        const data = res.data?.data;
        if (data) _setCache(cacheKey, data);
        return data;
    } catch (err) {
        logger.error(`[Mengantar] checkShippingFeePublic error: ${err.message}`);
        return null;
    }
}

// ── Helper: ETD by Province ───────────────────────────────────────────────────
function _getEtdByProvince(province = '') {
    const p = province.toUpperCase();
    if (p.includes('JAWA') || p.includes('DKI') || p.includes('BANTEN') || p.includes('YOGYAKARTA')) return '3-4 hari kerja';
    if (p.includes('BALI')) return '4-5 hari kerja';
    if (p.includes('SULAWESI') || p.includes('KALIMANTAN')) return '5-7 hari kerja';
    if (p.includes('PAPUA') || p.includes('MALUKU') || p.includes('NUSA TENGGARA')) return '7-10 hari kerja';
    return '4-6 hari kerja';
}

function _isUnsupported(d) {
    if (!d) return true;
    if (d.unsupported === true) return true;
    if ((d.estimatedPrice || d.estimatedSpecialPrice || 0) === 0) return true;
    return false;
}

// ── Cek Ongkir untuk Bot WA ───────────────────────────────────────────────────
/**
 * Fungsi utama yang dipanggil oleh tool cek_ongkir di ai_service.
 * Strategi fallback: JT → JNE → Shopee
 */
async function getShippingCost(destinationCity, weightGrams = 1000) {
    try {
        const cleanDest = destinationCity.toLowerCase()
            .replace(/kota\s+/g, '').replace(/kabupaten\s+/g, '').replace(/kecamatan\s+/g, '').trim();

        const destData = await searchAddress(cleanDest);
        if (!destData) {
            return `Aduh bund, wilayah "${destinationCity}" tidak terdeteksi di sistem pengiriman kami 🙏 Bisa sebutkan nama Kecamatan atau Kota/Kabupaten yang lebih spesifik? 😊`;
        }

        const weight = Math.max(1, Math.ceil(weightGrams / 1000));
        // Pakai Public API untuk cek ongkir (tidak perlu auth untuk info harga)
        const originId = KEDIRI_KOTA_ORIGIN_ID;
        const pricingData = await checkShippingFeePublic(originId, destData.id, weight);

        if (!pricingData || Object.keys(pricingData).length === 0) {
            return `Wah, maaf bund. Saat ini belum ada layanan pengiriman ke ${destData.label} dari Kediri 🙏`;
        }

        // Fallback order: JT → JNE → Shopee
        const MARKUP = 3000; // Rp 3.000 handling fee
        for (const courierKey of ['JT', 'JNE']) {
            const data = pricingData[courierKey];
            if (_isUnsupported(data)) continue;

            const basePrice = data.estimatedSpecialPrice || data.estimatedPrice || data.price || 0;
            const finalPrice = basePrice + MARKUP;
            let etd = data.estimatedDate || data.estimate_delivery || '';
            if (!etd || etd === '-') etd = _getEtdByProvince(destData.province);

            logger.bot(`[Ongkir] ${courierKey} → ${destData.label}: Rp ${finalPrice.toLocaleString('id-ID')} (${etd})`);

            let reply = `Hore! Ini hasil cek ongkir dari Kediri ke ${destData.label} (${weight}kg):\n\n`;
            reply += `✅ Pengiriman Reguler\n`;
            reply += `   Harga: Rp ${finalPrice.toLocaleString('id-ID')}\n`;
            reply += `   Estimasi: ${etd}\n\n`;
            reply += `Bisa dibantu konfirmasi untuk lanjut pesanannya bund? 😊`;
            return reply;
        }

        // Semua kurir tidak tersedia → arahkan ke Shopee
        const shopeeLink = process.env.SHOPEE_LINK || config.SHOPEE_LINK || '';
        logger.bot(`[Ongkir] Semua kurir tidak menjangkau ${destData.label}, arahkan ke Shopee.`);
        if (shopeeLink) {
            return `Aduh bund, maaf ya 🙏 Layanan pengiriman dari Kediri ke ${destData.label} belum tersedia saat ini.\n\nTapi tenang bund, bisa pesan langsung lewat toko Shopee kami ya 😊\n👉 ${shopeeLink}\n\nDi Shopee biasanya lebih mudah dan ada promo ongkir juga lho bund 🥰`;
        }
        return `Aduh bund, maaf ya 🙏 Layanan pengiriman ke ${destData.label} belum tersedia saat ini. Bisa hubungi kami lebih lanjut ya bund 😊`;
    } catch (err) {
        logger.error(`[Mengantar] getShippingCost error: ${err.message}`);
        return 'Aduh maaf bund, server pengiriman kami sedang istirahat sejenak. Nanti kami bantu cekkan manual ya kalau alamatnya sudah lengkap! 🙏';
    }
}

// ── CREATE ORDER (Resi) via Authenticated API ─────────────────────────────────
/**
 * Membuat order/resi pengiriman di Mengantar.
 *
 * @param {Object} params
 * @param {string} params.customerName       - Nama penerima
 * @param {string} params.customerPhone      - No HP penerima (tanpa leading 0 atau 62)
 * @param {string} params.customerAddress    - Alamat lengkap penerima
 * @param {string} params.destinationKeyword - Kecamatan/Kota tujuan untuk lookup ID
 * @param {string} [params.destinationId]    - (Opsional) Langsung pakai ID jika sudah diketahui
 * @param {number} params.weight             - Berat dalam kg (default 1)
 * @param {number} params.quantity           - Jumlah item (default 1)
 * @param {string} params.parcelContent      - Isi paket / nama produk
 * @param {number} [params.goodsValue]       - Nilai barang (NON-COD)
 * @param {number} [params.codAmount]        - Nominal COD (jika COD)
 * @param {string} [params.courier]          - Kurir (default: JT)
 * @param {string} [params.addressId]        - ID alamat pickup (default: env MENGANTAR_ADDRESS_ID)
 * @param {Array}  [params.customProducts]   - Detail produk (opsional)
 * @param {string} [params.pickupType]       - 'scheduledPickup' atau 'dropOff' (default: dropOff)
 * @param {string} [params.deliveryInstruction] - Instruksi pengiriman (opsional)
 *
 * @returns {Promise<{success: boolean, cnote_no?: string, order_id?: string, batch?: string, error?: string}>}
 */
async function createOrder(params) {
    const client = _getAuthClient();
    if (!client) {
        return { success: false, error: 'MENGANTAR_API_KEY belum dikonfigurasi di .env' };
    }

    const {
        customerName,
        customerPhone,
        customerAddress,
        destinationKeyword,
        destinationId,
        weight = 1,
        quantity = 1,
        parcelContent,
        goodsValue,
        codAmount,
        courier,
        addressId,
        customProducts,
        pickupType = 'dropOff',
        deliveryInstruction,
    } = params;

    // Validasi wajib
    if (!customerName) return { success: false, error: 'customerName wajib diisi' };
    if (!customerAddress) return { success: false, error: 'customerAddress wajib diisi' };
    if (!parcelContent) return { success: false, error: 'parcelContent (nama produk) wajib diisi' };
    if (!destinationKeyword && !destinationId) return { success: false, error: 'destinationKeyword atau destinationId wajib diisi' };

    try {
        // 1. Dapatkan destination ID
        let destId = destinationId;
        let destLabel = '';
        if (!destId && destinationKeyword) {
            const destData = await searchAddress(destinationKeyword);
            if (!destData) {
                return { success: false, error: `Wilayah "${destinationKeyword}" tidak ditemukan. Coba masukkan nama Kecamatan/Kota yang lebih spesifik.` };
            }
            destId = destData.id;
            destLabel = destData.label;
        }

        // 2. Pilih kurir & alamat pickup
        const courierName = courier || getDefaultCourier();
        const pickupAddressId = addressId || getDefaultAddressId();

        // 3. Setup pickup
        let pickup;
        if (pickupType === 'scheduledPickup') {
            // Ambil time slot pertama yang tersedia hari ini
            const times = await getAvailableTimes(pickupAddressId);
            const today = new Date();
            const todayStr = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}-${today.getFullYear()}`;
            const tomorrow = new Date(today);
            tomorrow.setDate(today.getDate() + 1);
            const tomorrowStr = `${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}-${tomorrow.getFullYear()}`;
            
            const futureTime = times.find(t => {
                const timeDate = new Date(t.date);
                return timeDate > new Date();
            });
            
            if (futureTime) {
                pickup = {
                    type: 'scheduledPickup',
                    volume: 'volumeMotor',
                    address_id: pickupAddressId,
                    time_id: futureTime._id,
                };
            } else {
                // Fallback ke dropOff jika tidak ada slot pickup
                pickup = { type: 'dropOff', address_id: pickupAddressId };
                logger.warn('[Mengantar] Tidak ada slot pickup tersedia, fallback ke dropOff');
            }
        } else {
            pickup = { type: 'dropOff', address_id: pickupAddressId };
        }

        // 4. Build order payload
        const orderItem = {
            customerAddressDataId: destId,
            customerAddress: customerAddress,
            customerName: customerName,
            customerPhone: String(customerPhone || '').replace(/^(0|62|\+62)/, ''),
            parcelContent: parcelContent,
            weight: Math.max(1, Number(weight) || 1),
            quantity: Math.max(1, Number(quantity) || 1),
        };

        // Value (NON-COD atau COD)
        if (codAmount && Number(codAmount) > 0) {
            orderItem.COD = Math.round(Number(codAmount));
        } else if (goodsValue && Number(goodsValue) > 0) {
            orderItem.goodsValue = Math.round(Number(goodsValue));
        }

        if (deliveryInstruction) orderItem.deliveryInstruction = deliveryInstruction;

        // Custom products (rincian produk)
        if (customProducts && customProducts.length > 0) {
            orderItem.customProducts = customProducts.map(p => ({
                name: p.name || parcelContent,
                variant: p.variant || '',
                qty: Math.max(1, Number(p.qty || p.quantity || 1)),
                price: Math.round(Number(p.price || p.harga || 0)),
                weight: Number(p.weight || 1),
            }));
        }

        const payload = {
            courier: courierName,
            pickup,
            orders: [orderItem],
        };

        logger.info(`[Mengantar] Membuat order: ${customerName} → ${destLabel || destId} via ${courierName}`);

        const res = await client.post('/order', payload);
        const data = res.data;

        if (!data.success) {
            return { success: false, error: data.message || 'Gagal membuat order di Mengantar' };
        }

        const orders = data.data || [];
        const firstOrder = orders[0];
        const cnoteNo = firstOrder?.cnote_no || '';
        const orderId = firstOrder?.ORDER_ID || firstOrder?._id || '';
        const batch = data.batch || '';
        const batchId = data.batch_id || '';
        const isPaid = firstOrder?.isPaid !== false;
        const isUnpaid = firstOrder?.isPaid === false;

        if (isUnpaid) {
            logger.warn(`[Mengantar] Order dibuat tapi belum terbayar (saldo tidak cukup). Batch: ${batch}`);
        }

        logger.info(`[Mengantar] ✅ Order berhasil: cnote=${cnoteNo} order_id=${orderId} batch=${batch} paid=${isPaid}`);

        return {
            success: true,
            cnote_no: cnoteNo,
            order_id: orderId,
            batch,
            batch_id: batchId,
            courier: courierName,
            customer: customerName,
            destination: destLabel,
            is_paid: isPaid,
            is_unpaid: isUnpaid,
            raw: data,
        };
    } catch (err) {
        const errMsg = err.response?.data?.message || err.response?.data?.error || err.message;
        logger.error(`[Mengantar] createOrder error: ${errMsg}`);
        if (err.response?.data) {
            logger.error(`[Mengantar] Response: ${JSON.stringify(err.response.data)}`);
        }
        return { success: false, error: errMsg };
    }
}

// ── Get Orders ────────────────────────────────────────────────────────────────
/**
 * Ambil daftar order dari Mengantar.
 * @param {Object} filters - { page, size, courier, dateRange, tracking_id, order_id, category }
 */
async function getOrders(filters = {}) {
    const client = _getAuthClient();
    if (!client) return { success: false, data: [], error: 'API key not configured' };

    try {
        const params = {
            page: filters.page || 1,
            size: filters.size || 20,
        };
        if (filters.courier) params.courier = filters.courier;
        if (filters.tracking_id) params.tracking_id = filters.tracking_id;
        if (filters.order_id) params.order_id = filters.order_id;
        if (filters.category) params.category = filters.category;
        if (filters.dateRange) params.dateRange = JSON.stringify(filters.dateRange);

        const res = await client.get('/order', { params });
        return { success: true, data: res.data?.data || [], raw: res.data };
    } catch (err) {
        logger.error(`[Mengantar] getOrders error: ${err.message}`);
        return { success: false, data: [], error: err.message };
    }
}

// ── Pay Unpaid Orders ─────────────────────────────────────────────────────────
/**
 * Bayar order yang belum terbayar (ketika saldo Mengantar mencukupi).
 * @param {string} batchId - Batch ID dari createOrder
 * @param {string} courier - Nama kurir
 */
async function payUnpaidOrders(batchId, courier) {
    const client = _getAuthClient();
    if (!client) return { success: false, error: 'API key not configured' };

    try {
        const formData = new URLSearchParams();
        formData.append('batch_id', batchId);
        if (courier) formData.append('courier', courier);

        const res = await client.post('/order/pay-unpaid', formData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        return { success: true, count: res.data?.count || 0 };
    } catch (err) {
        logger.error(`[Mengantar] payUnpaidOrders error: ${err.message}`);
        return { success: false, error: err.message };
    }
}

// ── Format Resi Message for WhatsApp ─────────────────────────────────────────
/**
 * Format pesan notifikasi resi untuk customer.
 * @param {Object} orderResult - Hasil dari createOrder()
 * @returns {string} Pesan WA yang ramah
 */
function formatResiMessage(orderResult) {
    if (!orderResult.success) {
        return `Maaf bund, ada kendala saat membuat resi: ${orderResult.error} 🙏`;
    }

    const cnote = orderResult.cnote_no;
    const courier = orderResult.courier || 'Jasa Ekspedisi';
    const customer = orderResult.customer || '';
    const destination = orderResult.destination || '';
    const isPaid = orderResult.is_paid;

    const lines = [
        `Alhamdulillah, pesanan bunda sudah kami proses dan resi sudah dibuat! 📦`,
        ``,
        `📋 *Informasi Pengiriman:*`,
        cnote ? `🔖 Nomor Resi: *${cnote}*` : '',
        customer ? `👤 Penerima: ${customer}` : '',
        destination ? `📍 Tujuan: ${destination}` : '',
        `🚚 Kurir: ${courier}`,
        ``,
    ];

    if (!isPaid && orderResult.is_unpaid) {
        lines.push(`⚠️ Catatan: Resi masih perlu diaktivasi (saldo kirim sedang diproses).`);
        lines.push(``);
    }

    if (cnote) {
        lines.push(`Bisa lacak paket bunda di: https://api-public.mengantar.com/tracking/search`);
        lines.push(`Atau ketik nomor resi di Cek Resi aplikasi ekspedisi ya bund 😊`);
    }

    lines.push(``, `Terima kasih sudah berbelanja bund 🥰 Semoga produknya sesuai harapan ya!`);

    return lines.filter(l => l !== null && l !== undefined).join('\n').trim();
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
    getShippingCost,
    createOrder,
    getOrders,
    getAddresses,
    getAvailableTimes,
    checkShippingFeeAuth,
    checkShippingFeePublic,
    searchAddress,
    payUnpaidOrders,
    formatResiMessage,
};
