const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database-production.sqlite');

db.all('SELECT id, name, product_knowledge FROM BotAgents', (err, rows) => {
  if (err) throw err;
  let count = 0;
  
  rows.forEach(row => {
    if (!row.product_knowledge) return;
    
    let pk = row.product_knowledge;
    let modified = false;
    
    // Fix bundling media label
    if (pk.includes('Paket Bundling Back to School')) {
        pk = pk.replace(/"Paket Bundling Back to School"/g, '"bundling upsell"');
        modified = true;
    }
    
    // Fix upsell instruction to prevent it from being offered on "ongkir" complaints
    if (pk.includes('Tawarkan HANYA SEKALI setelah customer konfirmasi pesan utama.')) {
        pk = pk.replace(
            /Tawarkan HANYA SEKALI setelah customer konfirmasi pesan utama\./g, 
            'Tawarkan HANYA SEKALI SETELAH customer MENGONFIRMASI/DEAL pesanan utama. JANGAN PERNAH tawarkan promo ini hanya karena customer bertanya/keberatan tentang ongkir! Promo ini murni UPSELL di akhir.'
        );
        modified = true;
    }
    
    if (modified) {
        db.run('UPDATE BotAgents SET product_knowledge = ? WHERE id = ?', [pk, row.id], (err2) => {
            if (err2) console.error(err2);
            else {
                console.log('Updated agent:', row.name);
                count++;
            }
        });
    }
  });
  
  setTimeout(() => {
    console.log('Done updating ' + count + ' agents.');
    db.close();
  }, 2000);
});
