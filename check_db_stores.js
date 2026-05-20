const { Store, BotAgent, initDB } = require('./src/database/index');

async function run() {
    await initDB();
    const stores = await Store.findAll({ include: [{ model: BotAgent, as: 'BotAgent' }] });
    console.log("=== DIAGNOSE STORES ===");
    for (const store of stores) {
        console.log(`Store Name: ${store.name}`);
        console.log(`wa_id: ${store.wa_id}`);
        console.log(`agent_id: ${store.agent_id}`);
        console.log(`is_bot_active: ${store.is_bot_active} (Type: ${typeof store.is_bot_active})`);
        console.log(`Agent Name: ${store.BotAgent ? store.BotAgent.name : 'NONE'}`);
        console.log("------------------------");
    }
    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
