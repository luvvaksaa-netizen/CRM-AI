const { getShippingCost } = require('./src/services/mengantar_service');

async function run() {
    const destinations = [
        "Denpasar Selatan",
        "Medan Maimun",
        "Tebet Jakarta Selatan",
        "Bandung Wetan"
    ];

    console.log("=== PENGUJIAN MENGANTAR SERVICE (ORIGIN: PARE) ===");
    for (const dest of destinations) {
        console.log(`\nMengetes Destinasi: ${dest} (1kg)`);
        const result = await getShippingCost(dest, 1000);
        console.log("Hasil:\n", result);
    }
}

run();
