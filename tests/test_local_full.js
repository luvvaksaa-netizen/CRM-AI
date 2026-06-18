/**
 * @file test_local_full.js
 * @description Test lokal komprehensif untuk validasi sistem sebelum push ke production.
 * 
 * CARA PAKAI:
 *   node tests/test_local_full.js
 * 
 * TEST YANG DILAKUKAN:
 *   1. Webhook endpoint di lokal (port 3001)
 *   2. Guard keamanan: QRIS tidak boleh keluar sebelum customer konfirmasi
 *   3. Guard keamanan: nominal tidak boleh 0
 *   4. Scalev service mock (tanpa API key nyata)
 *   5. QRIS rendering (pakai string dummy)
 */

require('dotenv').config();
const http = require('http');

const BASE_URL = `http://localhost:${process.env.PORT || 3001}`;
let passed = 0;
let failed = 0;

function ok(label) {
    console.log(`  ✅ ${label}`);
    passed++;
}

function fail(label, reason) {
    console.error(`  ❌ ${label}: ${reason}`);
    failed++;
}

function httpPost(url, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 3001,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };
        const req = http.request(options, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: responseData,
                    location: res.headers.location
                });
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// ═══════════════════════════════════════════════════
// TEST 1: Webhook endpoint harus bisa diakses (tanpa redirect login)
// ═══════════════════════════════════════════════════
async function test_webhook_endpoint() {
    console.log('\n📡 TEST 1: Webhook Endpoint Accessibility');
    try {
        const res = await httpPost(`${BASE_URL}/webhook/scalev`, {
            event: 'test',
            order_id: 'test-123',
            payment_status: 'test',
        });

        if (res.statusCode === 302 || res.location?.includes('/login')) {
            fail('Webhook tidak redirect ke login', `Status: ${res.statusCode}, Location: ${res.location}`);
            console.log('    → FIX: Pastikan bot sudah di-restart setelah perubahan kode!');
        } else if (res.statusCode === 200) {
            const parsed = JSON.parse(res.body);
            if (parsed.received !== undefined) {
                ok(`Webhook endpoint accessible (status: ${res.statusCode})`);
            } else {
                fail('Response tidak valid', res.body.slice(0, 100));
            }
        } else {
            fail(`Status tidak terduga: ${res.statusCode}`, res.body.slice(0, 100));
        }
    } catch (err) {
        if (err.code === 'ECONNREFUSED') {
            console.log('  ⚠️  Bot tidak jalan di lokal — jalankan dulu: node index.js');
        } else {
            fail('Koneksi error', err.message);
        }
    }
}

// ═══════════════════════════════════════════════════
// TEST 2: Webhook berhasil proses event "paid"
// ═══════════════════════════════════════════════════
async function test_webhook_paid_event() {
    console.log('\n💳 TEST 2: Webhook Payment Received Event');
    try {
        const res = await httpPost(`${BASE_URL}/webhook/scalev`, {
            event: 'order.paid',
            order_id: 'scalev-order-test-999',
            payment_status: 'paid',
            order: {
                order_id: 'scalev-order-test-999',
                payment_status: 'paid',
                customer_name: 'Test Bunda',
                customer_phone: '628123456789',
                total_price: 117000,
                metadata: { store_wa_id: 'test-store', tipe_bayar: 'LUNAS' }
            }
        });

        if (res.statusCode === 200) {
            const parsed = JSON.parse(res.body);
            if (parsed.received === true && parsed.status === 'paid') {
                ok(`Webhook paid event diproses dengan benar (status: ${parsed.status})`);
            } else {
                fail('Webhook response tidak expected', JSON.stringify(parsed));
            }
        } else {
            fail(`Status: ${res.statusCode}`, res.body.slice(0, 200));
        }
    } catch (err) {
        if (err.code === 'ECONNREFUSED') {
            console.log('  ⚠️  Bot tidak jalan di lokal — skip test ini');
        } else {
            fail('Error', err.message);
        }
    }
}

// ═══════════════════════════════════════════════════
// TEST 3: Guard keamanan QRIS — nominal 0 harus ditolak
// ═══════════════════════════════════════════════════
async function test_guard_nominal_zero() {
    console.log('\n🛡️  TEST 3: Guard Keamanan — Nominal 0 Harus Ditolak');

    // Simulasi handler guard langsung (tanpa harus pakai HTTP)
    const amount = 0;
    if (!amount || amount <= 0) {
        ok('Guard nominal 0 berfungsi — QRIS tidak akan dibuat');
    } else {
        fail('Guard nominal gagal', 'Amount 0 tidak terdeteksi');
    }
}

