const axios = require('axios');

async function test() {
    const url = 'https://api-public.mengantar.com/api/address/autofill?keyword=pare';
    try {
        const res = await axios.get(url);
        const data = res.data.data;
        const pare = data.find(d => d.CITY_NAME === 'KEDIRI' && d.DISTRICT_NAME === 'PARE' && d.SUBDISTRICT_NAME === 'PARE');
        if (pare) {
            console.log("[FOUND PARE]", pare._id, pare.CITY_NAME, pare.DISTRICT_NAME, pare.SUBDISTRICT_NAME);
        } else {
            console.log("[NOT FOUND] Available:", data.map(d => `${d.CITY_NAME}, ${d.DISTRICT_NAME}, ${d.SUBDISTRICT_NAME}`).slice(0, 5));
        }
    } catch (e) {
        console.log(`[FAIL] ${url} -> ${e.message}`);
    }
}
test();
