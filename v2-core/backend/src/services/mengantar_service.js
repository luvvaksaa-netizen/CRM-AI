/**
 * @file mengantar_service.js (v2-core)
 * @description Mengantar Shipping Service — redirects to updated service.
 *
 * File ini me-re-export fungsi dari mengantar.service.ts yang sudah dikompilasi,
 * sehingga ai_service.js yang menggunakan require('./services/mengantar_service')
 * tetap mendapatkan versi terbaru dengan authenticated API support.
 */

'use strict';

// Coba load dari compiled TypeScript version (mengantar.service.js hasil tsc)
// Fallback ke implementasi internal jika file kompilasi belum tersedia
let service;
try {
    service = require('./mengantar.service');
    // Handle kemungkinan default export (TypeScript compiled)
    if (service && service.default) service = service.default;
    // Pastikan fungsi utama tersedia
    if (!service || typeof service.getShippingCost !== 'function') {
        throw new Error('mengantar.service tidak memiliki getShippingCost');
    }
} catch (err) {
    // Fallback: implementasi langsung di sini jika compiled service belum ada
    console.warn('[Mengantar] Fallback ke implementasi inline:', err.message);
    service = _buildInlineService();
}

function _buildInlineService() {
    const axios = require('axios');
    const fs = require('fs');
    const path = require('path');

    const BASE_URL = 'https://app.mengantar.com';
    const KEDIRI_KOTA_ORIGIN_ID = '5fc63405f8f44b34aa4c4f9a';
    const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const DATA_DIR = process.env.DATA_DIR || process.cwd();
    const CACHE_FILE = path.join(DATA_DIR, 'mengantar_cache.json');

    function _loadCache() {
        try { return fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {}; }
        catch (_) { return {}; }
    }
    function _persistCache(c) { try { fs.writeFileSync(CACHE_FILE, JSON.stringify(c, null, 2)); } catch (_) {} }
    function _setCache(key, value, ttl) {
        const c = _loadCache();
        c[key] = { value, expiresAt: Date.now() + (ttl || CACHE_TTL_MS) };
        _persistCache(c);
    }
    function _getCache(key) {
        const c = _loadCache();
        const e = c[key];
        if (!e) return null;
        if (Date.now() > e.expiresAt) { delete c[key]; _persistCache(c); return null; }
        return e.value;
    }

    function _getAuthClient() {
        const apiKey = process.env.MENGANTAR_API_KEY || '';
        if (!apiKey) return null;
        return axios.create({ baseURL: `${BASE_URL}/api/public/${apiKey}`, timeout: 20000, headers: { 'Content-Type': 'application/json' } });
    }

    function _getDefaultAddressId() { return process.env.MENGANTAR_ADDRESS_ID || '686df175e63455b7eca24f22'; }
    function _getDefaultCourier() { return process.env.MENGANTAR_COURIER || 'JT'; }

    async function searchAddress(keyword) {
        const cacheKey = `addr_search_${keyword.toLowerCase().trim()}`;
        const cached = _getCache(cacheKey);
        if (cached) return cached;
        try {
            const res = await axios.get(`${BASE_URL}/api/public/legacy/address/search?keyword=${encodeURIComponent(keyword)}`, { timeout: 10000 });
            const results = res.data?.data || [];
            if (!results.length) return null;
            const first = results[0];
            const result = { id: first._id, label: `${first.SUBDISTRICT_NAME}, ${first.CITY_NAME}`, province: first.PROVINCE_NAME, city: first.CITY_NAME, subdistrict: first.SUBDISTRICT_NAME, zip: first.ZIP_CODE };
            _setCache(cacheKey, result);
            return result;
        } catch (e) { console.error(`[Mengantar] searchAddress error [${keyword}]:`, e.message); return null; }
    }

    async function getAddresses() {
        const client = _getAuthClient();
        if (!client) return [];
        const cached = _getCache('mengantar_addresses');
        if (cached) return cached;
        try {
            const res = await client.get('/address');
            const addrs = res.data?.data || [];
            _setCache('mengantar_addresses', addrs);
            return addrs;
        } catch (e) { console.error('[Mengantar] getAddresses error:', e.message); return []; }
    }

    async function getAvailableTimes(addressId) {
        const client = _getAuthClient();
        if (!client) return [];
        const addrId = addressId || _getDefaultAddressId();
        try {
            const res = await client.get('/time', { params: { address: addrId } });
            return res.data?.data || [];
        } catch (e) { return []; }
    }

    async function checkShippingFeePublic(originId, destinationId, weight = 1) {
        const cacheKey = `mengantar_public_fee_${originId}_${destinationId}_${weight}`;
        const cached = _getCache(cacheKey);
        if (cached) return cached;
        try {
            const res = await axios.get(`${BASE_URL}/api/order/allEstimatePublic`, { params: { origin_id: originId, destination_id: destinationId, weight, COD_AMOUNT: 1 }, timeout: 10000 });
            const data = res.data?.data;
            if (data) _setCache(cacheKey, data);
            return data ?? null;
        } catch (e) { return null; }
    }

    function _getEtdByProvince(province = '') {
        const p = province.toUpperCase();
        if (p.includes('JAWA') || p.includes('DKI') || p.includes('BANTEN') || p.includes('YOGYAKARTA')) return '3-4 hari kerja';
        if (p.includes('BALI')) return '4-5 hari kerja';
        return '4-6 hari kerja';
    }

    async function getShippingCost(destinationCity, weightGrams = 1000) {
        try {
            const cleanDest = destinationCity.toLowerCase().replace(/kota\s+/g, '').replace(/kabupaten\s+/g, '').replace(/kecamatan\s+/g, '').trim();
            const destData = await searchAddress(cleanDest);
            if (!destData) return `Aduh bund, wilayah "${destinationCity}" tidak terdeteksi 🙏 Bisa sebutkan nama Kecamatan atau Kota/Kabupaten yang lebih spesifik? 😊`;
            const weight = Math.max(1, Math.ceil(weightGrams / 1000));
            const pricingData = await checkShippingFeePublic(KEDIRI_KOTA_ORIGIN_ID, destData.id, weight);
            if (!pricingData || !Object.keys(pricingData).length) return `Wah, maaf bund. Saat ini belum ada layanan pengiriman ke ${destData.label} dari Kediri 🙏`;
            const MARKUP = 3000;
            for (const courierKey of ['JT', 'JNE']) {
                const data = pricingData[courierKey];
                if (!data || data.unsupported || !(data.estimatedSpecialPrice || data.estimatedPrice || 0)) continue;
                const finalPrice = (data.estimatedSpecialPrice || data.estimatedPrice) + MARKUP;
                let etd = data.estimatedDate || data.estimate_delivery || '';
                if (!etd || etd === '-') etd = _getEtdByProvince(destData.province);
                return `Hore! Ini hasil cek ongkir dari Kediri ke ${destData.label} (${weight}kg):\n\n✅ Pengiriman Reguler\n   Harga: Rp ${finalPrice.toLocaleString('id-ID')}\n   Estimasi: ${etd}\n\nBisa dibantu konfirmasi untuk lanjut pesanannya bund? 😊`;
            }
            const shopeeLink = process.env.SHOPEE_LINK || '';
            return shopeeLink
                ? `Aduh bund, maaf ya 🙏 Layanan pengiriman ke ${destData.label} belum tersedia.\n\nBisa pesan via Shopee kami 😊\n👉 ${shopeeLink}`
                : `Aduh bund, maaf ya 🙏 Layanan pengiriman ke ${destData.label} belum tersedia saat ini.`;
        } catch (e) {
            console.error('[Mengantar] getShippingCost error:', e.message);
            return 'Aduh maaf bund, server pengiriman sedang istirahat sejenak. Nanti kami bantu cekkan manual ya! 🙏';
        }
    }

    async function createOrder(params) {
        const client = _getAuthClient();
        if (!client) return { success: false, error: 'MENGANTAR_API_KEY belum dikonfigurasi' };
        const { customerName, customerPhone, customerAddress, destinationKeyword, destinationId, weight = 1, quantity = 1, parcelContent, goodsValue, codAmount, courier, addressId, customProducts, pickupType = 'dropOff', deliveryInstruction } = params;
        if (!customerName) return { success: false, error: 'customerName wajib diisi' };
        if (!customerAddress) return { success: false, error: 'customerAddress wajib diisi' };
        if (!parcelContent) return { success: false, error: 'parcelContent wajib diisi' };
        if (!destinationKeyword && !destinationId) return { success: false, error: 'destinationKeyword atau destinationId wajib diisi' };
        try {
            let destId = destinationId;
            let destLabel = '';
            if (!destId && destinationKeyword) {
                const destData = await searchAddress(destinationKeyword);
                if (!destData) return { success: false, error: `Wilayah "${destinationKeyword}" tidak ditemukan` };
                destId = destData.id;
                destLabel = destData.label;
            }
            const courierName = courier || _getDefaultCourier();
            const pickupAddressId = addressId || _getDefaultAddressId();
            const pickup = pickupType === 'scheduledPickup'
                ? (() => { const times = []; const ft = times.find(t => new Date(t.date) > new Date()); return ft ? { type: 'scheduledPickup', volume: 'volumeMotor', address_id: pickupAddressId, time_id: ft._id } : { type: 'dropOff', address_id: pickupAddressId }; })()
                : { type: 'dropOff', address_id: pickupAddressId };
            const orderItem = { customerAddressDataId: destId, customerAddress, customerName, customerPhone: String(customerPhone || '').replace(/^(0|62|\+62)/, ''), parcelContent, weight: Math.max(1, Number(weight)), quantity: Math.max(1, Number(quantity)) };
            if (codAmount && Number(codAmount) > 0) orderItem.COD = Math.round(Number(codAmount));
            else if (goodsValue && Number(goodsValue) > 0) orderItem.goodsValue = Math.round(Number(goodsValue));
            if (deliveryInstruction) orderItem.deliveryInstruction = deliveryInstruction;
            if (customProducts?.length) orderItem.customProducts = customProducts.map(p => ({ name: p.name || parcelContent, variant: p.variant || '', qty: Math.max(1, Number(p.qty ?? 1)), price: Math.round(Number(p.price ?? 0)), weight: Number(p.weight ?? 1) }));
            const res = await client.post('/order', { courier: courierName, pickup, orders: [orderItem] });
            const data = res.data;
            if (!data.success) return { success: false, error: data.message || 'Gagal membuat order' };
            const orders = data.data || [];
            const first = orders[0];
            return { success: true, cnote_no: first?.cnote_no || '', order_id: first?.ORDER_ID || first?._id || '', batch: data.batch || '', batch_id: data.batch_id || '', courier: courierName, customer: customerName, destination: destLabel, is_paid: first?.isPaid !== false, is_unpaid: first?.isPaid === false, raw: data };
        } catch (e) {
            const errMsg = e.response?.data?.message || e.message;
            console.error('[Mengantar] createOrder error:', errMsg);
            return { success: false, error: errMsg };
        }
    }

    async function getOrders(filters = {}) {
        const client = _getAuthClient();
        if (!client) return { success: false, data: [], error: 'API key not configured' };
        try {
            const params = { page: filters.page || 1, size: filters.size || 20 };
            if (filters.courier) params.courier = filters.courier;
            if (filters.tracking_id) params.tracking_id = filters.tracking_id;
            const res = await client.get('/order', { params });
            return { success: true, data: res.data?.data || [] };
        } catch (e) { return { success: false, data: [], error: e.message }; }
    }

    function formatResiMessage(orderResult) {
        if (!orderResult.success) return `Maaf bund, ada kendala saat membuat resi: ${orderResult.error} 🙏`;
        const lines = [
            `Alhamdulillah, pesanan bunda sudah kami proses dan resi sudah dibuat! 📦`,
            ``,
            `📋 *Informasi Pengiriman:*`,
            orderResult.cnote_no ? `🔖 Nomor Resi: *${orderResult.cnote_no}*` : '',
            orderResult.customer ? `👤 Penerima: ${orderResult.customer}` : '',
            orderResult.destination ? `📍 Tujuan: ${orderResult.destination}` : '',
            `🚚 Kurir: ${orderResult.courier || 'J&T Express'}`,
            ``,
            orderResult.is_unpaid ? `⚠️ Catatan: Resi masih perlu diaktivasi (saldo pengiriman sedang diproses).` : '',
            `Bisa lacak paket di aplikasi ${orderResult.courier || 'J&T'} ya bund 😊`,
            ``,
            `Terima kasih sudah berbelanja bund 🥰 Semoga produknya sesuai harapan ya!`
        ].filter(l => l !== null && l !== undefined);
        return lines.join('\n').trim();
    }

    return { getShippingCost, createOrder, getOrders, getAddresses, getAvailableTimes, checkShippingFeePublic, searchAddress, formatResiMessage };
}

module.exports = service;
