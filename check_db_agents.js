const { BotAgent, MediaAsset } = require('./src/database/index');

async function run() {
  const agents = await BotAgent.findAll();
  console.log('=== AGENTS ===');
  agents.forEach(a => {
    console.log(`ID: ${a.id}`);
    console.log(`Name: ${a.name}`);
    console.log(`Bot Name: ${a.bot_name}`);
    console.log(`Knowledge (snippet): ${a.product_knowledge.substring(0, 150)}...\n`);
  });

  const media = await MediaAsset.findAll();
  console.log('=== MEDIA ===');
  media.forEach(m => {
    console.log(`ID: ${m.id} | Agent ID: ${m.agent_id} | Label: ${m.label} | Purpose: ${m.purpose} | Trigger: ${m.trigger_words}`);
  });
  
  process.exit(0);
}

run().catch(console.error);
