/**
 * Unit tests for validateMetodeBayarConsistency()
 * Tests cross-validation: METODE_BAYAR vs label Closing consistency
 *
 * Fase 1 — SUK-63: Agent Validasi Closing + Perbaikan Labeling (COD vs Transfer)
 */
import { describe, it, expect } from 'vitest';

// Import the CJS function from smart_label_service.js
// Vitest handles CJS interop for .js files automatically
const { validateMetodeBayarConsistency } = await import('../src/services/smart_label_service.js');

describe('validateMetodeBayarConsistency', () => {
  // ─────────────────────────────────────────────
  // Test Case 1: COD+Transfer → dikoreksi ke COD
  // ─────────────────────────────────────────────
  it('should correct Transfer→COD when METODE_BAYAR=COD and labels=[Transfer, Closing]', () => {
    const summaryText = [
      'NAMA CUSTOMER: Budi Santoso',
      'METODE BAYAR: COD',
      'ALAMAT: Jl. Merdeka No. 10, Jakarta',
      'STATUS: Closing',
      'WA_LABELS: [Transfer, Closing]',
    ].join('\n');

    const currentLabels = ['Transfer', 'Closing'];

    const result = validateMetodeBayarConsistency(summaryText, currentLabels);

    expect(result.needsCorrection).toBe(true);
    expect(result.reason).toContain('METODE_BAYAR=COD tapi label=Transfer');
    expect(result.removeLabels).toEqual(['Transfer']);
    expect(result.addLabels).toEqual(['COD']);
  });

  // ─────────────────────────────────────────────
  // Test Case 2: Transfer+COD → dikoreksi ke Transfer
  // ─────────────────────────────────────────────
  it('should correct COD→Transfer when METODE_BAYAR=Transfer and labels=[COD, Closing]', () => {
    const summaryText = [
      'NAMA CUSTOMER: Siti Rahayu',
      'METODE BAYAR: Transfer',
      'ALAMAT: Jl. Sudirman No. 5, Bandung',
      'STATUS: Closing',
      'WA_LABELS: [COD, Closing]',
    ].join('\n');

    const currentLabels = ['COD', 'Closing'];

    const result = validateMetodeBayarConsistency(summaryText, currentLabels);

    expect(result.needsCorrection).toBe(true);
    expect(result.reason).toContain('METODE_BAYAR=Transfer tapi label=COD');
    expect(result.removeLabels).toEqual(['COD']);
    expect(result.addLabels).toEqual(['Transfer']);
  });

  // ─────────────────────────────────────────────
  // Edge Case: Valid labels — no correction needed
  // ─────────────────────────────────────────────
  it('should NOT correct when labels already match METODE_BAYAR', () => {
    const codSummary = 'METODE BAYAR: COD\nSTATUS: Closing';
    const transferSummary = 'METODE BAYAR: Transfer\nSTATUS: Closing';

    expect(validateMetodeBayarConsistency(codSummary, ['COD', 'Closing']).needsCorrection).toBe(false);
    expect(validateMetodeBayarConsistency(transferSummary, ['Transfer', 'Closing']).needsCorrection).toBe(false);
  });

  // ─────────────────────────────────────────────
  // Edge Case: Tidak ada METODE BAYAR → no correction
  // ─────────────────────────────────────────────
  it('should return no correction when METODE_BAYAR field is missing', () => {
    const result = validateMetodeBayarConsistency('NAMA CUSTOMER: Test\nSTATUS: Closing', ['Transfer', 'Closing']);
    expect(result.needsCorrection).toBe(false);
  });

  // ─────────────────────────────────────────────
  // Edge Case: Label tidak mengandung Closing → skip
  // ─────────────────────────────────────────────
  it('should skip validation when labels do not contain Closing', () => {
    const result = validateMetodeBayarConsistency('METODE BAYAR: COD\nSTATUS: Menunggu Rekap', ['Menunggu Rekap']);
    expect(result.needsCorrection).toBe(false);
  });

  // ─────────────────────────────────────────────
  // Edge Case: Null/empty inputs → graceful
  // ─────────────────────────────────────────────
  it('should handle null/empty inputs gracefully', () => {
    expect(validateMetodeBayarConsistency(null, ['COD']).needsCorrection).toBe(false);
    expect(validateMetodeBayarConsistency('METODE BAYAR: COD', null).needsCorrection).toBe(false);
    expect(validateMetodeBayarConsistency('', []).needsCorrection).toBe(false);
  });

  // ─────────────────────────────────────────────
  // Edge Case: METODE BAYAR case-insensitive
  // ─────────────────────────────────────────────
  it('should match METODE BAYAR case-insensitively', () => {
    const summaryText = 'metode bayar: cod\nSTATUS: Closing';
    const result = validateMetodeBayarConsistency(summaryText, ['Transfer', 'Closing']);
    expect(result.needsCorrection).toBe(true);
    expect(result.addLabels).toEqual(['COD']);
  });
});
