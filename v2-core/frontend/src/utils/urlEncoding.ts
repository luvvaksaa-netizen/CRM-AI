/**
 * Utility functions untuk encoding/decoding WhatsApp IDs dan contact IDs
 * yang mengandung special characters seperti @c.us dan @lid
 */

/**
 * Encode WhatsApp ID atau contact ID untuk digunakan dalam URL
 * @param waId - WhatsApp ID (e.g., "62123456789@c.us" atau "120@lid")
 * @returns Encoded string yang aman untuk URL
 * @example
 * encodeWAId("62123456789@c.us") // "%2B62123456789%40c.us"
 * encodeWAId("120@lid") // "120%40lid"
 */
export function encodeWAId(waId: string): string {
  return encodeURIComponent(waId);
}

/**
 * Decode URL-encoded WhatsApp ID atau contact ID
 * @param encoded - Encoded string dari URL
 * @returns Original WhatsApp ID
 * @example
 * decodeWAId("%2B62123456789%40c.us") // "62123456789@c.us"
 * decodeWAId("120%40lid") // "120@lid"
 */
export function decodeWAId(encoded: string): string {
  return decodeURIComponent(encoded);
}

/**
 * Validasi dan sanitasi WhatsApp ID
 * @param waId - WhatsApp ID untuk divalidasi
 * @returns true jika valid
 */
export function isValidWAId(waId: string): boolean {
  if (!waId || typeof waId !== 'string') return false;
  // Valid: 62123456789@c.us atau 120@lid
  return /^[\d\w.+-]+@(c\.us|lid)$/.test(waId);
}

/**
 * Test roundtrip encoding/decoding
 * Pastikan bahwa encode -> decode menghasilkan nilai asli
 * @param original - Original string
 * @returns true jika roundtrip berhasil
 */
export function testRoundtripEncoding(original: string): boolean {
  const encoded = encodeWAId(original);
  const decoded = decodeWAId(encoded);
  return decoded === original;
}
