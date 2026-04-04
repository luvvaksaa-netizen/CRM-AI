const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(process.cwd(), 'data', 'database.sqlite'),
  logging: false
});

const MediaAsset = sequelize.define('MediaAsset', {
  agent_id: DataTypes.INTEGER,
  label: DataTypes.STRING,
  type: DataTypes.STRING
});

async function check() {
  await sequelize.authenticate();
  const assets = await MediaAsset.findAll();
  console.log('--- MEDIA ASSETS ---');
  assets.forEach(a => console.log(`ID: ${a.id} | Agent: ${a.agent_id} | Label: ${a.label}`));
}

check().catch(e => console.error(e));
