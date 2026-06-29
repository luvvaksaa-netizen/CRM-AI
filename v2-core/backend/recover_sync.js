require('dotenv').config();
const jwt = require('jsonwebtoken');
const axios = require('axios');

const storeWaId = process.argv[2];
if (!storeWaId) {
  console.log("Gagal: Anda harus memasukkan ID/Nomor WA Toko.");
  console.log("Contoh penggunaan: node recover_sync.js 6281234567890");
  process.exit(1);
}

// Generate Admin Token untuk bypass Auth tanpa perlu login di browser
const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'secret';
const token = jwt.sign({ id: 1, role: 'admin' }, secret, { expiresIn: '1h' });

const PORT = process.env.PORT || 3000;
const baseURL = `http://127.0.0.1:${PORT}/api`;

(async () => {
  try {
    console.log("==================================================");
    console.log(`🚀 Memulai Recovery & Auto-Reply untuk WA: ${storeWaId}`);
    console.log("==================================================");

    console.log(`\n[1/2] Menarik data sinkronisasi terbaru dari perangkat WA...`);
    console.log(`      (Memastikan kondisi terakhir chat ada di kita atau di customer)`);
    
    const syncRes = await axios.post(`${baseURL}/chat/${storeWaId}/sync-all-wa`, {}, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 60000 // Beri waktu 60 detik jika chat sangat banyak
    });
    console.log("✅ Sinkronisasi Selesai:", syncRes.data.message || "Berhasil");

    console.log(`\n[2/2] Memeriksa chat yang tertunda (Sweep Unanswered)...`);
    console.log(`      (Sistem otomatis mengabaikan chat yang sudah terbalas atau sudah Closing)`);
    
    const sweepRes = await axios.post(`${baseURL}/chat/${storeWaId}/sweep-unanswered`, {}, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log("✅ Sapu Bersih Selesai:", sweepRes.data.message || "Berhasil");

    console.log("\n🎉 Selesai! Pesan yang belum terjawab sedang diproses oleh Bot AI di latar belakang.");
  } catch (err) {
    console.error("\n❌ Error terjadi:");
    if (err.response) {
      console.error(err.response.data);
    } else {
      console.error(err.message);
    }
  }
})();
