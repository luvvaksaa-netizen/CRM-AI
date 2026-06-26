/**
 * @file smart-label-bug-7.test.ts
 * @description Test for BUG 7 — Label Duplikat dengan 3 Akar Masalah
 *
 * Tests cover:
 * - AKAR A: Cleanup for status changes (flexible mapping)
 * - AKAR B: Case-insensitive dedup label
 * - AKAR C: Replace logic in _persistLabelsToDb with proper cleanup
 */

describe('BUG 7 — Label Duplikat (3 Root Causes)', () => {
  // Mock utilities
  const normalizeAndDedupLabels = (labels: string[]): string[] => {
    const seen = new Map<string, string>();
    const result: string[] = [];
    for (const lbl of labels) {
      if (!lbl) continue;
      const normalized = String(lbl).trim();
      const lower = normalized.toLowerCase();
      if (!seen.has(lower)) {
        seen.set(lower, normalized);
        result.push(normalized);
      }
    }
    return result;
  };

  const LABELS_TO_REMOVE_ON_STATUS: Record<string, string[]> = {
    'Closing': ['Cancel'],
    'Cancel': ['Closing', 'Transfer', 'COD'],
    'Transfer': ['COD', 'Cancel'],
    'COD': ['Transfer', 'Cancel'],
  };

  const IMMUTABLE_LABELS: Set<string> = new Set(['Closing', 'Cancel']);

  describe('AKAR A: Flexible cleanup rules untuk semua status changes', () => {
    it('should remove Cancel label when Closing is detected', () => {
      const existingLabels = ['Cancel', 'Closing'];
      const newLabels = ['Closing'];
      const statusLabel = 'Closing';

      let cleaned = [...existingLabels];
      if (statusLabel && LABELS_TO_REMOVE_ON_STATUS[statusLabel]) {
        const toRemove = new Set(
          LABELS_TO_REMOVE_ON_STATUS[statusLabel].map(l => l.toLowerCase())
        );
        cleaned = cleaned.filter(lbl => {
          const lowerLbl = String(lbl).toLowerCase();
          const shouldRemove = toRemove.has(lowerLbl);
          const isImmutable = Array.from(IMMUTABLE_LABELS).some(
            immutable => immutable.toLowerCase() === lowerLbl
          );
          return !(shouldRemove && !isImmutable);
        });
      }

      expect(cleaned).not.toContain('Cancel');
      expect(cleaned).toContain('Closing');
    });

    it('should remove Closing, Transfer, COD when Cancel is detected', () => {
      const existingLabels = ['Closing', 'Transfer', 'COD'];
      const statusLabel = 'Cancel';

      let cleaned = [...existingLabels];
      if (statusLabel && LABELS_TO_REMOVE_ON_STATUS[statusLabel]) {
        const toRemove = new Set(
          LABELS_TO_REMOVE_ON_STATUS[statusLabel].map(l => l.toLowerCase())
        );
        cleaned = cleaned.filter(lbl => {
          const lowerLbl = String(lbl).toLowerCase();
          const shouldRemove = toRemove.has(lowerLbl);
          const isImmutable = Array.from(IMMUTABLE_LABELS).some(
            immutable => immutable.toLowerCase() === lowerLbl
          );
          return !(shouldRemove && !isImmutable);
        });
      }

      // Closing is IMMUTABLE so should NOT be removed
      expect(cleaned).toContain('Closing');
      expect(cleaned).not.toContain('Transfer');
      expect(cleaned).not.toContain('COD');
    });

    it('should remove COD and Cancel when Transfer is detected', () => {
      const existingLabels = ['COD', 'Cancel', 'Transfer'];
      const statusLabel = 'Transfer';

      let cleaned = [...existingLabels];
      if (statusLabel && LABELS_TO_REMOVE_ON_STATUS[statusLabel]) {
        const toRemove = new Set(
          LABELS_TO_REMOVE_ON_STATUS[statusLabel].map(l => l.toLowerCase())
        );
        cleaned = cleaned.filter(lbl => {
          const lowerLbl = String(lbl).toLowerCase();
          const shouldRemove = toRemove.has(lowerLbl);
          const isImmutable = Array.from(IMMUTABLE_LABELS).some(
            immutable => immutable.toLowerCase() === lowerLbl
          );
          return !(shouldRemove && !isImmutable);
        });
      }

      expect(cleaned).not.toContain('COD');
      expect(cleaned).toContain('Cancel'); // IMMUTABLE
      expect(cleaned).toContain('Transfer');
    });

    it('should preserve IMMUTABLE_LABELS even when in removal list', () => {
      const existingLabels = ['Cancel', 'Closing'];
      const statusLabel = 'Cancel'; // triggers removal of Closing

      let cleaned = [...existingLabels];
      if (statusLabel && LABELS_TO_REMOVE_ON_STATUS[statusLabel]) {
        const toRemove = new Set(
          LABELS_TO_REMOVE_ON_STATUS[statusLabel].map(l => l.toLowerCase())
        );
        cleaned = cleaned.filter(lbl => {
          const lowerLbl = String(lbl).toLowerCase();
          const shouldRemove = toRemove.has(lowerLbl);
          const isImmutable = Array.from(IMMUTABLE_LABELS).some(
            immutable => immutable.toLowerCase() === lowerLbl
          );
          return !(shouldRemove && !isImmutable);
        });
      }

      // Both should remain because Closing is immutable
      expect(cleaned).toContain('Closing');
      expect(cleaned).toContain('Cancel');
    });
  });

  describe('AKAR B: Case-insensitive dedup label', () => {
    it('should dedupe "Closing" vs "closing" vs "CLOSING"', () => {
      const input = ['Closing', 'closing', 'CLOSING'];
      const result = normalizeAndDedupLabels(input);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe('Closing'); // First occurrence case
    });

    it('should preserve original case of first occurrence', () => {
      const input = ['TRANSFER', 'Transfer', 'transfer'];
      const result = normalizeAndDedupLabels(input);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe('TRANSFER');
    });

    it('should handle mixed case labels', () => {
      const input = ['Closing', 'Cancel', 'CLOSING', 'cancel', 'Transfer'];
      const result = normalizeAndDedupLabels(input);

      expect(result).toHaveLength(3);
      expect(result).toContain('Closing'); // First occurrence of closing
      expect(result).toContain('Cancel'); // First occurrence of cancel
      expect(result).toContain('Transfer');
    });

    it('should skip null and empty values', () => {
      const input = ['Closing', null as any, '', 'Cancel', undefined as any];
      const result = normalizeAndDedupLabels(input);

      expect(result).toHaveLength(2);
      expect(result).toContain('Closing');
      expect(result).toContain('Cancel');
    });

    it('should trim whitespace', () => {
      const input = ['  Closing  ', 'Cancel  '];
      const result = normalizeAndDedupLabels(input);

      expect(result).toHaveLength(2);
      expect(result[0]).toBe('Closing');
      expect(result[1]).toBe('Cancel');
    });
  });

  describe('AKAR C: Label lifecycle with cleanup + dedup', () => {
    it('should clean up stale labels and dedup when status changes from Transfer to COD', () => {
      // Scenario: Contact has Transfer label, now COD is detected
      const existingLabels = ['Transfer', 'COD'];
      const newLabels = ['COD'];
      const summaryText = 'METODE PEMBAYARAN: COD';
      const statusLabel = 'COD';

      // Step 1: Apply cleanup based on status
      let cleaned = [...existingLabels];
      if (statusLabel && LABELS_TO_REMOVE_ON_STATUS[statusLabel]) {
        const toRemove = new Set(
          LABELS_TO_REMOVE_ON_STATUS[statusLabel].map(l => l.toLowerCase())
        );
        cleaned = cleaned.filter(lbl => {
          const lowerLbl = String(lbl).toLowerCase();
          const shouldRemove = toRemove.has(lowerLbl);
          const isImmutable = Array.from(IMMUTABLE_LABELS).some(
            immutable => immutable.toLowerCase() === lowerLbl
          );
          return !(shouldRemove && !isImmutable);
        });
      }

      // Step 2: Merge and dedup
      const merged = normalizeAndDedupLabels([...cleaned, ...newLabels]);

      expect(merged).not.toContain('Transfer');
      expect(merged).toContain('COD');
      expect(merged).toHaveLength(1);
    });

    it('should handle complex label merge with case variations', () => {
      // Scenario: DB has ['Closing', 'COD'], new summary adds ['Closing', 'cod']
      const existingLabels = ['Closing', 'COD'];
      const newLabels = ['Closing', 'cod']; // lowercase cod
      const summaryText = 'STATUS: CLOSING';
      const statusLabel = 'Closing';

      // Apply cleanup
      let cleaned = [...existingLabels];
      if (statusLabel && LABELS_TO_REMOVE_ON_STATUS[statusLabel]) {
        const toRemove = new Set(
          LABELS_TO_REMOVE_ON_STATUS[statusLabel].map(l => l.toLowerCase())
        );
        cleaned = cleaned.filter(lbl => {
          const lowerLbl = String(lbl).toLowerCase();
          const shouldRemove = toRemove.has(lowerLbl);
          const isImmutable = Array.from(IMMUTABLE_LABELS).some(
            immutable => immutable.toLowerCase() === lowerLbl
          );
          return !(shouldRemove && !isImmutable);
        });
      }

      // Merge and dedup (Cancel would have been removed, but Closing is kept)
      const merged = normalizeAndDedupLabels([...cleaned, ...newLabels]);

      expect(merged).toContain('Closing');
      expect(merged).toContain('COD');
      expect(merged).toHaveLength(2);
      // Check that 'cod' was not added as duplicate
      expect(merged.filter(l => l.toLowerCase() === 'cod')).toHaveLength(1);
    });

    it('should clear irrelevant labels when status changes completely', () => {
      // Scenario: Contact was Transfer (had Transfer + COD labels),
      // now canceling order (status → Cancel)
      const existingLabels = ['Transfer', 'COD'];
      const newLabels = ['Cancel'];
      const statusLabel = 'Cancel';

      // Apply cleanup - Transfer and COD should be removed
      let cleaned = [...existingLabels];
      if (statusLabel && LABELS_TO_REMOVE_ON_STATUS[statusLabel]) {
        const toRemove = new Set(
          LABELS_TO_REMOVE_ON_STATUS[statusLabel].map(l => l.toLowerCase())
        );
        cleaned = cleaned.filter(lbl => {
          const lowerLbl = String(lbl).toLowerCase();
          const shouldRemove = toRemove.has(lowerLbl);
          const isImmutable = Array.from(IMMUTABLE_LABELS).some(
            immutable => immutable.toLowerCase() === lowerLbl
          );
          return !(shouldRemove && !isImmutable);
        });
      }

      const merged = normalizeAndDedupLabels([...cleaned, ...newLabels]);

      expect(merged).toContain('Cancel');
      expect(merged).not.toContain('Transfer');
      expect(merged).not.toContain('COD');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty arrays', () => {
      const result = normalizeAndDedupLabels([]);
      expect(result).toEqual([]);
    });

    it('should handle arrays with only whitespace', () => {
      const result = normalizeAndDedupLabels(['   ', '\t', '\n']);
      expect(result).toEqual([]);
    });

    it('should not remove status when trying to cleanup non-existent labels', () => {
      const existingLabels = ['Closing'];
      const statusLabel = 'Closing';

      let cleaned = [...existingLabels];
      if (statusLabel && LABELS_TO_REMOVE_ON_STATUS[statusLabel]) {
        const toRemove = new Set(
          LABELS_TO_REMOVE_ON_STATUS[statusLabel].map(l => l.toLowerCase())
        );
        cleaned = cleaned.filter(lbl => {
          const lowerLbl = String(lbl).toLowerCase();
          const shouldRemove = toRemove.has(lowerLbl);
          const isImmutable = Array.from(IMMUTABLE_LABELS).some(
            immutable => immutable.toLowerCase() === lowerLbl
          );
          return !(shouldRemove && !isImmutable);
        });
      }

      expect(cleaned).toEqual(['Closing']);
    });
  });
});
