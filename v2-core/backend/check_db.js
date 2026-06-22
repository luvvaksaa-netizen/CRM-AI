const sqlite3 = require('sqlite3').verbose();
const path = 'D:/CRM-AI/data/database.sqlite';
const db = new sqlite3.Database(path);

db.serialize(() => {
    db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, rows) => {
        if (err) {
            console.error('Error:', err.message);
        } else {
            console.log('Tables:', rows.map(r => r.name).join(', '));
        }
    });
});
