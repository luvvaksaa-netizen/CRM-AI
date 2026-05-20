const { Store, initDB } = require('./src/database/index');

async function run() {
    await initDB();
    const store = await Store.findOne({ where: { wa_id: 'dhea-6466' } });
    if (store) {
        store.is_bot_active = true;
        await store.save();
        console.log(`[SUCCESS] Bot status for ${store.name} (${store.wa_id}) is now active!`);
    } else {
        console.log(`[ERROR] Store dhea-6466 not found!`);
    }
    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
