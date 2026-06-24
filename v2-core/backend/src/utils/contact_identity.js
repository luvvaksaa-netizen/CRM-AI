const PHONE_DOMAINS = new Set(['c.us', 's.whatsapp.net']);

function splitChatId(chatId) {
  const raw = String(chatId || '').trim();
  const [left, domain = ''] = raw.split('@');
  const local = String(left || '').split(':')[0].replace(/[^\d]/g, '');
  return { raw, local, domain };
}

function formatPhoneNumber(digits) {
  if (!digits) return '';
  if (digits.startsWith('62') && digits.length >= 10) {
    return `+62 ${digits.slice(2, 5)}-${digits.slice(5, 9)}-${digits.slice(9)}`;
  }
  return `+${digits}`;
}

function isPlausiblePhoneDigits(digits, chatId = '') {
  const value = String(digits || '').replace(/[^\d]/g, '');
  if (!/^\d{8,15}$/.test(value)) return false;
  const parsed = splitChatId(chatId);
  if (parsed.local && value === parsed.local && parsed.domain !== 'c.us' && parsed.domain !== 's.whatsapp.net') {
    return false;
  }
  return true;
}

function isGeneratedNameForId(name, chatId) {
  const value = String(name || '').trim();
  if (!value) return false;
  const { local } = splitChatId(chatId);
  const digits = value.replace(/[^\d]/g, '');
  return Boolean(local && digits && digits === local);
}

function firstHumanName(...values) {
  for (const value of values) {
    const name = String(value || '').trim();
    if (!name) continue;
    if (name.includes('@')) continue;
    if (/^\+?\d[\d\s-]+$/.test(name)) continue;
    if (/^Kontak WA #\d+$/.test(name) || name === 'Kontak WA Privat' || name === 'Kontak WhatsApp') continue;
    return name;
  }
  return '';
}

function getContactType(chatId) {
  const { domain } = splitChatId(chatId);
  if (domain === 'lid') return 'lid';
  if (domain === 'broadcast') return 'broadcast';
  if (domain === 'newsletter') return 'newsletter';
  if (domain === 'g.us') return 'group';
  if (PHONE_DOMAINS.has(domain)) return 'phone';
  return domain ? 'unknown' : 'raw';
}

function buildContactIdentity(chatId, contact = {}) {
  const parsed = splitChatId(chatId);
  const type = getContactType(chatId);
  const realName = firstHumanName(contact.name, contact.pushname, contact.shortName, contact.displayName);
  const candidatePhone = String(contact.number || contact.phone || contact.phoneNumber || '').replace(/[^\d]/g, '');
  const phone = type === 'phone'
    ? (candidatePhone || parsed.local)
    : (isPlausiblePhoneDigits(candidatePhone, chatId) ? candidatePhone : '');
  const lid = type === 'lid' ? parsed.local : '';
  const shortLid = lid ? lid.slice(-6) : '';

  let displayName = realName;
  if (!displayName && type === 'phone') displayName = formatPhoneNumber(phone);
  if (!displayName && phone) displayName = formatPhoneNumber(phone);
  // Untuk @lid: jika phone sudah resolved → tampilkan nomor, bukan "Kontak WA #xxx"
  if (!displayName && type === 'lid') {
    displayName = phone ? formatPhoneNumber(phone) : (shortLid ? `LID-${shortLid}` : 'LID');
  }
  if (!displayName && type === 'broadcast') displayName = 'Siaran WhatsApp';
  if (!displayName && type === 'newsletter') displayName = 'Channel WhatsApp';
  if (!displayName && type === 'group') displayName = 'Grup WhatsApp';
  if (!displayName) displayName = 'Kontak WhatsApp';

  if (isGeneratedNameForId(displayName, chatId) && type !== 'phone') {
    // Jika nama terdeteksi dihasilkan dari ID (angka sama), ganti dengan nomor HP
    displayName = phone ? formatPhoneNumber(phone) : (type === 'lid' && shortLid ? `LID-${shortLid}` : 'Kontak WhatsApp');
  }

  return {
    jid: parsed.raw,
    type,
    displayName,
    phone,
    lid,
    source: realName ? 'profile' : (type === 'phone' ? 'phone' : type)
  };
}

function shouldIgnoreIncomingChat(chatId) {
  const type = getContactType(chatId);
  return type === 'broadcast' || type === 'newsletter' || type === 'group';
}

module.exports = {
  splitChatId,
  formatPhoneNumber,
  isGeneratedNameForId,
  isPlausiblePhoneDigits,
  getContactType,
  buildContactIdentity,
  shouldIgnoreIncomingChat
};
