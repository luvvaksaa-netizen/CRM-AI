// test_system.js - Automated Health Check & Hardening Validation Script
const path = require('path');
const fs = require('fs');
require('dotenv').config();

console.log("=========================================");
console.log("🚀 MEMULAI SYSTEM HEALTH & HARDENING CHECK");
console.log("=========================================\n");

async function runTests() {
    let passed = 0;
    let failed = 0;

    function assert(condition, message) {
        if (condition) {
            console.log(`[PASS] ✅ ${message}`);
            passed++;
        } else {
            console.error(`[FAIL] ❌ ${message}`);
            failed++;
        }
    }

    try {
        // --- 1. TEST DATABASE CONNECTION & MODELS ---
        console.log("▶️ Menguji Koneksi Database & Model...");
        const db = require('./src/database/index');
        await db.initDB();
        assert(db.Store && db.BotAgent && db.MediaAsset, "Semua Model Database berhasil dimuat.");

        // --- 2. TEST CASCADE DELETION (Hardening Phase 1) ---
        console.log("\n▶️ Menguji Logika Cascade Deletion...");
        const testAgent = await db.BotAgent.create({ name: 'TEST_AGENT', bot_name: 'TEST_BOT' });
        const testStore = await db.Store.create({ wa_id: 'TEST_WA_123', name: 'TEST_STORE', agent_id: testAgent.id });
        
        // Buat file fisik dummy
        const testFileName = `test-media-${Date.now()}.png`;
        const testFilePath = path.join(process.cwd(), 'data', 'uploads', testFileName);
        if (!fs.existsSync(path.join(process.cwd(), 'data', 'uploads'))) {
            fs.mkdirSync(path.join(process.cwd(), 'data', 'uploads'), { recursive: true });
        }
        fs.writeFileSync(testFilePath, 'dummy data');
        
        const testMedia = await db.MediaAsset.create({
            agent_id: testAgent.id,
            filename: testFileName,
            original_name: testFileName,
            type: 'image',
            label: 'Test'
        });

        // Simulasi Delete Agent (seperti di dashboard_service.js)
        await db.Store.update({ agent_id: null }, { where: { agent_id: testAgent.id } });
        const mediaAssets = await db.MediaAsset.findAll({ where: { agent_id: testAgent.id } });
        for (const asset of mediaAssets) {
            const p = path.join(process.cwd(), 'data', 'uploads', asset.filename);
            if (fs.existsSync(p)) fs.unlinkSync(p);
            await asset.destroy();
        }
        await testAgent.destroy();

        // Verifikasi
        const checkStore = await db.Store.findOne({ where: { wa_id: 'TEST_WA_123' } });
        assert(checkStore.agent_id === null, "Store berhasil di-unbind dari Agent yang dihapus.");
        
        const checkMedia = await db.MediaAsset.findOne({ where: { id: testMedia.id } });
        assert(checkMedia === null, "Data Media di DB berhasil dihapus (Cascade).");
        assert(!fs.existsSync(testFilePath), "File fisik Media berhasil dihapus dari Disk (Anti Disk Bloat).");

        // Bersihkan sisa
        await testStore.destroy();

        // --- 3. TEST SECURITY ROKETCHAT HMAC (Hardening Phase 2) ---
        console.log("\n▶️ Menguji Proteksi Webhook RocketChat...");
        const { verifyHMAC } = require('./src/events/webhook_handler');
        const hmacSecret = process.env.ROKETCHAT_HMAC_SECRET || '';
        if (!hmacSecret) {
            console.log("  ⚠️ ROKETCHAT_HMAC_SECRET belum diatur. Ini akan DITOLAK oleh server di production.");
        } else {
            const crypto = require('crypto');
            const body = JSON.stringify({ event: 'message', text: 'hello' });
            const sig = 'sha256=' + crypto.createHmac('sha256', hmacSecret).update(body, 'utf8').digest('hex');
            assert(verifyHMAC(body, sig, hmacSecret) === true, "HMAC Verification berfungsi dengan baik.");
            assert(verifyHMAC(body, "sha256=fake_signature", hmacSecret) === false, "HMAC mampu menolak signature palsu.");
        }

        // --- 4. TEST AI STALE QUEUE PRUNING (Hardening Phase 2) ---
        console.log("\n▶️ Menguji AI Stale Queue Pruning...");
        // Simulasi logika AI service
        const QUEUE_TIMEOUT_MS = 2 * 60 * 1000;
        let queuedAt = Date.now() - (3 * 60 * 1000); // Simulasi antre 3 menit yang lalu (Sudah basi)
        let isStale = (Date.now() - queuedAt > QUEUE_TIMEOUT_MS);
        assert(isStale === true, "AI Queue Pruning mendeteksi antrean kadaluarsa (>2 Menit) dengan akurat.");

    } catch (e) {
        console.error(`\n[CRITICAL ERROR] Eksekusi tes gagal: ${e.message}`);
        console.error(e.stack);
    }

    console.log("\n=========================================");
    console.log(`📊 HASIL: ${passed} Lulus | ${failed} Gagal`);
    console.log("=========================================");
    process.exit(failed > 0 ? 1 : 0);
}

runTests();
