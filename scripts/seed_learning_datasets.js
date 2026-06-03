/**
 * @file scripts/seed_learning_datasets.js
 * @description Proses 8 file dataset closing nyata dari CS Mbak Dea
 *              dan populate ClosingPatterns database sebagai starting point.
 *
 * CARA RUN:
 *   node scripts/seed_learning_datasets.js
 *   node scripts/seed_learning_datasets.js --agent-id=1
 *
 * Setelah selesai, bot sudah punya pola dari percakapan nyata!
 */

'use strict';

const path = require('path');
const fs = require('fs');

// Setup path agar bisa import dari src/
const rootDir = path.join(__dirname, '..');
process.chdir(rootDir);

// Load environment variables
try {
    require('dotenv').config({ path: path.join(rootDir, '.env') });
} catch (_) {}

async function main() {
    console.log('\n🧠 LEARNING BOT — SEED DATASETS\n');
    console.log('=' .repeat(50));
    console.log('Memproses dataset closing nyata dari CS Mbak Dea...\n');

    // Inisialisasi database dulu
    const { initDB, BotAgent, ClosingPattern, ClosingAnalytic } = require(path.join(rootDir, 'src', 'database', 'index'));
    await initDB();
    console.log('✅ Database terhubung dan model siap.\n');

    // Parse argument --agent-id jika ada
    const agentArg = process.argv.find(a => a.startsWith('--agent-id='));
    let agentId = agentArg ? parseInt(agentArg.split('=')[1]) : null;

    // Auto-detect agent ID jika tidak diisi
    if (!agentId) {
        const firstAgent = await BotAgent.findOne({ order: [['id', 'ASC']] });
        if (firstAgent) {
            agentId = firstAgent.id;
            console.log(`ℹ️  Agent ID tidak diisi. Menggunakan Agent pertama: [${agentId}] ${firstAgent.name || firstAgent.bot_name}`);
        } else {
            console.log('⚠️  Tidak ada Agent ditemukan di database. Pattern akan disimpan tanpa agent_id.');
        }
    }

    // Daftar dataset files
    const datasetsDir = path.join(rootDir, 'docs', 'datasets');
    const datasetFiles = [
        'dtf_baju_closing_01.txt',
        'dtf_baju_closing_02.txt',
        'dtf_baju_closing_03.txt',
        'dtf_baju_closing_04.txt',
        'uv_dtf_closing_01.txt',
        'uv_dtf_closing_02.txt',
        'uv_dtf_closing_03.txt',
        'uv_dtf_closing_04.txt'
    ].filter(f => {
        const fullPath = path.join(datasetsDir, f);
        if (!fs.existsSync(fullPath)) {
            console.log(`⚠️  File tidak ditemukan: ${f} — dilewati`);
            return false;
        }
        return true;
    });

    if (datasetFiles.length === 0) {
        console.error('❌ Tidak ada file dataset yang ditemukan di docs/datasets/');
        process.exit(1);
    }

    console.log(`\n📁 Dataset yang akan diproses: ${datasetFiles.length} file`);
    console.log(datasetFiles.map(f => `   • ${f}`).join('\n'));
    console.log('\n🔍 Mulai analisis... (ini akan memanggil OpenAI, butuh beberapa menit)\n');

    // Load learning service
    const { processDatasetFile } = require(path.join(rootDir, 'src', 'services', 'learning_service'));

    let successCount = 0;
    let failCount = 0;

    for (const fileName of datasetFiles) {
        const filePath = path.join(datasetsDir, fileName);
        console.log(`\n[${datasetFiles.indexOf(fileName) + 1}/${datasetFiles.length}] 📂 ${fileName}`);

        const result = await processDatasetFile(filePath, agentId);

        if (result.success) {
            console.log(`   ✅ Berhasil diproses`);
            successCount++;
        } else {
            console.log(`   ❌ Gagal: ${result.error}`);
            failCount++;
        }

        // Delay 2 detik antar file agar tidak rate limit OpenAI
        if (datasetFiles.indexOf(fileName) < datasetFiles.length - 1) {
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 RINGKASAN HASIL SEED:\n');
    console.log(`   ✅ Berhasil: ${successCount} file`);
    console.log(`   ❌ Gagal   : ${failCount} file`);

    // Tampilkan hasil patterns yang tersimpan
    const patterns = await ClosingPattern.findAll({
        where: agentId ? { agent_id: agentId } : {},
        order: [['confidence', 'DESC'], ['frequency', 'DESC']],
        limit: 20
    });

    console.log(`\n🏆 TOP PATTERNS YANG TERSIMPAN (${patterns.length} total):\n`);
    patterns.forEach((p, i) => {
        const conf = Math.round((p.confidence || 0.5) * 100);
        console.log(`${i + 1}. [${p.product_type?.toUpperCase()}] ${p.teknik}`);
        console.log(`   Freq: ${p.frequency}x | Conf: ${conf}%`);
        console.log(`   Contoh: "${(p.contoh_kalimat || '').slice(0, 80)}..."`);
        console.log();
    });

    const analytics = await ClosingAnalytic.count({
        where: agentId ? { agent_id: agentId } : {}
    });
    console.log(`📈 Total analitik closing tersimpan: ${analytics}`);
    console.log('\n✨ Selesai! Bot sekarang sudah memiliki pengetahuan dari percakapan nyata.\n');

    process.exit(0);
}

main().catch(err => {
    console.error('❌ Error fatal:', err.message);
    console.error(err.stack);
    process.exit(1);
});
