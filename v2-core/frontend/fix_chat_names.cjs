/**
 * Fix 3 issues in ChatManagement.tsx:
 * 1. getDisplayName: show phone number when name is placeholder ("Kontak WA #xxxx")
 * 2. formatPhoneDisplay: show actual phone if contact_phone exists, remove "@lid" fallback text
 * 3. contact_id display: show phone instead of "LID (tap 📞 untuk resolve)"
 */

const fs = require('fs');
const file = 'd:/CRM-AI/v2-core/frontend/src/pages/ChatManagement.tsx';
let content = fs.readFileSync(file, 'utf8');
let changes = 0;

// ─── Fix 1: getDisplayName — prefer contact_phone when name is a placeholder ─
const oldGetDisplayName = `  const getDisplayName = (c: ChatContact | ChatMessage, fallbackId?: string) => {
    if ('contact_display_name' in c) {
      return c.contact_display_name || c.sender_name || c.contact_id;
    }
    return c.sender_name || fallbackId || 'Unknown';
  };`;

const newGetDisplayName = `  const getDisplayName = (c: ChatContact | ChatMessage, fallbackId?: string) => {
    if ('contact_display_name' in c) {
      const raw = c as ChatContact;
      const name = raw.contact_display_name || raw.sender_name || '';
      // Jika nama adalah placeholder generik (Kontak WA #xxx, dll), tampilkan nomor HP asli
      const isPlaceholder = !name || /^Kontak WA (#\\d+|Privat)?$/.test(name.trim()) || name.trim() === 'Kontak WhatsApp';
      if (isPlaceholder) {
        // Coba ambil dari contact_phone (sudah resolved) atau dari contact_id @c.us
        const phone = (raw as any).contact_phone;
        if (phone) return \`+\${phone}\`;
        if (raw.contact_id?.endsWith('@c.us')) return \`+\${raw.contact_id.replace('@c.us', '')}\`;
      }
      return name || raw.contact_id;
    }
    return c.sender_name || fallbackId || 'Unknown';
  };`;

if (content.includes(oldGetDisplayName)) {
  content = content.replace(oldGetDisplayName, newGetDisplayName);
  console.log('✅ Fix 1: getDisplayName updated');
  changes++;
} else {
  console.log('⚠️  Fix 1: getDisplayName target not found — check CRLF');
}

// ─── Fix 2: formatPhoneDisplay — replace "LID (tap 📞 untuk resolve)" ─────────
const oldFormatPhone = `  if (contactId.endsWith('@c.us')) return '+' + contactId.replace('@c.us', '');\r\n  if (contactId.endsWith('@lid')) return 'LID (tap \uD83D\uDCDE untuk resolve)';\r\n  return contactId;`;
const newFormatPhone = `  if (contactId.endsWith('@c.us')) return '+' + contactId.replace('@c.us', '');\r\n  if (contactId.endsWith('@lid')) {\r\n    // Ambil angka dari LID jika bisa — tampilkan sebagai ID pendek saja\r\n    const lidNum = contactId.replace('@lid', '').replace(/\\D/g, '');\r\n    return lidNum ? \`LID-\${lidNum.slice(-6)}\` : 'Nomor belum diketahui';\r\n  }\r\n  return contactId;`;

if (content.includes(oldFormatPhone)) {
  content = content.replace(oldFormatPhone, newFormatPhone);
  console.log('✅ Fix 2: formatPhoneDisplay updated');
  changes++;
} else {
  // Try without emoji unicode
  const altOld = `  if (contactId.endsWith('@c.us')) return '+' + contactId.replace('@c.us', '');\n  if (contactId.endsWith('@lid')) return 'LID (tap \uD83D\uDCDE untuk resolve)';\n  return contactId;`;
  const altNew = `  if (contactId.endsWith('@c.us')) return '+' + contactId.replace('@c.us', '');\n  if (contactId.endsWith('@lid')) {\n    const lidNum = contactId.replace('@lid', '').replace(/\\D/g, '');\n    return lidNum ? \`LID-\${lidNum.slice(-6)}\` : 'Nomor belum diketahui';\n  }\n  return contactId;`;
  if (content.includes(altOld)) {
    content = content.replace(altOld, altNew);
    console.log('✅ Fix 2: formatPhoneDisplay updated (LF variant)');
    changes++;
  } else {
    console.log('⚠️  Fix 2: formatPhoneDisplay not found');
    // Show what's around line 82
    const lines = content.split('\n');
    console.log('Lines 80-86:', lines.slice(79, 86).map((l,i) => `${80+i}: ${JSON.stringify(l)}`).join('\n'));
  }
}

// ─── Fix 3: Header subtitle — show contact_phone instead of @lid text ────────
const oldSubtitle = `                      {resolvedPhone ? \`+\${resolvedPhone}\` : formatPhoneDisplay(activeContact.contact_id)}\r\n`;
const newSubtitle = `                      {resolvedPhone\r\n                        ? \`+\${resolvedPhone}\`\r\n                        : (activeContact as any).contact_phone\r\n                          ? \`+\${(activeContact as any).contact_phone}\`\r\n                          : formatPhoneDisplay(activeContact.contact_id)}\r\n`;

if (content.includes(oldSubtitle)) {
  content = content.replace(oldSubtitle, newSubtitle);
  console.log('✅ Fix 3: Header phone subtitle updated');
  changes++;
} else {
  const altOld = `                      {resolvedPhone ? \`+\${resolvedPhone}\` : formatPhoneDisplay(activeContact.contact_id)}\n`;
  const altNew = `                      {resolvedPhone\n                        ? \`+\${resolvedPhone}\`\n                        : (activeContact as any).contact_phone\n                          ? \`+\${(activeContact as any).contact_phone}\`\n                          : formatPhoneDisplay(activeContact.contact_id)}\n`;
  if (content.includes(altOld)) {
    content = content.replace(altOld, altNew);
    console.log('✅ Fix 3: Header phone subtitle updated (LF variant)');
    changes++;
  } else {
    console.log('⚠️  Fix 3: Header phone subtitle not found');
  }
}

// ─── Fix 4: ChatContact interface — add contact_phone field ──────────────────
const oldInterface = `interface ChatContact {\r\n  contact_id: string;\r\n  sender_name: string;\r\n  contact_display_name: string;`;
const newInterface = `interface ChatContact {\r\n  contact_id: string;\r\n  sender_name: string;\r\n  contact_display_name: string;\r\n  contact_phone?: string;`;

if (content.includes(oldInterface)) {
  content = content.replace(oldInterface, newInterface);
  console.log('✅ Fix 4: ChatContact interface updated with contact_phone');
  changes++;
} else {
  const altOld = `interface ChatContact {\n  contact_id: string;\n  sender_name: string;\n  contact_display_name: string;`;
  const altNew = `interface ChatContact {\n  contact_id: string;\n  sender_name: string;\n  contact_display_name: string;\n  contact_phone?: string;`;
  if (content.includes(altOld)) {
    content = content.replace(altOld, altNew);
    console.log('✅ Fix 4: ChatContact interface updated (LF variant)');
    changes++;
  } else {
    console.log('⚠️  Fix 4: ChatContact interface not found');
  }
}

if (changes > 0) {
  fs.writeFileSync(file, content);
  console.log(`\n✅ Total ${changes} perubahan berhasil disimpan.`);
} else {
  console.log('\n❌ Tidak ada perubahan yang berhasil diterapkan.');
}
