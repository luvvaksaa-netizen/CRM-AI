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
 * Cek apakah ekspedisi bisa melayani rute ini.
 * Berdasarkan respons API Mengantar:
 *   - unsupported: true  → ekspedisi SAMA SEKALI tidak menjangkau (COD & NON-COD)
 *   - estimatedPrice: 0  → tidak ada tarif (sama dengan tidak menjangkau)
 * 
 * @param {object} serviceData - Data ekspedisi dari API
 * @returns {boolean} true jika ekspedisi TIDAK menjangkau
 */
function isExpeditionUnsupported(serviceData) {
    if (!serviceData) return true;
    if (serviceData.unsupported === true) return true;
    if ((serviceData.estimatedPrice || 0) === 0) return true;
    return false;
}

/**
 * Hitung ETD berdasarkan provinsi tujuan (fallback jika API tidak memberikan estimasi)
 * @param {string} province - Nama provinsi
 * @returns {string} Estimasi waktu pengiriman
 */
function getEtdByProvince(province) {
    const prov = (province || '').toUpperCase();
    if (prov.includes('JAWA') || prov.includes('DKI') || prov.includes('BANTEN') || prov.includes('YOGYAKARTA')) {
        return '3 - 4 hari kerja';
    } else if (prov.includes('BALI')) {
        return '4 - 5 hari kerja';
    } else if (prov.includes('SULAWESI') || prov.includes('KALIMANTAN')) {
        return '1 minggu lebih';
    } else if (prov.includes('PAPUA') || prov.includes('MALUKU') || prov.includes('NUSA TENGGARA')) {
        return '7 - 10 hari kerja';
    } else {
        return '4 - 6 hari kerja';
    }
}

/**
 * Cek Ongkos Kirim via Mengantar API
 * 
 * STRATEGI FALLBACK (sesuai permintaan owner):
 *   1. Coba J&T dahulu (tarif lebih murah)
 *   2. Jika J&T tidak menjangkau → diam-diam pakai JNE (customer tidak tahu nama ekspedisi)
 *   3. Jika J&T & JNE sama-sama tidak menjangkau → arahkan ke toko Shopee
 * 
 * CATATAN: Nama ekspedisi TIDAK disebutkan kepada customer (hanya info harga & estimasi)
 */
