const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'database.sqlite');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.error('❌ Gagal terhubung ke database:', err.message);
        process.exit(1);
    }
});

console.log("==========================================================");
console.log("🔍 AUDIT DIAGNOSTIK AI & CRM PRODUCTION");
console.log("==========================================================\n");

const auditReport = {};

db.serialize(() => {
    // 1. Cek Status Pola Learning (Active vs Inactive)
    db.all("SELECT is_active, COUNT(*) as count FROM ClosingPatterns GROUP BY is_active", (err, rows) => {
        auditReport.learning_status = rows;
        
        // 2. Ambil 3 Pola AKTIF teratas per Agent (apa yang sebenarnya dibaca AI sekarang)
        db.all(`
            SELECT agent_id, teknik, frequency, contoh_kalimat 
            FROM ClosingPatterns 
            WHERE is_active = 1 
            ORDER BY agent_id, frequency DESC
        `, (err, patternRows) => {
            // Kelompokkan per agent, ambil top 3
            const agentPatterns = {};
            patternRows.forEach(p => {
                if (!agentPatterns[p.agent_id]) agentPatterns[p.agent_id] = [];
                if (agentPatterns[p.agent_id].length < 3) {
                    agentPatterns[p.agent_id].push({
                        teknik: p.teknik,
                        contoh: p.contoh_kalimat.substring(0, 80) + '...' // Singkat agar rapi
                    });
                }
            });
            auditReport.top_active_patterns_per_agent = agentPatterns;

            // 3. Verifikasi Kebersihan ChatSummaries (Validasi data bodong)
            db.all("SELECT wa_labels, contact_name, summary FROM ChatSummaries WHERE wa_labels LIKE '%Closing%'", (err, summaryRows) => {
                let corruptedCount = 0;
                let cleanCount = 0;

                summaryRows.forEach(row => {
                    const s = (row.contact_name + ' ' + row.summary).toLowerCase();
                    if (s.includes('[nama]') || s.includes('nama: -') || s.includes('alamat: -') || s.includes('belum')) {
                        corruptedCount++;
                    } else {
                        cleanCount++;
                    }
                });

                auditReport.closing_data_integrity = {
                    total_closing_chats: summaryRows.length,
                    clean_valid_data: cleanCount,
                    still_corrupted: corruptedCount
                };

                // Output Hasil Audit
                console.log(JSON.stringify(auditReport, null, 2));
                console.log("\n✅ Audit Selesai! Tolong copy-paste seluruh output JSON di atas kepada AI Anda.");
                db.close();
            });
        });
    });
});
