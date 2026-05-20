const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, 'data', 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.all("PRAGMA table_info(Stores)", (err, rows) => {
    if (err) {
        console.error("Error reading PRAGMA:", err);
    } else {
        const cols = rows.map(r => r.name);
        console.log("Stores columns:", cols);
        if (!cols.includes('is_bot_active')) {
            console.log("CRITICAL: is_bot_active column is MISSING in SQLite!");
        } else {
            console.log("OK: is_bot_active exists.");
        }
    }
});
