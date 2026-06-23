const fs = require('fs');
const path = require('path');

const targetFile = path.resolve(__dirname, '../src/ai_service.js');
let content = fs.readFileSync(targetFile, 'utf8');

const startStr = `                    if (toolCall.function.name === 'cek_ongkir') {`;
const endStr = `                    if (toolCall.function.name === 'kirim_media_katalog') {`;

const startIndex = content.indexOf(startStr);
const endIndex = content.indexOf(endStr);

if (startIndex === -1 || endIndex === -1) {
    console.error("Tokens not found!");
    process.exit(1);
}

const replacement = `                    if (toolCall.function.name !== 'kirim_media_katalog') {
                        const { executeTool } = require('./services/tool_executor');
                        const result = await executeTool(toolCall, store, customerPhone, history, agent);
                        if (result) {
                            messages.push({ tool_call_id: toolCall.id, role: "tool", name: result.name, content: result.content });
                            if (result.needsSecondCall) needsSecondCall = true;
                        }
                        continue;
                    }

`;

content = content.substring(0, startIndex) + replacement + content.substring(endIndex);

fs.writeFileSync(targetFile, content);
console.log("Refactored ai_service.js successfully!");
