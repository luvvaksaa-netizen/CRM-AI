/**
 * @file test_ai.js
 * @description Simple test to verify Gemini AI connection and response.
 */

const { getAIResponse } = require('../src/ai_service');
const logger = require('../src/utils/logger');

async function testAI() {
    logger.info('Mengetes koneksi ke DeepSeek/OpenAI AI...');
    try {
        const response = await getAIResponse('Halo, apakah kamu bisa membantu saya?');
        logger.success('Respons dari AI diterima:');
        console.log('-----------------------------------');
        console.log(response);
        console.log('-----------------------------------');
        logger.success('Tes AI Berhasil! ✅');
    } catch (error) {
        logger.error(`Tes AI Gagal ❌: ${error.message}`);
    }
}

testAI();
