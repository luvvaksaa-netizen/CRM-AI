const { getShippingCost } = require('./src/services/mengantar_service');

async function run() {
    console.log("Testing getShippingCost...");
    const result = await getShippingCost("Tawangmangu", 1000);
    console.log("Result:\n" + result);
    
    console.log("\nTesting getShippingCost (Kalisoro)...");
    const result2 = await getShippingCost("Kalisoro", 2000);
    console.log("Result 2:\n" + result2);
}

run();
