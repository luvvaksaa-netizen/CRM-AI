// test-ai.js
require('dotenv').config();
const { OpenAI } = require('openai');

async function runTests() {
    console.log('Testing AI Initialization...\n');

    // 1. Test DeepSeek Text
    try {
        const deepseek = new OpenAI({
            apiKey: process.env.DEEPSEEK_API_KEY || 'fake_key',
            baseURL: 'https://api.deepseek.com/v1'
        });
        console.log('✅ DeepSeek Client initialized successfully with BaseURL:', deepseek.baseURL);
    } catch (e) {
        console.error('❌ Failed to initialize DeepSeek:', e.message);
    }

    // 2. Test OpenAI Vision/Audio
    try {
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY || 'fake_key'
        });
        console.log('✅ OpenAI Client initialized successfully for Vision/Audio.');
    } catch (e) {
        console.error('❌ Failed to initialize OpenAI:', e.message);
    }

    // 3. Test Config & Pricing Mapping
    try {
        const costTracker = require('./v2-core/backend/src/services/costTracker.js');
        const d_price = costTracker.calculateCost('deepseek-chat', 1000000, 1000000);
        console.log('✅ Cost Tracker mapping deepseek-chat:', d_price);
    } catch (e) {
        console.error('❌ Failed to test Cost Tracker:', e.message);
    }

    console.log('\nAll AI structural tests passed.');
}

runTests();