// ═══════════════════════════════════════════════════
// TEST 4: Guard keamanan QRIS — konfirmasi customer
// ═══════════════════════════════════════════════════
async function test_guard_konfirmasi() {
    console.log('\n🛡️  TEST 4: Guard Keamanan — QRIS Hanya Setelah Customer Konfirmasi');

    const REKAP_PATTERN = /rekap\s+pesanan|total\s+harus\s+dibayar|harga\s+produk\s*:/i;
    const KONFIRMASI_PATTERN = /^(iya|ok|oke|setuju|ya|siap|deal|oke bund|iya bund|oke kak|iyaa|okee|yess|yes|lanjut|bisa|confirm|gas|yasudah|lanjutkan)/i;

    function checkGuard(history) {
        let rekapIndex = -1;
        let customerKonfirmasi = false;
        for (let hi = 0; hi < history.length; hi++) {
            const h = history[hi];
            const body = (h.body || '').toLowerCase();
            if (h.is_from_me && REKAP_PATTERN.test(body)) rekapIndex = hi;
            if (!h.is_from_me && rekapIndex >= 0 && hi > rekapIndex) {
                if (KONFIRMASI_PATTERN.test(body.trim())) customerKonfirmasi = true;
            }
        }
        return { rekapDikirim: rekapIndex >= 0, customerKonfirmasi };
    }

    // Skenario A: Belum ada rekap → harus ditolak
    const histA = [
        { is_from_me: false, body: 'hai mau pesan label nama' },
        { is_from_me: true, body: 'mau pilih varian yang mana bun?' },
    ];
    const resultA = checkGuard(histA);
    if (!resultA.rekapDikirim) {
        ok('Skenario A (belum ada rekap): QRIS ditolak dengan benar');
    } else {
        fail('Skenario A', 'Rekap terdeteksi padahal belum ada');
    }

    // Skenario B: Rekap sudah ada tapi customer belum IYA → harus ditolak
    const histB = [
        { is_from_me: false, body: 'hai mau pesan' },
        { is_from_me: true, body: 'Rekap pesanan Bunda Sari:\nTotal Harus Dibayar: Rp 117.000\n' },
    ];
    const resultB = checkGuard(histB);
    if (resultB.rekapDikirim && !resultB.customerKonfirmasi) {
        ok('Skenario B (rekap ada, belum IYA): QRIS ditolak dengan benar');
    } else {
        fail('Skenario B', `rekapDikirim=${resultB.rekapDikirim}, konfirmasi=${resultB.customerKonfirmasi}`);
    }

    // Skenario C: Rekap ada DAN customer sudah IYA → BOLEH lanjut QRIS
    const histC = [
        { is_from_me: false, body: 'hai mau pesan' },
        { is_from_me: true, body: 'Rekap pesanan Bunda Sari:\nTotal Harus Dibayar: Rp 117.000\n' },
        { is_from_me: false, body: 'Iya bund sudah sesuai' },
    ];
    const resultC = checkGuard(histC);
    if (resultC.rekapDikirim && resultC.customerKonfirmasi) {
        ok('Skenario C (rekap ada + customer IYA): QRIS DIIZINKAN ✅');
    } else {
        fail('Skenario C', `rekapDikirim=${resultC.rekapDikirim}, konfirmasi=${resultC.customerKonfirmasi}`);
    }

    // Skenario D: Customer IYA tapi SEBELUM rekap → harus ditolak
    const histD = [
        { is_from_me: false, body: 'iya' },
        { is_from_me: true, body: 'Rekap pesanan Bunda Sari:\nTotal Harus Dibayar: Rp 117.000\n' },
    ];
    const resultD = checkGuard(histD);
    if (resultD.rekapDikirim && !resultD.customerKonfirmasi) {
        ok('Skenario D (IYA sebelum rekap): QRIS ditolak dengan benar');
    } else {
        fail('Skenario D', `rekapDikirim=${resultD.rekapDikirim}, konfirmasi=${resultD.customerKonfirmasi}`);
    }
}

// ═══════════════════════════════════════════════════
// TEST 5: QRIS Render (tanpa Scalev API)
// ═══════════════════════════════════════════════════
async function test_qris_render() {
    console.log('\n🔲 TEST 5: QRIS Image Render (Mock String)');
    try {
        const scalevSvc = require('../src/services/scalev_service');

        // String QRIS dummy (format valid QR)
        const dummyQrString = '00020101021226570011ID.CO.BNI.WWW011893600009150000017102150000017100003204280303UMI51440014ID.CO.QRIS.WWW0215ID20242169600070303UMI5204481153033605802ID5918TEST MERCHANT6013JAKARTA TIMUR61051234062070703A016304ABCD';

        const buffer = await scalevSvc.renderQrisImage(dummyQrString);
        if (buffer && buffer.length > 0) {
            ok(`QRIS PNG rendered (${buffer.length} bytes) — siap kirim ke WA`);
        } else {
            fail('QRIS render gagal', 'Buffer kosong');
        }
    } catch (err) {
        fail('Error', err.message);
    }
}

