const axios = require('axios');
const fs = require('fs');

async function extractEndpoints() {
    console.log("Fetching Mengantar HTML...");
    try {
        const { data: html } = await axios.get('https://app.mengantar.com');
        const scriptUrls = [...html.matchAll(/src="([^"]+\.js)"/g)].map(m => m[1]);
        
        console.log(`Found ${scriptUrls.length} JS files. Extracting...`);
        const endpoints = new Set();
        
        for (let url of scriptUrls) {
            if (url.startsWith('/')) url = 'https://app.mengantar.com' + url;
            try {
                const { data: js } = await axios.get(url);
                const matches = js.match(/\/api\/[a-zA-Z0-9./_-]+/g);
                if (matches) {
                    matches.forEach(m => endpoints.add(m));
                }
            } catch (e) {
                console.log("Failed to fetch JS:", url);
            }
        }
        
        console.log("\n=== FOUND API ENDPOINTS ===");
        const sorted = Array.from(endpoints).sort();
        sorted.forEach(ep => console.log(ep));
        fs.writeFileSync('mengantar_endpoints.txt', sorted.join('\n'));
        
    } catch (e) {
        console.error("Error:", e.message);
    }
}

extractEndpoints();
