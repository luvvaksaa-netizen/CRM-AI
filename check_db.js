const { initDB, Store } = require('./src/database/index');
async function check() {
  await initDB();
  const stores = await Store.findAll();
  console.log(JSON.stringify(stores, null, 2));
  process.exit(0);
}
check();