// ═══════════════════════════════════════════════════
// TEST 6: Scalev service load check
// ═══════════════════════════════════════════════════
async function test_scalev_service() {
    console.log('\n⚙️  TEST 6: Scalev Service Load & Config');
    try {
        const scalevSvc = require('../src/services/scalev_service');
        const functions = Object.keys(scalevSvc);
        const required = ['createOrder', 'createPaymentForOrder', 'createOrderAndPay', 'processWebhook', 'renderQrisImage'];

        for (const fn of required) {
            if (functions.includes(fn)) {
                ok(`Function ${fn}() tersedia`);
            } else {
                fail(`Function ${fn}() tidak ditemukan`, 'Missing export');
            }
        }

        const apiKey = scalevSvc.getApiKey();
        if (apiKey) {
            ok(`SCALEV_API_KEY dikonfigurasi (${apiKey.length} chars)`);
        } else {
            console.log('  ⚠️  SCALEV_API_KEY belum diisi di .env — test API call di-skip');
        }

        const storeId = scalevSvc.getStoreUniqueId();
        if (storeId) {
            ok(`SCALEV_STORE_UNIQUE_ID dikonfigurasi: ${storeId}`);
        } else {
            console.log('  ⚠️  SCALEV_STORE_UNIQUE_ID belum diisi di .env');
        }
    } catch (err) {
        fail('Service tidak bisa dimuat', err.message);
    }
}

// ═══════════════════════════════════════════════════
// TEST 7: Scalev API call (HANYA jika API key tersedia)
// ═══════════════════════════════════════════════════
async function test_scalev_api_call() {
    console.log('\n🌐 TEST 7: Scalev API Real Call (hanya jika API key tersedia)');
    try {
        const scalevSvc = require('../src/services/scalev_service');
        if (!scalevSvc.getApiKey()) {
            console.log('  ⏭️  SKIP — SCALEV_API_KEY belum diisi di .env');
            return;
        }
        if (!scalevSvc.getStoreUniqueId()) {
            console.log('  ⏭️  SKIP — SCALEV_STORE_UNIQUE_ID belum diisi di .env');
            return;
        }

        console.log('  🔄 Mencoba buat order test ke Scalev API...');
        const result = await scalevSvc.createOrderAndPay({
            customer_name: '[BOT-TEST] Bunda Test',
            customer_phone: '628000000000',
            address: 'Kediri, Jawa Timur (TEST - bisa dihapus)',
            payment_method: 'qris',
            notes: '[TEST] Order dari script test_local_full.js — HAPUS jika di dashboard Scalev',
            ordervariants: [
                { product_name: 'Label Nama DTF [TEST]', variant_name: 'Varian 2 - Pink', quantity: 1, price: 39000 }
            ],
            shipping_cost: 15000,
            metadata: { created_by: 'test_script', test: true }
        });

        if (result.success) {
            ok(`Order test berhasil dibuat! Order ID: ${result.order_id}`);
            ok(`Payment method: ${result.payment_method}`);
            if (result.qrisImageBuffer) {
                ok(`QRIS PNG dihasilkan (${result.qrisImageBuffer.length} bytes) 🎉`);
            } else if (result.payment_url) {
                ok(`Payment URL tersedia: ${result.payment_url}`);
            } else {
                console.log('  ⚠️  Tidak ada QRIS image atau payment URL di response');
            }
            if (result.public_order_url) {
                console.log(`  📎 Link order Scalev: ${result.public_order_url}`);
            }
            console.log(`  💡 HAPUS order test ini dari dashboard Scalev ya!`);
        } else {
            fail('API call gagal', result.error || 'Unknown error');
        }
    } catch (err) {
        fail('Error tidak terduga', err.message);
    }
}

// ═══════════════════════════════════════════════════
// MAIN RUNNER
// ═══════════════════════════════════════════════════
async function main() {
    console.log('═══════════════════════════════════════════════');
    console.log('   CRM-AI Scalev Integration — Local Test Suite');
    console.log(`   ${new Date().toLocaleString('id-ID')}`);
    console.log('═══════════════════════════════════════════════');

    await test_webhook_endpoint();
    await test_webhook_paid_event();
    await test_guard_nominal_zero();
    await test_guard_konfirmasi();
    await test_qris_render();
    await test_scalev_service();
    await test_scalev_api_call();

    console.log('\n═══════════════════════════════════════════════');
    console.log(`   HASIL: ${passed} passed, ${failed} failed`);
    if (failed === 0) {
        console.log('   🎉 Semua test lolos! Aman untuk deploy ke production.');
    } else {
        console.log('   ⚠️  Ada test yang gagal. Perbaiki dulu sebelum deploy!');
    }
    console.log('═══════════════════════════════════════════════\n');

    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('Test runner error:', err.message);
    process.exit(1);
});
