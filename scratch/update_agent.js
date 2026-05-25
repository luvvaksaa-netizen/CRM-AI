const fs = require('fs');
const path = require('path');
const { BotAgent } = require('../src/database/index');

async function updateAgent() {
    try {
        const mdPath = path.join(__dirname, '../docs/17_MASTER_AGENT_PROMPT_ARAHAN_OWNER.md');
        const content = fs.readFileSync(mdPath, 'utf8');
        
        const startString = '🎯 System Prompt (Kepribadian & Alur)';
        const dtfStartIdx = content.indexOf(startString);
        if (dtfStartIdx === -1) throw new Error("Could not find startString");
        
        const backtickStart = content.indexOf('```', dtfStartIdx) + 3;
        const backtickEnd = content.indexOf('```', backtickStart);
        
        const systemPrompt = content.substring(backtickStart, backtickEnd).trim();
        
        const agent = await BotAgent.findByPk(1);
        if (agent) {
            await agent.update({ system_prompt: systemPrompt });
            console.log('✅ System Prompt for Agent 1 (DTF) successfully updated in Database!');
        } else {
            console.log('❌ Agent 1 not found in Database.');
        }
    } catch (e) {
        console.error('Error updating agent:', e);
    }
}

updateAgent();
