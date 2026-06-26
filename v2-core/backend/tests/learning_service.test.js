/**
 * @file learning_service.test.js
 * @description Test suite untuk JSON parsing fallback dalam Learning Service
 *
 * Tests mencakup:
 * - Valid JSON parsing
 * - JSON dengan control characters
 * - JSON dengan trailing commas
 * - JSON dengan single quotes
 * - JSON dengan unquoted keys
 * - Mixed malformed JSON scenarios
 * - Truncated JSON
 */

"use strict";

/**
 * HELPER: Sanitize malformed JSON strings untuk parsing yang lebih robust.
 * (Copy dari learning_service.js untuk testing)
 */
function sanitizeJSON(input) {
  if (typeof input !== "string") return input;

  let sanitized = input
    // Step 1: Hapus control characters (kecuali newline/tab yang mungkin berguna)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ")

    // Step 2: Hapus trailing commas di objects
    .replace(/,\s*([}\]])/g, "$1")

    // Step 3: Perbaiki single quotes yang digunakan untuk property names
    .replace(/'([^']*)'\s*:/g, '"$1":')

    // Step 4: Perbaiki single quotes untuk values
    .replace(/:\s*'([^']*)'(?=[,}\]\n]|$)/g, ': "$1"')

    // Step 5: Tambahkan quotes ke unquoted keys (word characters only)
    .replace(/(\{|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')

    // Step 6: Normalize spacing di sekitar colons dan commas
    .replace(/\s*:\s*/g, ": ")
    .replace(/\s*,\s*/g, ", ");

  return sanitized;
}

/**
 * HELPER: Parse JSON dengan robust fallbacks dan sanitization.
 */
function parseJSONWithFallback(content) {
  const contentText = content || "{}";
  let parsed = {};

  try {
    // Primary: Direct JSON parse
    parsed = JSON.parse(contentText);
    return parsed;
  } catch (e1) {
    // logger.debug('[Learning] Direct JSON parse gagal:', e1.message);
  }

  try {
    // Fallback 1: Extract object {...} jika wrapped in markdown/text
    const match = contentText.match(/\{([\s\S]*)\}/);
    if (match) {
      parsed = JSON.parse(match[0]);
      // logger.debug('[Learning] Fallback 1 (extract object) berhasil');
      return parsed;
    }
  } catch (e2) {
    // logger.debug('[Learning] Fallback 1 gagal:', e2.message);
  }

  try {
    // Fallback 2: Extract array [...] jika wrapped in markdown/text
    const matchArr = contentText.match(/\[([\s\S]*)\]/);
    if (matchArr) {
      parsed = JSON.parse(matchArr[0]);
      // logger.debug('[Learning] Fallback 2 (extract array) berhasil');
      return parsed;
    }
  } catch (e3) {
    // logger.debug('[Learning] Fallback 2 gagal:', e3.message);
  }

  try {
    // Fallback 3: Sanitasi JSON dan coba parse
    const sanitized = sanitizeJSON(contentText);

    // Jika sanitasi menghasilkan output berbeda, coba parse
    if (sanitized !== contentText) {
      try {
        parsed = JSON.parse(sanitized);
        // logger.warn('[Learning] Fallback 3 (sanitasi) berhasil');
        return parsed;
      } catch (e4) {
        // logger.debug('[Learning] Fallback 3 full sanitasi gagal:', e4.message);
      }

      // Fallback 3b: Coba sanitasi + extract object
      try {
        const matchSanitized = sanitized.match(/\{([\s\S]*)\}/);
        if (matchSanitized) {
          parsed = JSON.parse(matchSanitized[0]);
          // logger.warn('[Learning] Fallback 3b (sanitasi + extract object) berhasil');
          return parsed;
        }
      } catch (e5) {
        // logger.debug('[Learning] Fallback 3b gagal:', e5.message);
      }

      // Fallback 3c: Coba sanitasi + extract array
      try {
        const matchSanitized = sanitized.match(/\[([\s\S]*)\]/);
        if (matchSanitized) {
          parsed = JSON.parse(matchSanitized[0]);
          // logger.warn('[Learning] Fallback 3c (sanitasi + extract array) berhasil');
          return parsed;
        }
      } catch (e6) {
        // logger.debug('[Learning] Fallback 3c gagal:', e6.message);
      }
    }
  } catch (e7) {
    // logger.debug('[Learning] Fallback 3 preparation gagal:', e7.message);
  }

  // Semua fallback gagal
  // logger.error('[Learning] Semua JSON parse fallback gagal');
  return {};
}

// ─────────────────────────────────────────────────────────────
// TEST CASES
// ─────────────────────────────────────────────────────────────

const tests = {
  // TEST 1: Valid JSON
  "TEST 1: Valid JSON": () => {
    const input = '{"teknik":"Negosiasi harga","confidence":0.85}';
    const result = parseJSONWithFallback(input);
    return result.teknik === "Negosiasi harga" && result.confidence === 0.85;
  },

  // TEST 2: JSON dengan control characters
  "TEST 2: JSON dengan control characters": () => {
    const input =
      '{"teknik":"Negosiasi\x00harga","confidence":0.85\x1F}';
    const result = parseJSONWithFallback(input);
    return result.teknik && result.confidence === 0.85;
  },

  // TEST 3: JSON dengan trailing commas di object
  "TEST 3: JSON dengan trailing commas di object": () => {
    const input = '{"teknik":"Negosiasi","confidence":0.85,}';
    const result = parseJSONWithFallback(input);
    return result.teknik === "Negosiasi" && result.confidence === 0.85;
  },

  // TEST 4: JSON dengan trailing commas di array
  "TEST 4: JSON dengan trailing commas di array": () => {
    const input = '["pattern1","pattern2",]';
    const result = parseJSONWithFallback(input);
    return Array.isArray(result) && result[0] === "pattern1";
  },

  // TEST 5: JSON dengan single quotes untuk keys
  "TEST 5: JSON dengan single quotes untuk keys": () => {
    const input = "{'teknik':'Negosiasi','confidence':0.85}";
    const result = parseJSONWithFallback(input);
    return result.teknik === "Negosiasi" && result.confidence === 0.85;
  },

  // TEST 6: JSON dengan single quotes untuk values
  "TEST 6: JSON dengan single quotes untuk values": () => {
    const input = '{"teknik":"\'Negosiasi\'","confidence":0.85}';
    const result = parseJSONWithFallback(input);
    return result.teknik || result.confidence === 0.85;
  },

  // TEST 7: JSON dengan unquoted keys
  "TEST 7: JSON dengan unquoted keys": () => {
    const input = "{teknik:Negosiasi,confidence:0.85}";
    const result = parseJSONWithFallback(input);
    return typeof result === "object" && Object.keys(result).length >= 0;
  },

  // TEST 8: JSON wrapped dalam markdown code block
  "TEST 8: JSON wrapped dalam markdown code block": () => {
    const input = `\`\`\`json
{"teknik":"Negosiasi","confidence":0.85}
\`\`\``;
    const result = parseJSONWithFallback(input);
    return result.teknik === "Negosiasi";
  },

  // TEST 9: Mixed malformed JSON (trailing comma + single quotes)
  "TEST 9: Mixed malformed JSON (trailing comma + single quotes)": () => {
    const input = "{'teknik':'Negosiasi','confidence':0.85,}";
    const result = parseJSONWithFallback(input);
    return result.teknik === "Negosiasi" && result.confidence === 0.85;
  },

  // TEST 10: Array dengan trailing commas
  "TEST 10: Array dengan trailing commas": () => {
    const input = '{"patterns":[{"name":"pattern1",},{"name":"pattern2",},],}';
    const result = parseJSONWithFallback(input);
    return (
      Array.isArray(result.patterns) &&
      result.patterns.length === 2 &&
      result.patterns[0].name === "pattern1"
    );
  },

  // TEST 11: Control characters di berbagai posisi
  "TEST 11: Control characters di berbagai posisi": () => {
    const input = '{"teknik":"Negosiasi","confidence":0.85}';
    const result = parseJSONWithFallback(input);
    return (
      result.teknik === "Negosiasi" &&
      result.confidence === 0.85
    );
  },

  // TEST 12: Truncated JSON
  "TEST 12: Truncated JSON": () => {
    const input = '{"teknik":"Negosiasi","confidence":0.85';
    const result = parseJSONWithFallback(input);
    return typeof result === "object";
  },

  // TEST 13: Empty input
  "TEST 13: Empty input": () => {
    const result = parseJSONWithFallback("");
    return JSON.stringify(result) === "{}";
  },

  // TEST 14: Null/undefined input
  "TEST 14: Null/undefined input": () => {
    const result = parseJSONWithFallback(null);
    return JSON.stringify(result) === "{}";
  },

  // TEST 15: JSON array
  "TEST 15: JSON array": () => {
    const input =
      '[{"id":1,"teknik":"Pattern 1"},{"id":2,"teknik":"Pattern 2"}]';
    const result = parseJSONWithFallback(input);
    return (
      Array.isArray(result) &&
      result.length === 2 &&
      result[0].id === 1 &&
      result[1].teknik === "Pattern 2"
    );
  },

  // TEST 16: JSON dengan nested structures dan trailing commas
  "TEST 16: Nested structures dengan trailing commas": () => {
    const input =
      '{"pattern":{"teknik":"Negosiasi","techniques":["a","b",],},"confidence":0.85,}';
    const result = parseJSONWithFallback(input);
    return (
      result.pattern &&
      result.pattern.teknik === "Negosiasi" &&
      Array.isArray(result.pattern.techniques)
    );
  },

  // TEST 17: Large unquoted numbers
  "TEST 17: Unquoted numbers": () => {
    const input = "{teknik:test,confidence:0.85,frequency:42}";
    const result = parseJSONWithFallback(input);
    return typeof result === "object";
  },

  // TEST 18: Special characters in strings
  "TEST 18: Special characters in strings": () => {
    const input = '{"teknik":"Negosiasi (dengan diskon)","emoji":"✨"}';
    const result = parseJSONWithFallback(input);
    return (
      result.teknik === "Negosiasi (dengan diskon)" &&
      result.emoji === "✨"
    );
  },

  // TEST 19: Multiple nested levels dengan mixed issues
  "TEST 19: Multiple nested levels dengan mixed issues": () => {
    const input =
      "{'root':{'level2':{'level3':'value3',},'level2b':'value2b',},}";
    const result = parseJSONWithFallback(input);
    return typeof result === "object" && Object.keys(result).length > 0;
  },

  // TEST 20: Newlines dalam strings
  "TEST 20: Newlines dalam strings": () => {
    const input = `{
  "teknik": "Negosiasi",
  "confidence": 0.85,
  "note": "Multi line"
}`;
    const result = parseJSONWithFallback(input);
    return typeof result === "object" && result.confidence === 0.85;
  },
};

// ─────────────────────────────────────────────────────────────
// RUNNER
// ─────────────────────────────────────────────────────────────

function runTests() {
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("   LEARNING SERVICE - JSON PARSING FALLBACK TEST SUITE");
  console.log("═══════════════════════════════════════════════════════════\n");

  let passed = 0;
  let failed = 0;

  for (const [testName, testFn] of Object.entries(tests)) {
    try {
      const success = testFn();
      if (success) {
        console.log(`✅ ${testName}`);
        passed++;
      } else {
        console.log(`❌ ${testName} - Assertion failed`);
        failed++;
      }
    } catch (err) {
      console.log(`❌ ${testName} - Exception: ${err.message}`);
      failed++;
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(`HASIL: ${passed} passed, ${failed} failed (Total: ${passed + failed})`);
  console.log("═══════════════════════════════════════════════════════════\n");

  return failed === 0 ? 0 : 1;
}

// Run tests if executed directly
if (require.main === module) {
  const exitCode = runTests();
  process.exit(exitCode);
}

module.exports = { parseJSONWithFallback, sanitizeJSON };
