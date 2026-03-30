const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

const CACHE_FILE = path.join(process.cwd(), 'komerce_cache.json');

/**
 * Helper: Menyimpan data ke cache.
 */
function saveCache(key, value) {
    let cache = {};
    try {
        if (fs.existsSync(CACHE_FILE)) {
            cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        }
        cache[key] = value;
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch (e) {
        logger.error("Gagal menyimpan cache Komerce.");
    }
}

/**
 * Helper: Mengambil data dari cache.
 */
function getCache(key) {
    if (!fs.existsSync(CACHE_FILE)) return null;
    try {
        const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        return cache[key] || null;
    } catch (e) {
        return null;
    }
}

/**
 * Mendapatkan Destination ID dari Komerce (Domestic-Destination).
 * @param {string} searchKeyword - Nama wilayah (Kediri, Jakarta Barat, dll).
 */
async function getDestinationId(searchKeyword) {
    try {
        // ENDPOINT RESMI KOMERCE: /destination/domestic-destination
        const url = `${config.KOMERCE_BASE_URL}/destination/domestic-destination`;
        const res = await axios.get(url, {
            params: { search: searchKeyword }, // Komerce menggunakan 'search'
            headers: { key: config.RAJAONGKIR_API_KEY.trim() }
        });

        const results = res.data.data;
        if (!results || results.length === 0) return null;
        
        // Pilih hasil pertama (biasanya paling akurat ke sub-district)
        return {
            id: results[0].id,
            label: results[0].label
        };
    } catch (error) {
        logger.error(`Error Komerce Destination [${searchKeyword}]: ${error.response?.status || error.message}`);
        if (error.response?.data) {
             logger.error(`Komerce Error Data: ${JSON.stringify(error.response.data)}`);
        }
        return null;
    }
}

/**
 * Mendapatkan ID asal (Origin) untuk Kediri.
 */
async function getOriginId() {
    const cachedId = getCache('origin_id_kediri_v2'); // V2 untuk endpoint baru
    if (cachedId) return cachedId;

    const data = await getDestinationId('Kediri');
    if (data) {
        saveCache('origin_id_kediri_v2', data.id);
        return data.id;
    }
    return null;
}

/**
 * Cek Ongkos Kirim JNE via Komerce API (Calculate Domestic-Cost).
 */
async function getJneOngkir(destinationCity, weight = 1000) {
    if (!config.RAJAONGKIR_API_KEY) return "Aduh maaf Kak, fitur cek ongkir belum aktif.";

    try {
        // 1. Dapatkan ID Asal
        const originId = await getOriginId();
        
        // Bersihkan nama wilayah agar pencarian lebih mantap
        const cleanDestination = destinationCity.toLowerCase()
            .replace('kota ', '').replace('kabupaten ', '').replace('kecamatan ', '').trim();
            
        const destData = await getDestinationId(cleanDestination);

        if (!originId || !destData) {
            return `Aduh Kak, sepertinya wilayah "${destinationCity}" tidak terdeteksi di peta pengiriman Komerce. 🙏 Bisa tolong sebutkan nama Kecamatan atau Kota dengan lebih jelas? 😊`;
        }

        // 2. Hitung Biaya (Penting: Gunakan x-www-form-urlencoded untuk Komerce)
        const costUrl = `${config.KOMERCE_BASE_URL}/calculate/domestic-cost`;
        
        // Bungkus data dalam URLSearchParams agar terkirim sebagai FORM DATA
        const params = new URLSearchParams();
        params.append('origin', originId);
        params.append('destination', destData.id);
        params.append('weight', weight.toString());
        params.append('courier', 'jne');

        const costRes = await axios.post(costUrl, params, {
            headers: { 
                'key': config.RAJAONGKIR_API_KEY.trim(),
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        // Struktur Komerce: res.data.data (Array)
        const jneData = costRes.data.data;
        if (!jneData || jneData.length === 0) {
            return `Wah, maaf banget Kak. Ternyata saat ini belum ada layanan JNE ke ${destData.label} dari Kediri. 🙏`;
        }

        // 3. Susun Jawaban Natural
        let reply = `Hore! Ini dia hasil cek ongkir JNE dari Kediri ke ${destData.label} (${weight}gr):\n\n`;
        
        jneData.forEach(service => {
            const price = service.cost || 0;
            reply += `✅ JNE ${service.service}\n   Harga: Rp ${price.toLocaleString('id-ID')}\n   Estimasi: ${service.etd} Hari\n\n`;
        });

        reply += "Gimana Kak, mau aku bantu lanjut buat paket pesanannya sekarang? 😊";
        return reply;

    } catch (error) {
        logger.error(`Komerce Cost Error: ${error.response?.status || error.message}`);
        if (error.response?.data) {
             logger.error(`Komerce Response Data: ${JSON.stringify(error.response.data)}`);
        }
        return "Aduh, maaf Kak. Server pengiriman kami sedang istirahat sejenak. Nanti i bantu cekkan manual ya kalau alamatnya sudah lengkap! 🙏";
    }
}

module.exports = {
    getJneOngkir
};
