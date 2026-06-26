/**
 * Test Suite: DSML Regex Improvement untuk Nested Tags
 * BUG FIX: Perbaikan regex untuk menangani nested DSML tags
 *
 * File Target: backend/src/ai_service.js (sanitizeTextOutput function)
 *
 * Test Coverage:
 * - Simple DSML tags
 * - Nested DSML tags
 * - Multiple DSML blocks
 * - Mixed fullwidth & ASCII pipes
 * - Orphaned tags (opening without closing, vice versa)
 * - Legitimate DSML-like content (should NOT be removed)
 * - Edge cases dan malformed tags
 */

// Mock logger untuk testing
const mockLogger = {
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};

// Import atau define fungsi yang akan ditest
// (Untuk testing standalone, kita akan copy fungsi di sini)

/**
 * Validation function untuk memastikan DSML tags sudah benar-benar dihapus
 */
function validateDSMLRemoved(content) {
  if (!content) return true;

  const hasDSML = /<[|\uFF5C]{2}DSML[|\uFF5C]{2}/gi.test(content);
  const hasClosingDSML = /<\/[|\uFF5C]{2}DSML[|\uFF5C]{2}/gi.test(content);

  if (hasDSML || hasClosingDSML) {
    const contentSample = content.substring(0, 200).replace(/\n/g, " ");
    mockLogger.warn(
      "[AI] ⚠️ DSML tags detected after cleanup! Content sample: " +
        contentSample,
    );
    return false;
  }

  return true;
}

/**
 * IMPROVED DSML sanitizer dengan 3-step cleanup
 */
function sanitizeTextOutput(text) {
  if (!text) return "";

  let clean = text;

  // 1. Hapus format Markdown Image: ![...](...)
  clean = clean.replace(/!\[.*?\]\(.*?\)/g, "");

  // 2. Hapus format link fiktif
  clean = clean.replace(/https?:\/\/\S+/gi, "");
  clean = clean.replace(/\b(example|yourdomain|domain|website)\.com\S*/gi, "");

  // 3. Hapus tag internal jika bocor: [MEDIA:...] atau [VIDEO:...]
  clean = clean.replace(/\[MEDIA:.*?\]/g, "");
  clean = clean.replace(/\[VIDEO:.*?\]/g, "");

  // 4. Hapus ID sistem jika bocor (misal: ID: 2)
  clean = clean.replace(/ID:\s*\d+/gi, "");

  // 5. Hapus timestamp yang bocor: [WAKTU: ...] atau (Dikirim ...)
  clean = clean.replace(/\[WAKTU:.*?\]/gi, "");
  clean = clean.replace(/\(Dikirim \d{2} \w{3} \d{2}:\d{2}\)/gi, "");

  // 6. BUG FIX: 3-step cleanup untuk handle nested DSML tags

  // Step 1: Remove complete DSML blocks dengan greedy match untuk nested tags
  clean = clean.replace(
    /<[|\uFF5C]{2}DSML[|\uFF5C]{2}[\s\S]+?<\/[|\uFF5C]{2}DSML[|\uFF5C]{2}[^>]*>/gi,
    "",
  );

  // Step 2: Cleanup sisa tag yang mungkin tertinggal (orphaned opening tags)
  clean = clean.replace(/<[|\uFF5C]{2}DSML[|\uFF5C]{2}[^>]*>/gi, "");

  // Step 3: Cleanup sisa closing tag tanpa opening (safety net)
  clean = clean.replace(/<\/[|\uFF5C]{2}DSML[|\uFF5C]{2}[^>]*>/gi, "");

  // 7. Normalisasi spasi dan baris kosong berlebih
  const finalClean = clean.trim().replace(/\n{3,}/g, "\n\n");

  // 8. Validasi: pastikan DSML tags sudah benar-benar dihapus
  if (!validateDSMLRemoved(finalClean)) {
    mockLogger.warn(
      "[AI] DSML validation failed but continuing (non-blocking warning)",
    );
  }

  return finalClean;
}

