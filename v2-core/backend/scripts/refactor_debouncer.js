const fs = require('fs');
const path = require('path');

const targetFile = path.resolve(__dirname, '../src/events/message_handler.js');
let content = fs.readFileSync(targetFile, 'utf8');

if (!content.includes("const { debouncerDB }")) {
    // Add import
    content = content.replace("const logger = require('../utils/logger');", "const logger = require('../utils/logger');\nconst { debouncerDB } = require('../services/debouncer.service');");
}

// Save to DB
const saveStr = `buffer.senderName = senderName;
        buffer.lastMessage = message;`;
const saveReplacement = `buffer.senderName = senderName;
        buffer.lastMessage = message;

        debouncerDB.saveBatch(storeWaId, contactId, buffer.messages, buffer.mediaContexts, buffer.tempPaths, buffer.senderName).catch(err => logger.error('[Debouncer] Save failed:', err.message));`;

if (!content.includes("debouncerDB.saveBatch")) {
    content = content.replace(saveStr, saveReplacement);
}

// Delete from DB
const deleteStr = `const batch = pendingMessages.get(debounceKey);
            pendingMessages.delete(debounceKey);`;
const deleteReplacement = `const batch = pendingMessages.get(debounceKey);
            pendingMessages.delete(debounceKey);
            debouncerDB.deleteBatch(storeWaId, contactId).catch(err => logger.error('[Debouncer] Delete failed:', err.message));`;

if (!content.includes("debouncerDB.deleteBatch")) {
    content = content.replace(deleteStr, deleteReplacement);
}

// Restore logic
const restoreStr = `module.exports = {
    handleIncomingMessage,
    // (internal methods exposed for testing)`

const restoreFunc = `async function restorePendingBatches() {
    try {
        const batches = await debouncerDB.loadAllBatches();
        for (const batch of batches) {
            logger.info(\`[Debouncer] Restoring pending batch for \${batch.contactId}\`);
            _processAIReply(batch.storeWaId, batch.contactId, {
                messages: batch.messages,
                mediaContexts: batch.mediaContexts,
                tempPaths: batch.tempPaths,
                senderName: batch.senderName,
                lastMessage: null // Lost across restart
            }).catch(e => logger.error('Restore error:', e.message));
            debouncerDB.deleteBatch(batch.storeWaId, batch.contactId);
        }
    } catch (e) {
        logger.error('[Debouncer] Failed to restore:', e.message);
    }
}
setTimeout(restorePendingBatches, 5000); // run shortly after startup

`;

if (!content.includes("restorePendingBatches")) {
    content = content.replace("module.exports = {", restoreFunc + "\nmodule.exports = {");
}

fs.writeFileSync(targetFile, content);
console.log("Refactored message_handler.js successfully!");
