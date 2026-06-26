require('dotenv').config({ path: __dirname + '/../../../.env' });
require('dotenv').config(); // Fallback to current dir
const { ChatSummary } = require("../models/index");
const { Op } = require("sequelize");

async function run() {
  console.log("Starting DB label cleanup...");
  const ALLOWED = new Set(["closing", "transfer", "cod"]);
  
  try {
    const records = await ChatSummary.findAll({
      where: {
        wa_labels: {
          [Op.not]: null,
          [Op.not]: "[]"
        }
      }
    });

    let modifiedCount = 0;

    for (const record of records) {
      try {
        const labels = JSON.parse(record.wa_labels || "[]");
        if (labels.length === 0) continue;

        const filtered = labels.filter((l) => ALLOWED.has(String(l).toLowerCase()));
        
        if (filtered.length !== labels.length) {
          record.wa_labels = JSON.stringify(filtered);
          
          // Also clean up label_timestamps
          try {
            const timestamps = JSON.parse(record.label_timestamps || "{}");
            const newTimestamps = {};
            for (const key of Object.keys(timestamps)) {
              if (ALLOWED.has(key.toLowerCase())) {
                newTimestamps[key] = timestamps[key];
              }
            }
            record.label_timestamps = JSON.stringify(newTimestamps);
          } catch (e) {
            console.error("Error parsing timestamps for", record.contact_id);
          }

          await record.save();
          modifiedCount++;
          console.log(`Cleaned labels for contact: ${record.contact_id} (Before: ${labels.length}, After: ${filtered.length})`);
        }
      } catch (err) {
        console.error(`Error parsing labels for contact ${record.contact_id}:`, err.message);
      }
    }

    console.log(`\n🎉 Cleanup complete! Modified ${modifiedCount} chats.`);
    process.exit(0);
  } catch (err) {
    console.error("Cleanup failed:", err);
    process.exit(1);
  }
}

run();
