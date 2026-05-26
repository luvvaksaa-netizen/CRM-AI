const axios = require('axios');

async function test() {
    const url = 'https://api-public.mengantar.com/api/order/allEstimatePublic?origin_id=5fc633fef8f44b34aa4c4f47&destination_id=5fc64161f8f44b34aa4cbbb7&weight=2&COD_AMOUNT=0';
    try {
        const res = await axios.get(url);
        const data = res.data.data;
        if (data.JNE) {
            console.log("JNE Public:");
            console.log(" - Base Price:", data.JNE.price || data.JNE.estimatedPrice);
            console.log(" - Discount:", data.JNE.discount || data.JNE.estimatedDiscount);
            console.log(" - Final:", data.JNE.total || (data.JNE.price - data.JNE.discount));
            console.log(data.JNE);
        }
        if (data.JT) {
            console.log("\nJT Public:");
            console.log(" - Base Price:", data.JT.price || data.JT.estimatedPrice);
            console.log(" - Discount:", data.JT.discount || data.JT.estimatedDiscount);
            console.log(" - Final:", data.JT.total || (data.JT.price - data.JT.discount));
            console.log(data.JT);
        }
    } catch (e) {
        console.log(`[FAIL] ${e.response?.status}`);
    }
}
test();
