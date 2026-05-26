const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

const CACHE_FILE = path.join(config.DATA_DIR, 'mengantar_cache.json');
const LEGACY_CACHE_FILE = path.join(process.cwd(), 'mengantar_cache.json');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function loadCache() {
    const filePath = fs.existsSync(CACHE_FILE) ? CACHE_FILE : LEGACY_CACHE_FILE;
    if (!fs.existsSync(filePath)) return {};
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return {};
    }
}

function persistCache(cache) {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch (e) {
        logger.error("Gagal menyimpan cache Mengantar.");
    }
}

function saveCache(key, value) {
    const cache = loadCache();
    cache[key] = {
        value,
        expiresAt: Date.now() + CACHE_TTL_MS
    };
    persistCache(cache);
}

function getCache(key) {
    const cache = loadCache();
    const entry = cache[key];
    if (!entry) return null;

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
        delete cache[key];
        persistCache(cache);
        return null;
    }
    return entry.value;
}

/**
 * Mencari Destination ID dari Mengantar API menggunakan autofill endpoint
 * @param {string} keyword - Nama kecamatan/kota
 */
async function getDestinationId(keyword) {
    try {
        const url = `https://api-public.mengantar.com/api/address/autofill?keyword=${encodeURIComponent(keyword)}`;
        const res = await axios.get(url);

        const results = res.data.data;
        if (!results || results.length === 0) return null;
        
        // Pilih hasil pertama yang paling relevan
        const first = results[0];
        const label = `${first.SUBDISTRICT_NAME}, ${first.CITY_NAME}`;
        
        return {
            id: first._id,
            label: label,
            province: first.PROVINCE_NAME
        };
    } catch (error) {
        logger.error(`Error Mengantar Destination [${keyword}]: ${error.message}`);
        return null;
    }
}

async function getOriginId() {
    // Mengunci ID Origin secara permanen ke "Kecamatan PARE, Kabupaten Kediri"
    // ID Pare: 5fc633fef8f44b34aa4c4f47
    return "5fc633fef8f44b34aa4c4f47";
}

/**
 * Cek Ongkos Kirim JNE dan J&T via Mengantar API
 */
async function getShippingCost(destinationCity, weight = 1) {
    try {
        // 1. Dapatkan ID Asal
        const originId = await getOriginId();
        
        // Bersihkan nama wilayah agar pencarian lebih mantap
        const cleanDestination = destinationCity.toLowerCase()
            .replace('kota ', '').replace('kabupaten ', '').replace('kecamatan ', '').trim();
            
        const destData = await getDestinationId(cleanDestination);

        if (!originId || !destData) {
            return `Aduh Kak, sepertinya wilayah "${destinationCity}" tidak terdeteksi di sistem pengiriman Mengantar. 🙏 Bisa tolong sebutkan nama Kecamatan atau Kota dengan lebih jelas? 😊`;
        }

        // 2. Hitung Biaya via allEstimatePublic (Public API, no auth required)
        // Menggunakan weight=1 (karena aslinya dalam kg, atau sesuaikan)
        const estWeight = Math.ceil(weight / 1000); // konversi gram ke kg (minimal 1)
        const costUrl = `https://api-public.mengantar.com/api/order/allEstimatePublic?origin_id=${originId}&destination_id=${destData.id}&weight=${estWeight}&COD_AMOUNT=1`;
        
        const costRes = await axios.get(costUrl);
        const pricingData = costRes.data.data;
        
        if (!pricingData || Object.keys(pricingData).length === 0) {
            return `Wah, maaf banget Kak. Ternyata saat ini belum ada layanan ekspedisi ke ${destData.label} dari Kediri. 🙏`;
        }

        // 3. Susun Jawaban Natural
        // 3. Cari Harga Termurah dari JNE dan J&T
        const couriers = [
            { key: 'JNE', name: 'JNE Reguler' },
            { key: 'JT', name: 'J&T Express' }
        ];

        let availableCouriers = [];

        couriers.forEach(c => {
            if (pricingData[c.key]) {
                const service = pricingData[c.key];
                const basePrice = service.estimatedPrice || service.price || 0;
                if (basePrice > 0) {
                    const price = basePrice + 3000; // Markup Rp 3000
                    let etd = service.estimate_delivery || service.estimatedDate || '-';
                    
                    // Kustomisasi estimasi untuk J&T jika kosong/strip
                    if (c.key === 'JT' && (etd === '-' || !etd)) {
                        const prov = (destData.province || '').toUpperCase();
                        if (prov.includes('JAWA') || prov.includes('DKI') || prov.includes('BANTEN') || prov.includes('YOGYAKARTA')) {
                            etd = '3 - 4 hari kerja';
                        } else if (prov.includes('BALI')) {
                            etd = '4 - 5 hari kerja';
                        } else if (prov.includes('SULAWESI') || prov.includes('KALIMANTAN')) {
                            etd = '1 minggu lebih';
                        } else {
                            etd = '4 - 6 hari kerja';
                        }
                    }

                    availableCouriers.push({ name: c.name, price: price, etd: etd });
                }
            }
        });

        if (availableCouriers.length === 0) {
            return `Wah, maaf banget Kak. Ternyata untuk layanan reguler belum tersedia ke ${destData.label}. 🙏`;
        }

        // Urutkan dari harga terendah
        availableCouriers.sort((a, b) => a.price - b.price);
        const cheapest = availableCouriers[0];

        let reply = `Hore! Ini dia hasil cek ongkir terbaik dari Kediri ke ${destData.label} (${estWeight}kg):\n\n`;
        reply += `✅ Ekspedisi Reguler\n   Harga: Rp ${cheapest.price.toLocaleString('id-ID')}\n   Estimasi: ${cheapest.etd}\n\n`;
        reply += "Bisa dibantu konfirmasi untuk lanjut pesanannya Kak? 😊";
        return reply;

    } catch (error) {
        logger.error(`Mengantar Cost Error: ${error.message}`);
        return "Aduh, maaf Kak. Server pengiriman kami sedang istirahat sejenak. Nanti i bantu cekkan manual ya kalau alamatnya sudah lengkap! 🙏";
    }
}

module.exports = {
    getShippingCost
};
