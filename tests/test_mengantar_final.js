require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

async function runAllTests() {
  console.log('=== FINAL VERIFICATION TEST ===\n');
  let pass = 0, fail = 0;

  function ok(name, val) {
    if (val) { console.log('  \u2705', name); pass++; }
    else { console.log('  \u274c', name); fail++; }
  }

  // 1. ENV
  console.log('[1] Environment Variables:');
  ok('MENGANTAR_API_KEY', process.env.MENGANTAR_API_KEY === 'API-NSC3GCR0XJLHRN42');
  ok('MENGANTAR_ADDRESS_ID', !!process.env.MENGANTAR_ADDRESS_ID);
  ok('MENGANTAR_COURIER', process.env.MENGANTAR_COURIER === 'JT');
  ok('SCALEV_API_KEY', !!process.env.SCALEV_API_KEY);
  ok('SCALEV_STORE_UNIQUE_ID', !!process.env.SCALEV_STORE_UNIQUE_ID);
  ok('SCALEV_CUSTOM_VARIANT_ID', !!process.env.SCALEV_CUSTOM_VARIANT_ID);

  // 2. Legacy mengantar_service exports
  console.log('\n[2] Legacy mengantar_service.js exports:');
  const legSvc = require(path.join(ROOT, 'src/services/mengantar_service'));
  ok('getShippingCost', typeof legSvc.getShippingCost === 'function');
  ok('createOrder', typeof legSvc.createOrder === 'function');
  ok('getAddresses', typeof legSvc.getAddresses === 'function');
  ok('getAvailableTimes', typeof legSvc.getAvailableTimes === 'function');
  ok('formatResiMessage', typeof legSvc.formatResiMessage === 'function');
  ok('searchAddress', typeof legSvc.searchAddress === 'function');

  // 3. Legacy ai_service has buat_resi_mengantar
  console.log('\n[3] Legacy ai_service.js (resi tool sync):');
  const aiContent = fs.readFileSync(path.join(ROOT, 'src/ai_service.js'), 'utf8');
  ok('buat_resi_mengantar tool def (name:)', aiContent.includes('"buat_resi_mengantar"'));
  ok('buat_resi_mengantar handler (if name)', aiContent.includes("'buat_resi_mengantar'"));
  ok('mengantarService.createOrder call', aiContent.includes('mengantarService.createOrder'));
  ok('mengantarService.formatResiMessage call', aiContent.includes('mengantarService.formatResiMessage'));

  // 4. v2-core ai_service has buat_resi_mengantar
  console.log('\n[4] v2-core ai_service.js (resi tool sync):');
  const v2AiContent = fs.readFileSync(path.join(ROOT, 'v2-core/backend/src/ai_service.js'), 'utf8');
  ok('buat_resi_mengantar tool def', v2AiContent.includes('"buat_resi_mengantar"'));
  ok('buat_resi_mengantar handler', v2AiContent.includes("'buat_resi_mengantar'"));
  ok('mengantarService.createOrder v2', v2AiContent.includes('mengantarService.createOrder'));

  // 5. Mengantar API Live Test
  console.log('\n[5] Mengantar API Live Test:');
  const addrs = await legSvc.getAddresses();
  ok('getAddresses returns data', addrs.length >= 1);
  ok('default address ID correct', addrs.some(a => a._id === '686df175e63455b7eca24f22'));
  ok('Percetakan Jaya Sukses exists', addrs.some(a => a.PICKUP_NAME && a.PICKUP_NAME.includes('Jaya Sukses')));

  const dest = await legSvc.searchAddress('Mojoroto Kediri');
  ok('searchAddress works', !!dest && !!dest.id);
  ok('searchAddress has province', !!dest && !!dest.province);

  const cost = await legSvc.getShippingCost('Loceret, Nganjuk', 1000);
  ok('getShippingCost returns price text', cost.includes('Rp'));
  ok('getShippingCost has estimate', cost.includes('Estimasi'));

  // 6. formatResiMessage
  console.log('\n[6] formatResiMessage output:');
  const mockResult = { success: true, cnote_no: 'JT123456789', courier: 'JT', customer: 'Bunda Test', destination: 'MOJOROTO, KEDIRI', is_paid: true };
  const msg = legSvc.formatResiMessage(mockResult);
  ok('contains nomor resi', msg.includes('JT123456789'));
  ok('contains customer name', msg.includes('Bunda Test'));
  ok('contains thank you', msg.includes('Terima kasih'));
  ok('contains destination', msg.includes('MOJOROTO'));

  // 7. v2-core TypeScript compiled
  console.log('\n[7] v2-core TypeScript build:');
  ok('dist folder exists', fs.existsSync(path.join(ROOT, 'v2-core/backend/dist')));
  ok('mengantar.service.js compiled', fs.existsSync(path.join(ROOT, 'v2-core/backend/dist/services/mengantar.service.js')));
  const compiledContent = fs.readFileSync(path.join(ROOT, 'v2-core/backend/dist/services/mengantar.service.js'), 'utf8');
  ok('compiled has createOrder', compiledContent.includes('createOrder'));
  ok('compiled has formatResiMessage', compiledContent.includes('formatResiMessage'));

  // 8. .env files
  console.log('\n[8] Configuration Files:');
  const envContent = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  ok('.env has MENGANTAR_API_KEY', envContent.includes('MENGANTAR_API_KEY=API-NSC3GCR0XJLHRN42'));
  ok('.env has MENGANTAR_ADDRESS_ID', envContent.includes('MENGANTAR_ADDRESS_ID='));
  const v2EnvContent = fs.readFileSync(path.join(ROOT, 'v2-core/backend/.env'), 'utf8');
  ok('v2-core .env has MENGANTAR_API_KEY', v2EnvContent.includes('MENGANTAR_API_KEY='));

  console.log('\n' + '='.repeat(50));
  console.log('HASIL AKHIR: \u2705 PASSED:', pass, '| \u274c FAILED:', fail);
  if (fail === 0) console.log('\n\ud83c\udf89 SEMUA TEST LULUS — Sistem siap production!');
  else console.log('\n\u26a0\ufe0f  Ada', fail, 'test yang perlu diperbaiki.');
}

runAllTests().catch(e => { console.error('Test error:', e.message, e.stack); process.exit(1); });
