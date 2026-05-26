const axios = require('axios');
const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NjY2YTI0MDVkNWM2MzRiY2JjMjEwNTAiLCJlbWFpbCI6InRva29zZXBlZGExM0BnbWFpbC5jb20iLCJ2aXNpdG9ySWQiOiIiLCJ0d29GYWN0b3JBdXRoZW50aWNhdGVkIjp0cnVlLCJ0dGlkIjoiIiwiaWF0IjoxNzc5NzA5MTg3LCJleHAiOjE3ODAzMTM5ODd9.A15IJVnoEv1X-V6jUW89UQU5wSY1JPkwkJzvWPeVnOA";

async function test() {
    const url = 'https://api-public.mengantar.com/api/order/allEstimateMultipleOrigin';
    const payload = {
        origin_id: "5fc633fef8f44b34aa4c4f47", // Pare
        destination_id: "5fc64161f8f44b34aa4cbbb7", // Kalisoro
        weight: "2",
        COD_AMOUNT: "0"
    };

    try {
        const res = await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = res.data.data;
        if (data.JNE) {
            console.log("JNE:");
            console.log(" - Base Price:", data.JNE.price || data.JNE.estimatedPrice);
            console.log(" - Discount:", data.JNE.discount || data.JNE.estimatedDiscount);
            console.log(" - Final Total:", data.JNE.total || (data.JNE.price - data.JNE.discount));
            console.log(" - Raw:", data.JNE);
        }
        
        if (data.JT) {
            console.log("\nJT:");
            console.log(" - Base Price:", data.JT.price || data.JT.estimatedPrice);
            console.log(" - Discount:", data.JT.discount || data.JT.estimatedDiscount);
            console.log(" - Final Total:", data.JT.total || (data.JT.price - data.JT.discount));
            console.log(" - Raw:", data.JT);
        }
    } catch (e) {
        console.log(`[FAIL] ${e.response?.status} ${JSON.stringify(e.response?.data)}`);
    }
}
test();
