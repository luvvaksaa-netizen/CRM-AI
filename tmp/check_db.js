const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(process.cwd(), 'data', 'database.sqlite'),
  logging: false
});

const BotAgent = sequelize.define('BotAgent', {
  name: DataTypes.STRING,
  bot_name: DataTypes.STRING,
  system_prompt: DataTypes.TEXT,
  product_knowledge: DataTypes.TEXT
});

async function check() {
  await sequelize.authenticate();
  const agents = await BotAgent.findAll();
  console.log('--- SCANNING AGENTS FOR FAKE LINKS ---');
  agents.forEach(a => {
      const p = a.system_prompt || '';
      const k = a.product_knowledge || '';
      if (p.includes('example.com') || k.includes('example.com') || p.includes('![Gambar')) {
          console.log(`[ALERT] Agent ID ${a.id} [${a.name}] contains hallucination-prone links!`);
          console.log(`--- PROMPT SNIPPET ---`);
          console.log(p);
      }
  });
}

check().catch(e => console.error(e));
