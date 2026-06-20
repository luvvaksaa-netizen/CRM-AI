const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database-production.sqlite');

db.all('SELECT contact_id, wa_labels, summary FROM ChatSummaries WHERE wa_labels LIKE "%Menunggu Transfer%" OR wa_labels LIKE "%Closing%"', (err, rows) => {
    if (err) throw err;
    console.log('Found ' + rows.length + ' rows with Closing or Menunggu Transfer');
    
    let codAndMenungguTF = 0;
    let incompleteClosing = 0;
    
    for (const r of rows) {
        let isBad = false;
        try {
            const labelsStr = r.wa_labels || '[]';
            const labels = JSON.parse(labelsStr);
            const isMenungguTF = labels.includes('Menunggu Transfer');
            const isClosing = labels.includes('Closing');
            const summary = r.summary || '';
            const isCOD = summary.includes('METODE BAYAR: COD') || labels.includes('COD') || summary.includes('COD');
            
            if (isCOD && isMenungguTF) {
                codAndMenungguTF++;
                console.log('--- COD + Menunggu TF ---');
                console.log('ID:', r.contact_id);
                console.log('Labels:', labelsStr);
            }
            
            if ((isClosing || isMenungguTF) && (summary.includes('[') || summary.includes('belum'))) {
                incompleteClosing++;
                console.log('--- Incomplete Data in Funnel ---');
                console.log('ID:', r.contact_id);
                // console.log('Summary:', summary);
            }
        } catch(e) {}
    }
    console.log('\nTotal COD + Menunggu TF:', codAndMenungguTF);
    console.log('Total Incomplete Closing/TF:', incompleteClosing);
});
