const WA_ID_DOMAINS = new Set(['c.us', 's.whatsapp.net', 'lid']);
const MIN_PHONE_LENGTH = 8;
const MAX_PHONE_LENGTH = 15;

function normalizePhoneDigits(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  return digits;
}

function isValidPhoneDigits(digits) {
  return /^\d+$/.test(digits)
    && digits.length >= MIN_PHONE_LENGTH
    && digits.length <= MAX_PHONE_LENGTH
    && !digits.startsWith('0');
}

function normalizeWaChatId(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return { ok: false, value: '', error: 'Nomor WhatsApp wajib diisi.' };
  }

  if (raw.includes('@')) {
    const [local, domain, ...rest] = raw.split('@');
    const normalizedLocal = normalizePhoneDigits(local);
    const isValidLocal = domain === 'lid'
      ? /^\d+$/.test(normalizedLocal) && normalizedLocal.length >= MIN_PHONE_LENGTH
      : isValidPhoneDigits(normalizedLocal);

    if (rest.length > 0 || !WA_ID_DOMAINS.has(domain) || !isValidLocal) {
      return {
        ok: false,
        value: '',
        error: 'Format nomor WhatsApp tidak valid. Gunakan 628xxx@c.us, 628xxx@s.whatsapp.net, atau ID chat @lid yang sudah ada.'
      };
    }
    return { ok: true, value: `${normalizedLocal}@${domain}` };
  }

  const digits = normalizePhoneDigits(raw);
  if (!isValidPhoneDigits(digits)) {
    return {
      ok: false,
      value: '',
      error: 'Format nomor WhatsApp tidak valid. Gunakan 628xxxxxxxxxx atau 08xxxxxxxxxx.'
    };
  }

  return { ok: true, value: `${digits}@c.us` };
}

function assertWaChatId(value) {
  const result = normalizeWaChatId(value);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

module.exports = {
  normalizeWaChatId,
  assertWaChatId,
  isValidPhoneDigits
};
