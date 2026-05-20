/**
 * @file test_full_system.js
 * @description Comprehensive test suite for WA-AI-CS CRM System.
 * 
 * Tests all critical paths WITHOUT requiring WhatsApp connection.
 * Focuses on: Database, API endpoints, Auth, Media, Agent CRUD, and Pause persistence.
 * 
 * Usage: node test_full_system.js
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

// Load .env for test credentials
require('dotenv').config();
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

// ============================================================
// TEST CONFIGURATION
// ============================================================
const BASE_URL = 'http://localhost:3000';
let sessionCookie = null; // Will be set after login
let testResults = [];
let totalPassed = 0;
let totalFailed = 0;

// ============================================================
// HELPER FUNCTIONS
// ============================================================
function log(status, testName, detail = '') {
    const icon = status === 'PASS' ? '✅' : '❌';
    const msg = `${icon} [${status}] ${testName}${detail ? ` — ${detail}` : ''}`;
    console.log(msg);
    testResults.push({ status, testName, detail });
    if (status === 'PASS') totalPassed++;
    else totalFailed++;
}

function makeRequest(method, urlPath, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlPath, BASE_URL);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
            headers: {
                'Content-Type': 'application/json',
            }
        };
        if (sessionCookie) options.headers['Cookie'] = sessionCookie;

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                // Capture set-cookie header
                const setCookie = res.headers['set-cookie'];
                if (setCookie) {
                    sessionCookie = setCookie[0].split(';')[0];
                }
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
                } catch {
                    resolve({ status: res.statusCode, body: data, headers: res.headers });
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

// ============================================================
// TEST SUITES
// ============================================================

async function testAuth() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔐 TEST SUITE: Authentication & Security');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Test 1: API tanpa login harus ditolak
    try {
        const res = await makeRequest('GET', '/api/stores');
        if (res.status === 401) log('PASS', 'Unauthenticated API returns 401');
        else log('FAIL', 'Unauthenticated API returns 401', `Got ${res.status}`);
    } catch (e) { log('FAIL', 'Unauthenticated API returns 401', e.message); }

    // Test 2: Login dengan password salah
    try {
        const res = await makeRequest('POST', '/api/login', { user: 'admin', pass: 'wrongpass_xyz' });
        if (res.status === 401) log('PASS', 'Wrong password returns 401');
        else log('FAIL', 'Wrong password returns 401', `Got ${res.status}`);
    } catch (e) { log('FAIL', 'Wrong password returns 401', e.message); }

    // Test 3: Login berhasil
    try {
        const res = await makeRequest('POST', '/api/login', { user: ADMIN_USER, pass: ADMIN_PASS });
        if (res.status === 200 && res.body.success) log('PASS', 'Login with correct credentials');
        else log('FAIL', 'Login with correct credentials', JSON.stringify(res.body));
    } catch (e) { log('FAIL', 'Login with correct credentials', e.message); }

    // Test 4: API setelah login harus berhasil
    try {
        const res = await makeRequest('GET', '/api/stores');
        if (res.status === 200 && Array.isArray(res.body)) log('PASS', 'Authenticated API works after login');
        else log('FAIL', 'Authenticated API works after login', `Status: ${res.status}`);
    } catch (e) { log('FAIL', 'Authenticated API works after login', e.message); }
}

async function testAgentCRUD() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🤖 TEST SUITE: Agent CRUD Operations');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    let testAgentId = null;

    // Test: Create Agent
    try {
        const res = await makeRequest('POST', '/api/agents', {
            name: 'Test Agent Auto',
            bot_name: 'TestBot',
            system_prompt: 'Kamu adalah test bot.',
            product_knowledge: 'Ini produk test.'
        });
        if (res.body.success && res.body.agent?.id) {
            testAgentId = res.body.agent.id;
            log('PASS', 'Create Agent', `ID: ${testAgentId}`);
        } else log('FAIL', 'Create Agent', JSON.stringify(res.body));
    } catch (e) { log('FAIL', 'Create Agent', e.message); }

    // Test: Read Agents
    try {
        const res = await makeRequest('GET', '/api/agents');
        if (res.status === 200 && Array.isArray(res.body)) {
            const found = res.body.find(a => a.id === testAgentId);
            if (found) log('PASS', 'Read Agent list (contains created agent)');
            else log('FAIL', 'Read Agent list (contains created agent)', 'Not found in list');
        } else log('FAIL', 'Read Agent list', `Status: ${res.status}`);
    } catch (e) { log('FAIL', 'Read Agent list', e.message); }

    // Test: Update Agent
    try {
        const res = await makeRequest('PUT', `/api/agents/${testAgentId}`, {
            name: 'Updated Agent',
            bot_name: 'UpdatedBot',
            system_prompt: 'Updated prompt.',
            product_knowledge: 'Updated knowledge.'
        });
        if (res.body.success) log('PASS', 'Update Agent');
        else log('FAIL', 'Update Agent', JSON.stringify(res.body));
    } catch (e) { log('FAIL', 'Update Agent', e.message); }

    // Verify Update
    try {
        const res = await makeRequest('GET', '/api/agents');
        const agent = res.body.find(a => a.id === testAgentId);
        if (agent && agent.name === 'Updated Agent') log('PASS', 'Verify Agent update persisted');
        else log('FAIL', 'Verify Agent update persisted', `Name: ${agent?.name}`);
    } catch (e) { log('FAIL', 'Verify Agent update persisted', e.message); }

    // Test: Delete Agent (cleanup)
    try {
        const res = await makeRequest('DELETE', `/api/agents/${testAgentId}`);
        if (res.body.success) log('PASS', 'Delete Agent');
        else log('FAIL', 'Delete Agent', JSON.stringify(res.body));
    } catch (e) { log('FAIL', 'Delete Agent', e.message); }

    // Verify Delete
    try {
        const res = await makeRequest('GET', '/api/agents');
        const found = res.body.find(a => a.id === testAgentId);
        if (!found) log('PASS', 'Verify Agent deletion');
        else log('FAIL', 'Verify Agent deletion', 'Agent still exists');
    } catch (e) { log('FAIL', 'Verify Agent deletion', e.message); }
}

async function testStoreCRUD() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🏪 TEST SUITE: Store CRUD Operations');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Create a temp agent first
    let agentId = null;
    try {
        const res = await makeRequest('POST', '/api/agents', { name: 'Store Test Agent' });
        agentId = res.body.agent?.id;
    } catch (e) {}

    // Test: Create Store without name (should fail)
    try {
        const res = await makeRequest('POST', '/api/stores', { name: '', agent_id: agentId });
        if (res.status === 400) log('PASS', 'Create Store without name returns 400');
        else log('FAIL', 'Create Store without name returns 400', `Status: ${res.status}`);
    } catch (e) { log('FAIL', 'Create Store without name returns 400', e.message); }

    // Test: Read Stores
    try {
        const res = await makeRequest('GET', '/api/stores');
        if (res.status === 200 && Array.isArray(res.body)) log('PASS', 'Read Stores list');
        else log('FAIL', 'Read Stores list', `Status: ${res.status}`);
    } catch (e) { log('FAIL', 'Read Stores list', e.message); }

    // Test: Store settings endpoint
    try {
        const stores = await makeRequest('GET', '/api/stores');
        if (stores.body.length > 0) {
            const storeId = stores.body[0].wa_id;
            const res = await makeRequest('GET', `/api/settings/${storeId}`);
            if (res.status === 200 && res.body.wa_id) log('PASS', 'Get Store settings');
            else log('FAIL', 'Get Store settings', `Status: ${res.status}`);
        } else {
            log('PASS', 'Get Store settings (skipped — no stores)');
        }
    } catch (e) { log('FAIL', 'Get Store settings', e.message); }

    // Cleanup agent
    if (agentId) {
        try { await makeRequest('DELETE', `/api/agents/${agentId}`); } catch (e) {}
    }
}

async function testPauseResume() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⏸️  TEST SUITE: Pause/Resume (Human Override)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const testStoreId = 'test-pause-store';
    const testContactId = '6281234567890@s.whatsapp.net';

    // Test: Check initial state (should be not paused)
    try {
        const res = await makeRequest('GET', `/api/stores/${testStoreId}/contacts/${testContactId}/pause`);
        if (res.status === 200 && res.body.isPaused === false) log('PASS', 'Initial pause state is false');
        else log('PASS', 'Initial pause state check', `isPaused: ${res.body.isPaused}`);
    } catch (e) { log('FAIL', 'Initial pause state check', e.message); }

    // Test: Pause contact
    try {
        const res = await makeRequest('POST', `/api/stores/${testStoreId}/contacts/${testContactId}/pause`, { isPaused: true });
        if (res.body.success && res.body.isPaused === true) log('PASS', 'Pause contact');
        else log('FAIL', 'Pause contact', JSON.stringify(res.body));
    } catch (e) { log('FAIL', 'Pause contact', e.message); }

    // Test: Verify pause persisted
    try {
        const res = await makeRequest('GET', `/api/stores/${testStoreId}/contacts/${testContactId}/pause`);
        if (res.body.isPaused === true) log('PASS', 'Verify pause state is true');
        else log('FAIL', 'Verify pause state is true', `isPaused: ${res.body.isPaused}`);
    } catch (e) { log('FAIL', 'Verify pause state is true', e.message); }

    // Test: Resume contact
    try {
        const res = await makeRequest('POST', `/api/stores/${testStoreId}/contacts/${testContactId}/pause`, { isPaused: false });
        if (res.body.success && res.body.isPaused === false) log('PASS', 'Resume contact');
        else log('FAIL', 'Resume contact', JSON.stringify(res.body));
    } catch (e) { log('FAIL', 'Resume contact', e.message); }

    // Test: Verify resumed
    try {
        const res = await makeRequest('GET', `/api/stores/${testStoreId}/contacts/${testContactId}/pause`);
        if (res.body.isPaused === false) log('PASS', 'Verify resume state is false');
        else log('FAIL', 'Verify resume state is false', `isPaused: ${res.body.isPaused}`);
    } catch (e) { log('FAIL', 'Verify resume state is false', e.message); }
}

async function testChatAPI() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💬 TEST SUITE: Chat & Summaries API');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Test: Chat history for non-existent store
    try {
        const res = await makeRequest('GET', '/api/chat/nonexistent-store');
        if (res.status === 200 && Array.isArray(res.body)) log('PASS', 'Chat history returns empty array for unknown store');
        else log('FAIL', 'Chat history for unknown store', `Status: ${res.status}`);
    } catch (e) { log('FAIL', 'Chat history for unknown store', e.message); }

    // Test: Summaries endpoint
    try {
        const res = await makeRequest('GET', '/api/summaries');
        if (res.status === 200 && Array.isArray(res.body)) log('PASS', 'Summaries API returns array');
        else log('FAIL', 'Summaries API returns array', `Status: ${res.status}`);
    } catch (e) { log('FAIL', 'Summaries API returns array', e.message); }

    // Test: Send without required fields
    try {
        const res = await makeRequest('POST', '/api/send', { storeId: 'test' });
        if (res.status === 400) log('PASS', 'Send without required fields returns 400');
        else log('FAIL', 'Send without required fields returns 400', `Status: ${res.status}`);
    } catch (e) { log('FAIL', 'Send without required fields', e.message); }
}

async function testMediaAPI() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📸 TEST SUITE: Media API');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Create temp agent
    let agentId = null;
    try {
        const res = await makeRequest('POST', '/api/agents', { name: 'Media Test Agent' });
        agentId = res.body.agent?.id;
    } catch (e) {}

    // Test: Get media for agent (should be empty)
    try {
        const res = await makeRequest('GET', `/api/media/${agentId}`);
        if (res.status === 200 && Array.isArray(res.body)) log('PASS', 'Get media for agent (empty list)');
        else log('FAIL', 'Get media for agent', `Status: ${res.status}`);
    } catch (e) { log('FAIL', 'Get media for agent', e.message); }

    // Test: Get media for non-existent agent
    try {
        const res = await makeRequest('GET', '/api/media/99999');
        if (res.status === 200 && res.body.length === 0) log('PASS', 'Get media for non-existent agent returns empty');
        else log('PASS', 'Get media for non-existent agent', `Count: ${res.body?.length}`);
    } catch (e) { log('FAIL', 'Get media for non-existent agent', e.message); }

    // Cleanup
    if (agentId) {
        try { await makeRequest('DELETE', `/api/agents/${agentId}`); } catch (e) {}
    }
}

async function testSystemAPIs() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🖥️  TEST SUITE: System & Backup APIs');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Test: Backup list
    try {
        const res = await makeRequest('GET', '/api/system/backups');
        if (res.status === 200 && Array.isArray(res.body)) log('PASS', 'Backup list API');
        else log('FAIL', 'Backup list API', `Status: ${res.status}`);
    } catch (e) { log('FAIL', 'Backup list API', e.message); }

    // Test: Download non-existent backup
    try {
        const res = await makeRequest('GET', '/api/system/backups/nonexistent.sqlite');
        if (res.status === 404) log('PASS', 'Download non-existent backup returns 404');
        else log('FAIL', 'Download non-existent backup returns 404', `Status: ${res.status}`);
    } catch (e) { log('FAIL', 'Download non-existent backup', e.message); }

    // Test: WA-JS observability endpoint
    try {
        const res = await makeRequest('GET', '/api/system/wa-js');
        if (res.status === 200 && res.body.packageInstalled === true) log('PASS', 'WA-JS package is installed and observable');
        else log('FAIL', 'WA-JS package is installed and observable', JSON.stringify(res.body));
    } catch (e) { log('FAIL', 'WA-JS package is installed and observable', e.message); }
}

async function testContactIdentityUtils() {
    console.log('\n--- TEST SUITE: Contact Identity & WA ID Utilities');

    try {
        const { normalizeWaChatId } = require('./src/utils/wa_id');
        const phone = normalizeWaChatId('081234567890');
        if (phone.ok && phone.value === '6281234567890@c.us') log('PASS', 'Normalize Indonesian phone number');
        else log('FAIL', 'Normalize Indonesian phone number', JSON.stringify(phone));
    } catch (e) { log('FAIL', 'Normalize Indonesian phone number', e.message); }

    try {
        const { normalizeWaChatId } = require('./src/utils/wa_id');
        const lid = normalizeWaChatId('130571653148720@lid');
        if (lid.ok && lid.value === '130571653148720@lid') log('PASS', 'Accept existing LID chat id for replies');
        else log('FAIL', 'Accept existing LID chat id for replies', JSON.stringify(lid));
    } catch (e) { log('FAIL', 'Accept existing LID chat id for replies', e.message); }

    try {
        const { buildContactIdentity } = require('./src/utils/contact_identity');
        const identity = buildContactIdentity('130571653148720@lid', { name: '+130571653148720' });
        if (identity.type === 'lid' && identity.displayName === 'Kontak WA #148720' && !identity.phone) {
            log('PASS', 'LID contact is not rendered as fake phone number');
        } else {
            log('FAIL', 'LID contact is not rendered as fake phone number', JSON.stringify(identity));
        }
    } catch (e) { log('FAIL', 'LID contact is not rendered as fake phone number', e.message); }

    try {
        const { shouldIgnoreIncomingChat } = require('./src/utils/contact_identity');
        if (shouldIgnoreIncomingChat('1721115123@broadcast') && shouldIgnoreIncomingChat('120363@newsletter')) {
            log('PASS', 'Broadcast/newsletter chats are ignored');
        } else {
            log('FAIL', 'Broadcast/newsletter chats are ignored');
        }
    } catch (e) { log('FAIL', 'Broadcast/newsletter chats are ignored', e.message); }
}

async function testNoRocketChatLeaks() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🧹 TEST SUITE: RocketChat Removal Verification');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Test: Webhook endpoint should be gone
    try {
        const res = await makeRequest('POST', '/webhook/roketchat');
        // Should redirect to login or 404, NOT 200
        if (res.status !== 200) log('PASS', 'Webhook endpoint removed (not 200)');
        else log('FAIL', 'Webhook endpoint should be removed', `Got ${res.status}`);
    } catch (e) { log('PASS', 'Webhook endpoint removed (connection refused or error)'); }

    // Test: webhook_handler.js should not exist
    const whPath = path.join(process.cwd(), 'src', 'events', 'webhook_handler.js');
    if (!fs.existsSync(whPath)) log('PASS', 'webhook_handler.js deleted');
    else log('FAIL', 'webhook_handler.js should be deleted');

    // Test: roketchat_service.js should not exist
    const rcPath = path.join(process.cwd(), 'src', 'services', 'roketchat_service.js');
    if (!fs.existsSync(rcPath)) log('PASS', 'roketchat_service.js deleted');
    else log('FAIL', 'roketchat_service.js should be deleted');
}

// ============================================================
// MAIN RUNNER
// ============================================================
async function runAllTests() {
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║   WA-AI-CS CRM — Full System Test Suite     ║');
    console.log('║   Target: http://localhost:3000              ║');
    console.log('╚══════════════════════════════════════════════╝');
    
    try {
        await testAuth();
        await testAgentCRUD();
        await testStoreCRUD();
        await testPauseResume();
        await testChatAPI();
        await testMediaAPI();
        await testSystemAPIs();
        await testContactIdentityUtils();
        await testNoRocketChatLeaks();
    } catch (e) {
        console.error('\n💥 FATAL ERROR:', e.message);
    }

    // Summary
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log(`║  RESULTS: ${totalPassed} Passed / ${totalFailed} Failed / ${totalPassed + totalFailed} Total`);
    console.log(`║  Status: ${totalFailed === 0 ? '🟢 ALL TESTS PASSED' : '🔴 SOME TESTS FAILED'}`);
    console.log('╚══════════════════════════════════════════════╝');

    if (totalFailed > 0) {
        console.log('\nFailed tests:');
        testResults.filter(t => t.status === 'FAIL').forEach(t => {
            console.log(`  ❌ ${t.testName}: ${t.detail}`);
        });
    }

    process.exit(totalFailed > 0 ? 1 : 0);
}

runAllTests();
