const http = require('http');

const PORT = 3002; // Port default backend v2-core

async function simulateWebhook(referenceId, amount = 39000, status = 'SUCCEEDED') {
    const payload = JSON.stringify({
        event: "qr.payment",
        created: new Date().toISOString(),
        business_id: "test_business_id",
        reference_id: referenceId, // Ini ID QRIS-nya
        status: status, // SUCCEEDED = Lunas
        amount: amount,
        payment_method: "QRIS",
        updated: new Date().toISOString()
    });

    const options = {
        hostname: 'localhost',
        port: PORT,
        path: '/api/xendit/webhook',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    console.log(`[SIMULATOR] Memicu Webhook Xendit ke Backend (Ref ID: ${referenceId}) ...`);
    
    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            console.log(`[SIMULATOR] Response Backend: HTTP ${res.statusCode}`);
            console.log(`[SIMULATOR] Body: ${data}`);
        });
    });

    req.on('error', (e) => {
        console.error(`[SIMULATOR] Gagal memicu webhook (apakah server jalan di port ${PORT}?): ${e.message}`);
    });

    req.write(payload);
    req.end();
}

// Ambil referenceId dari argumen command line
const refId = process.argv[2];
if (!refId) {
    console.log('--- CARA PAKAI SIMULATOR PEMBAYARAN QRIS ---');
    console.log('1. Buka terminal');
    console.log('2. Ketik: node test_xendit_payment_sim.js <REFERENCE_ID_QRIS>');
    console.log('Contoh: node test_xendit_payment_sim.js QRIS-LUNAS-628123-172554');
    process.exit(1);
}

const amount = process.argv[3] ? parseInt(process.argv[3]) : 39000;
simulateWebhook(refId, amount);
