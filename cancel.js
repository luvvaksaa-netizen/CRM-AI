const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/database.sqlite', (err) => {
    if (err) {
        console.error("Error opening database:", err.message);
        process.exit(1);
    }
    
    db.run("UPDATE FollowUps SET status = 'cancelled', cancel_reason = 'Emergency cancel by system' WHERE status = 'pending'", function(err) {
        if (err) {
            console.error("Error updating:", err.message);
        } else {
            console.log(`Row(s) updated: ${this.changes}`);
        }
        db.close();
    });
});