async function getShippingCost(destinationCity, weight = 1) {
    try {
        // 1. Dapatkan ID Asal
        const originId = await getOriginId();
        
        // Bersihkan nama wilayah agar pencarian lebih akurat
        const cleanDestination = destinationCity.toLowerCase()
            .replace('kota ', '').replace('kabupaten ', '').replace('kecamatan ', '').trim();
            
        const destData = await getDestinationId(cleanDestination);

        if (!originId || !destData) {
            return `Aduh bund, sepertinya wilayah "${destinationCity}" tidak terdeteksi di sistem pengiriman kami. 🙏 Bisa tolong sebutkan nama Kecamatan atau Kota dengan lebih jelas? 😊`;
        }

        // 2. Panggil API Mengantar untuk seluruh ekspedisi sekaligus
        const estWeight = Math.ceil(weight / 1000); // konversi gram ke kg (minimal 1)
        const costUrl = `https://api-public.mengantar.com/api/order/allEstimatePublic?origin_id=${originId}&destination_id=${destData.id}&weight=${estWeight}&COD_AMOUNT=1`;
        
        const costRes = await axios.get(costUrl);
        const pricingData = costRes.data.data;
        
        if (!pricingData || Object.keys(pricingData).length === 0) {
            return `Wah, maaf bund. Saat ini belum ada layanan pengiriman ke ${destData.label} dari Kediri. 🙏`;
        }

        // ─────────────────────────────────────────────────────────────────────
        // 3. LOGIKA FALLBACK: J&T → JNE → Shopee
        // ─────────────────────────────────────────────────────────────────────

        // Cek J&T
        const jtData = pricingData['JT'];
        const jtUnavailable = isExpeditionUnsupported(jtData);

        if (!jtUnavailable) {
            // ✅ J&T tersedia — gunakan J&T
            const basePrice = jtData.estimatedPrice || jtData.price || 0;
            const finalPrice = basePrice + 3000; // markup Rp 3.000
            
            let etd = jtData.estimatedDate || jtData.estimate_delivery || '';
            if (!etd || etd === '-') {
                etd = getEtdByProvince(destData.province);
            }

            logger.bot(`[Ongkir] J&T → ${destData.label}: Rp ${finalPrice.toLocaleString('id-ID')}`);
            return buildOngkirReply(destData.label, finalPrice, etd, estWeight);
        }

        // J&T tidak menjangkau → coba JNE secara diam-diam
        logger.bot(`[Ongkir] J&T tidak menjangkau ${destData.label}, fallback ke JNE...`);

        const jneData = pricingData['JNE'];
        const jneUnavailable = isExpeditionUnsupported(jneData);

        if (!jneUnavailable) {
            // ✅ JNE tersedia — gunakan JNE (TANPA menyebut nama JNE ke customer)
            const basePrice = jneData.estimatedPrice || jneData.price || 0;
            const finalPrice = basePrice + 3000; // markup Rp 3.000
            
            let etd = jneData.estimatedDate || jneData.estimate_delivery || '';
            if (!etd || etd === '-') {
                etd = getEtdByProvince(destData.province);
            }

            logger.bot(`[Ongkir] JNE fallback → ${destData.label}: Rp ${finalPrice.toLocaleString('id-ID')}`);
            return buildOngkirReply(destData.label, finalPrice, etd, estWeight);
        }

        // ❌ Baik J&T maupun JNE tidak menjangkau → arahkan ke Shopee
        logger.bot(`[Ongkir] J&T & JNE tidak menjangkau ${destData.label}, arahkan ke Shopee.`);

        const shopeeLink = config.SHOPEE_LINK || process.env.SHOPEE_LINK || '';
        if (shopeeLink) {
            return (
                `Aduh bund, maaf ya 🙏 Layanan pengiriman reguler dari Kediri ke ${destData.label} belum tersedia untuk saat ini.\n\n` +
                `Tapi tenang bund, bisa pesan langsung lewat toko Shopee kami ya 😊\n` +
                `👉 ${shopeeLink}\n\n` +
                `Di Shopee biasanya lebih mudah dan ada promo ongkir-nya juga lho bund 🥰`
            );
        } else {
            // Fallback kalau SHOPEE_LINK belum diisi di .env
            return (
                `Aduh bund, maaf ya 🙏 Layanan pengiriman reguler dari Kediri ke ${destData.label} belum tersedia.\n` +
                `Bisa hubungi kami lebih lanjut untuk cari solusi pengiriman alternatif ya bund 😊`
            );
        }

    } catch (error) {
        logger.error(`Mengantar Cost Error: ${error.message}`);
        return "Aduh, maaf bund. Server pengiriman kami sedang istirahat sejenak. Nanti kami bantu cekkan manual ya kalau alamatnya sudah lengkap! 🙏";
    }
}

/**
 * Helper: Buat teks balasan ongkir yang natural
 * Nama ekspedisi TIDAK disebutkan agar customer tidak bingung / tanya-tanya
 */
function buildOngkirReply(destinationLabel, price, etd, weightKg) {
    let reply = `Hore! Ini hasil cek ongkir dari Kediri ke ${destinationLabel} (${weightKg}kg):\n\n`;
    reply += `✅ Pengiriman Reguler\n`;
    reply += `   Harga: Rp ${price.toLocaleString('id-ID')}\n`;
    reply += `   Estimasi: ${etd}\n\n`;
    reply += `Bisa dibantu konfirmasi untuk lanjut pesanannya bund? 😊`;
    return reply;
}

module.exports = {
    getShippingCost
};
