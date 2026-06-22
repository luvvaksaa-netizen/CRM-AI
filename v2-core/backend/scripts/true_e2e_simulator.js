const axios = require('axios');

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
    console.log("==================================================");
    console.log("🚀 MEMULAI TRUE E2E SIMULASI (LIVE SOCKET INJECTION)");
    console.log("==================================================");
    
    const storeWaId = '6285385543068';
    const contactId = '6289999999999@c.us';
    
    console.log(`✅ Menggunakan Store: ${storeWaId}`);
    console.log(`✅ Menggunakan Customer Dummy: ${contactId}`);
    
    console.log("\n[INFO] Anda bisa buka layar Web App sekarang. Pesan akan masuk secara LIVE tanpa refresh!");
    await sleep(2000);
    
    const customerMessages = [
        "Halo bun, mau pesan stiker UV",
        "Nama yang dicetak: Budi",
        "Varian Cowok",
        "1 paket aja",
        "Transfer aja bun biar cepat",
        "Budi, 08123456789, Jl. Sudirman No 1, RT 1/RW 1, Kelurahan Melawai, Kecamatan Kebayoran Baru, Jakarta Selatan, DKI Jakarta, 12160"
    ];

    for (let i = 0; i < customerMessages.length; i++) {
        const cMsg = customerMessages[i];
        console.log(`\n👤 CUSTOMER MENGIRIM: ${cMsg}`);
        
        try {
            await axios.post(`http://localhost:3002/api/chat/${storeWaId}/simulate-incoming`, {
                contactId: contactId,
                body: cMsg
            });
        } catch (err) {
            console.error("❌ Gagal injeksi pesan:", err.message);
        }

        console.log("⏳ Menunggu respons AI...");
        await sleep(10000); 
    }
    
    console.log("\n==================================================");
    console.log("📸 TAHAP 2: CUSTOMER MENGIRIM BUKTI TRANSFER");
    console.log("==================================================");
    
    const tfMsg = "[AI-VISION: Ini adalah gambar bukti transfer bank BCA ke JAKA MULIA JAYA sebesar Rp 39.000 + Ongkir lunas]";
    console.log(`👤 CUSTOMER MENGIRIM GAMBAR: ${tfMsg}`);
    
    try {
        await axios.post(`http://localhost:3002/api/chat/${storeWaId}/simulate-incoming`, {
            contactId: contactId,
            body: tfMsg
        });
    } catch (err) {
        console.error("❌ Gagal injeksi bukti transfer:", err.message);
    }
    
    console.log("⏳ Menunggu AI memproses pembayaran dan mencetak resi...");
    await sleep(15000);

    console.log("\n✅ TRUE E2E SIMULATION SELESAI!");
    process.exit(0);
}

run().catch(err => {
    console.error("Terjadi Error:", err);
    process.exit(1);
});
