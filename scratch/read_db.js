const { Store } = require('./src/database/index');
async function run() {
  const stores = await Store.findAll();
  console.log(JSON.stringify(stores.map(s => ({ 
    name: s.name, 
    wa_id: s.wa_id, 
    roketchat_device_id: s.roketchat_device_id 
  })), null, 2));
  process.exit();
}
run();