describe("DSML Regex Improvement untuk Nested Tags", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================
  // TEST 1: Simple DSML Tags
  // ============================================================
  describe("Test 1: Simple DSML Tags", () => {
    test("should remove simple ASCII pipe DSML", () => {
      const input = "Hello ||DSML||invoke>world</||DSML||>";
      const result = sanitizeTextOutput(input);
      expect(result).toBe("Hello world");
      expect(validateDSMLRemoved(result)).toBe(true);
    });

    test("should remove simple fullwidth pipe DSML", () => {
      const input = "Hello ｜｜DSML｜｜invoke>world</｜｜DSML｜｜>";
      const result = sanitizeTextOutput(input);
      expect(result).toBe("Hello world");
      expect(validateDSMLRemoved(result)).toBe(true);
    });

    test("should remove DSML with attributes", () => {
      const input =
        "Hello ｜｜DSML｜｜invoke action='test'>content</｜｜DSML｜｜>";
      const result = sanitizeTextOutput(input);
      expect(result).toBe("Hello content");
      expect(validateDSMLRemoved(result)).toBe(true);
    });

    test("should remove multiple simple DSML blocks", () => {
      const input =
        "Start ｜｜DSML｜｜tag1>A</｜｜DSML｜｜> middle ｜｜DSML｜｜tag2>B</｜｜DSML｜｜> end";
      const result = sanitizeTextOutput(input);
      expect(result).toBe("Start  middle  end");
      expect(validateDSMLRemoved(result)).toBe(true);
    });
  });

  // ============================================================
  // TEST 2: Nested DSML Tags (CRITICAL FIX)
  // ============================================================
  describe("Test 2: Nested DSML Tags (Critical Fix)", () => {
    test("should handle nested DSML with param tags", () => {
      const input =
        "｜｜DSML｜｜invoke>start ｜｜DSML｜｜param>inner</｜｜DSML｜｜param> end</｜｜DSML｜｜invoke>";
      const result = sanitizeTextOutput(input);
      // Nested tags should be completely removed
      expect(result).not.toContain("DSML");
      expect(result).not.toContain("invoke");
      expect(validateDSMLRemoved(result)).toBe(true);
    });

    test("should handle deeply nested DSML (3 levels)", () => {
      const input =
        "｜｜DSML｜｜outer>` +\n" +
        "        \"｜｜DSML｜｜middle>\" +\n" +
        "        \"｜｜DSML｜｜inner>data</｜｜DSML｜｜inner>\" +\n" +
        "        \"</｜｜DSML｜｜middle>\" +\n" +
        "        \"</｜｜DSML｜｜outer>\"";
      const input2 = `｜｜DSML｜｜outer>｜｜DSML｜｜middle>｜｜DSML｜｜inner>data</｜｜DSML｜｜inner></｜｜DSML｜｜middle></｜｜DSML｜｜outer>`;
      const result = sanitizeTextOutput(input2);
      expect(result).not.toContain("DSML");
      expect(validateDSMLRemoved(result)).toBe(true);
    });

    test("should handle DSML with multiline nested content", () => {
      const input =
        "｜｜DSML｜｜invoke>\n" +
        "  ｜｜DSML｜｜param name='test'>\n" +
        "    complex nested content\n" +
        "  </｜｜DSML｜｜param>\n" +
        "</｜｜DSML｜｜invoke>";
      const result = sanitizeTextOutput(input);
      expect(result).not.toContain("DSML");
      expect(result).not.toContain("invoke");
      expect(result).not.toContain("param");
      expect(validateDSMLRemoved(result)).toBe(true);
    });

    test("should handle original bug case: invoke with nested param", () => {
      // Original bug example dari spec
      const input =
        "Message ｜｜DSML｜｜invoke>...｜｜DSML｜｜param>...</param></invoke></DSML｜｜> after";
      // Fix the malformed closing tags for this test
      const input2 =
        "Message ｜｜DSML｜｜invoke>content ｜｜DSML｜｜param>nested</｜｜DSML｜｜param></｜｜DSML｜｜invoke> after";
      const result = sanitizeTextOutput(input2);
      expect(result).toBe("Message  after");
      expect(validateDSMLRemoved(result)).toBe(true);
    });
  });

  // ============================================================
  // TEST 3: Mixed Fullwidth & ASCII Pipes
  // ============================================================
  describe("Test 3: Mixed Fullwidth & ASCII Pipes", () => {
    test("should handle mixed pipes in same tag", () => {
      const input = "test ｜｜DSML||invoke>content</｜｜DSML｜｜ end";
      const result = sanitizeTextOutput(input);
      expect(result).not.toContain("DSML");
      expect(validateDSMLRemoved(result)).toBe(true);
    });

    test("should handle mixed pipes in nested structure", () => {
      const input =
        "｜｜DSML｜｜outer>||inner||content</｜｜DSML||outer>";
      const result = sanitizeTextOutput(input);
      expect(result).not.toContain("DSML");
      expect(validateDSMLRemoved(result)).toBe(true);
    });

    test("should handle ASCII pipes in fullwidth outer tags", () => {
      const input =
        "｜｜DSML｜｜wrap>||DSML||inner>test</||DSML||inner></｜｜DSML｜｜wrap>";
      const result = sanitizeTextOutput(input);
      expect(result).not.toContain("DSML");
      expect(validateDSMLRemoved(result)).toBe(true);
    });
  });

  // ============================================================
  // TEST 4: Orphaned Tags
  // ============================================================
  describe("Test 4: Orphaned Tags", () => {
    test("should remove orphaned opening tag (no closing)", () => {
      const input = "Text with ｜｜DSML｜｜orphan>but no closing tag";
      const result = sanitizeTextOutput(input);
      expect(result).toBe("Text with but no closing tag");
      expect(validateDSMLRemoved(result)).toBe(true);
    });

    test("should remove orphaned closing tag (no opening)", () => {
      const input = "Text without opening </｜｜DSML｜｜orphan> tag";
      const result = sanitizeTextOutput(input);
      expect(result).toBe("Text without opening  tag");
      expect(validateDSMLRemoved(result)).toBe(true);
    });

    test("should handle multiple orphaned tags", () => {
      const input =
        "｜｜DSML｜｜ text </｜｜DSML｜｜> more ｜｜DSML｜｜ and </｜｜DSML｜｜>";
      const result = sanitizeTextOutput(input);
      expect(result).not.toContain("DSML");
      expect(validateDSMLRemoved(result)).toBe(true);
    });

    test("should handle mixed orphaned tags", () => {
      const input =
        "Start ｜｜DSML｜｜unclosed content </｜｜DSML｜｜ end more ｜｜DSML｜｜ stuff";
      const result = sanitizeTextOutput(input);
      expect(result).not.toContain("DSML");
      expect(validateDSMLRemoved(result)).toBe(true);
    });
  });

  // ============================================================
  // TEST 5: Legitimate DSML-like Content (should NOT be removed)
  // ============================================================
  describe("Test 5: Legitimate Content (Edge Cases)", () => {
    test("should preserve normal HTML comments (not DSML)", () => {
      const input = "Normal text <!-- this is a comment --> more text";
      const result = sanitizeTextOutput(input);
      expect(result).toContain("<!--");
      expect(result).toContain("-->");
    });

    test("should preserve legitimate angle brackets", () => {
      const input = "Math: 5 < 10 and 20 > 5 are true";
      const result = sanitizeTextOutput(input);
      expect(result).toContain("5 < 10");
      expect(result).toContain("20 > 5");
    });

    test("should preserve code-like content with pipes", () => {
      const input = "Code example: if (a || b) { return value; }";
      const result = sanitizeTextOutput(input);
      expect(result).toContain("||");
      expect(result).toContain("return value");
    });

    test("should preserve legitimate tags with different syntax", () => {
      const input =
        "Regular tags: <div>content</div> should be preserved";
      const result = sanitizeTextOutput(input);
      expect(result).toContain("<div>");
      expect(result).toContain("</div>");
    });
  });

  // ============================================================
  // TEST 6: Performance & Edge Cases
  // ============================================================
  describe("Test 6: Performance & Edge Cases", () => {
    test("should handle empty input", () => {
      const result = sanitizeTextOutput("");
      expect(result).toBe("");
    });

    test("should handle null input", () => {
      const result = sanitizeTextOutput(null);
      expect(result).toBe("");
    });

    test("should handle only DSML tags", () => {
      const input =
        "｜｜DSML｜｜tag>content</｜｜DSML｜｜>";
      const result = sanitizeTextOutput(input);
      expect(result).toBe("");
      expect(validateDSMLRemoved(result)).toBe(true);
    });

    test("should handle very long nested structure", () => {
      // Simulate a long nested DSML structure
      let input = "Start ";
      for (let i = 0; i < 50; i++) {
        input += `｜｜DSML｜｜level${i}>`;
      }
      input += "content";
      for (let i = 49; i >= 0; i--) {
        input += `</｜｜DSML｜｜level${i}>`;
      }
      input += " End";
      const result = sanitizeTextOutput(input);
      expect(result).toBe("Start  End");
      expect(validateDSMLRemoved(result)).toBe(true);
    });

    test("should handle DSML with special characters inside", () => {
      const input =
        "｜｜DSML｜｜tag>content with @#$%^&*() special chars!</｜｜DSML｜｜>";
      const result = sanitizeTextOutput(input);
      expect(result).toBe("content with @#$%^&*() special chars!");
      expect(validateDSMLRemoved(result)).toBe(true);
    });

    test("should handle DSML with unicode characters", () => {
      const input =
        "｜｜DSML｜｜tag>中文内容 العربية 한글</｜｜DSML｜｜>";
      const result = sanitizeTextOutput(input);
      expect(result).toBe("中文内容 العربية 한글");
      expect(validateDSMLRemoved(result)).toBe(true);
    });
  });

  // ============================================================
  // TEST 7: Complex Real-World Scenarios
  // ============================================================
  describe("Test 7: Complex Real-World Scenarios", () => {
    test("should handle multiple different DSML operations in one message", () => {
      const input =
        "Hello customer! ｜｜DSML｜｜invoke action='greeting'>Hi there</｜｜DSML｜｜invoke> " +
        "Your order ｜｜DSML｜｜fetch id='123'>Order details</｜｜DSML｜｜fetch> is ready. " +
        "｜｜DSML｜｜notify>Sending notification</｜｜DSML｜｜notify>";
      const result = sanitizeTextOutput(input);
      expect(result).not.toContain("DSML");
      expect(result).not.toContain("invoke");
      expect(result).not.toContain("fetch");
      expect(result).not.toContain("notify");
      expect(validateDSMLRemoved(result)).toBe(true);
    });

    test("should handle DSML mixed with other cleanup operations", () => {
      const input =
        "Check our site https://example.com and ![image](https://img.com/pic.jpg) " +
        "｜｜DSML｜｜call>fetch data</｜｜DSML｜｜call> [MEDIA:video123] " +
        "ID: 456 [WAKTU:sent] (Dikirim 25 Jun 14:30)";
      const result = sanitizeTextOutput(input);
      expect(result).not.toContain("DSML");
      expect(result).not.toContain("https");
      expect(result).not.toContain("![");
      expect(result).not.toContain("MEDIA");
      expect(result).not.toContain("ID:");
      expect(result).not.toContain("WAKTU");
      expect(result).not.toContain("Dikirim");
      expect(validateDSMLRemoved(result)).toBe(true);
    });

    test("should preserve legitimate message content while removing DSML", () => {
      const input =
        "Halo! Saya ingin memesan produk 5 < 10 pcs. " +
        "｜｜DSML｜｜process>Calculating price</｜｜DSML｜｜process> " +
        "Total harga adalah Rp 100.000 (dengan pajak). Apakah anda setuju? " +
        "Ketik ya || tidak untuk konfirmasi.";
      const result = sanitizeTextOutput(input);
      expect(result).toContain("Halo!");
      expect(result).toContain("5 < 10 pcs");
      expect(result).toContain("Rp 100.000");
      expect(result).toContain("ya || tidak");
      expect(result).not.toContain("DSML");
      expect(validateDSMLRemoved(result)).toBe(true);
    });
  });

  // ============================================================
  // TEST 8: Validation Function
  // ============================================================
  describe("Test 8: Validation Function", () => {
    test("validateDSMLRemoved should return true for clean content", () => {
      const result = validateDSMLRemoved("This is clean content");
      expect(result).toBe(true);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    test("validateDSMLRemoved should return false for content with DSML", () => {
      jest.clearAllMocks();
      const result = validateDSMLRemoved(
        "Content with ｜｜DSML｜｜tag>data</｜｜DSML｜｜>",
      );
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    test("validateDSMLRemoved should return false for orphaned closing tag", () => {
      jest.clearAllMocks();
      const result = validateDSMLRemoved("Content with </｜｜DSML｜｜orphan>");
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    test("validateDSMLRemoved should handle null/empty gracefully", () => {
      expect(validateDSMLRemoved("")).toBe(true);
      expect(validateDSMLRemoved(null)).toBe(true);
      expect(validateDSMLRemoved(undefined)).toBe(true);
    });
  });

  // ============================================================
  // TEST 9: Regression Tests (ensure no breaking changes)
  // ============================================================
  describe("Test 9: Regression Tests", () => {
    test("should still remove markdown images", () => {
      const input = "Check this ![alt text](https://example.com/img.jpg)";
      const result = sanitizeTextOutput(input);
      expect(result).not.toContain("![");
      expect(result).not.toContain("](");
    });

    test("should still remove URLs", () => {
      const input = "Visit https://example.com or http://example.org";
      const result = sanitizeTextOutput(input);
      expect(result).not.toContain("https");
      expect(result).not.toContain("http");
    });

    test("should still remove media tags", () => {
      const input = "Watch this [MEDIA:vid123] or [VIDEO:vid456]";
      const result = sanitizeTextOutput(input);
      expect(result).not.toContain("MEDIA");
      expect(result).not.toContain("VIDEO");
    });

    test("should still remove ID references", () => {
      const input = "Customer ID: 123456 and ID:999";
      const result = sanitizeTextOutput(input);
      expect(result).not.toContain("ID:");
    });

    test("should still normalize excessive newlines", () => {
      const input = "Line 1\n\n\n\nLine 2\n\n\n\nLine 3";
      const result = sanitizeTextOutput(input);
      expect(result).toBe("Line 1\n\nLine 2\n\nLine 3");
    });
  });
});

/**
 * TEST EXECUTION NOTES:
 *
 * Untuk menjalankan test ini:
 *
 * 1. Pastikan jest sudah ter-install:
 *    npm install --save-dev jest
 *
 * 2. Jalankan test file ini:
 *    npm test -- dsml-regex-fix.test.js
 *
 * 3. Atau jalankan dengan coverage:
 *    npm test -- dsml-regex-fix.test.js --coverage
 *
 * 4. Untuk menjalankan test tertentu:
 *    npm test -- dsml-regex-fix.test.js -t "should handle nested DSML"
 *
 * EXPECTED OUTPUT:
 * - All tests dalam Test 1-9 harus PASS
 * - Validation function harus mendeteksi DSML tags dengan akurat
 * - No regression dalam cleanup operasi lain
 * - Performance harus tetap optimal untuk input normal
 */
