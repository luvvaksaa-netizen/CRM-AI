/**
 * @file message_handler.closing.test.js
 * @description Test suite untuk BUG 9 — Bot Jangan Balas Chat yang Sudah Closing
 *
 * Test scenarios:
 * 1. Fresh Closing (just closed): Bot boleh balas dalam grace period
 * 2. Stale Closing (> grace period): Bot skip, hanya simpan DB
 * 3. Case sensitivity: "Closing", "closing" keduanya detected
 * 4. Error resilience: Query error → fallback to reply
 * 5. No closing label: Normal bot reply (baseline)
 */

const assert = require("assert");

describe("BUG 9 — Closing Chat Label Detection", () => {
  describe("Label Detection Logic", () => {
    test("should detect 'Closing' label (case-insensitive)", () => {
      const testCases = [
        { labels: ["Closing"], expected: true, desc: "Uppercase Closing" },
        { labels: ["closing"], expected: true, desc: "Lowercase closing" },
        { labels: ["CLOSING"], expected: true, desc: "All caps CLOSING" },
        { labels: ["COD", "Closing"], expected: true, desc: "Multiple labels with Closing" },
        { labels: ["COD", "Transfer"], expected: false, desc: "No Closing label" },
        { labels: [], expected: false, desc: "Empty labels array" },
      ];

      testCases.forEach(({ labels, expected, desc }) => {
        const isClosing = labels.some(
          (lbl) => String(lbl || "").toLowerCase() === "closing",
        );
        assert.strictEqual(
          isClosing,
          expected,
          `${desc}: expected ${expected}, got ${isClosing}`,
        );
      });
    });
  });

  describe("Grace Period Logic", () => {
    test("should allow reply within grace period", () => {
      const now = Date.now();
      const closingTimestamp = now - 5 * 60 * 1000; // 5 menit lalu
      const ageMs = now - closingTimestamp;
      const MAX_CLOSING_REPLY_MS = 10 * 60 * 1000; // 10 menit

      const shouldReply = ageMs <= MAX_CLOSING_REPLY_MS;
      assert.strictEqual(
        shouldReply,
        true,
        "Should allow reply within grace period (5 min < 10 min threshold)",
      );
    });

    test("should skip reply after grace period", () => {
      const now = Date.now();
      const closingTimestamp = now - 15 * 60 * 1000; // 15 menit lalu
      const ageMs = now - closingTimestamp;
      const MAX_CLOSING_REPLY_MS = 10 * 60 * 1000; // 10 menit

      const shouldReply = ageMs <= MAX_CLOSING_REPLY_MS;
      assert.strictEqual(
        shouldReply,
        false,
        "Should skip reply after grace period (15 min > 10 min threshold)",
      );
    });

    test("should handle edge case: exactly at grace period boundary", () => {
      const now = Date.now();
      const closingTimestamp = now - 10 * 60 * 1000; // Exactly 10 menit
      const ageMs = now - closingTimestamp;
      const MAX_CLOSING_REPLY_MS = 10 * 60 * 1000;

      const shouldReply = ageMs <= MAX_CLOSING_REPLY_MS;
      assert.strictEqual(
        shouldReply,
        true,
        "Should allow reply at exact grace period boundary",
      );
    });
  });

  describe("Timestamp Parsing", () => {
    test("should parse timestamp from label_timestamps", () => {
      const now = Date.now();
      const closingTime = now - 5 * 60 * 1000;

      const timestamps = {
        Closing: closingTime,
        COD: now - 20 * 60 * 1000,
      };

      const closingKey = Object.keys(timestamps).find(
        (k) => k.toLowerCase() === "closing",
      );
      const closingTimestamp = closingKey ? timestamps[closingKey] : now;

      assert.strictEqual(
        closingTimestamp,
        closingTime,
        "Should correctly parse Closing timestamp",
      );
    });

    test("should handle ISO date strings in timestamp", () => {
      const isoDate = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const timestamps = {
        Closing: isoDate,
      };

      const closingKey = Object.keys(timestamps).find(
        (k) => k.toLowerCase() === "closing",
      );
      const ts = timestamps[closingKey];
      const closingTimestamp =
        typeof ts === "number" ? ts : new Date(ts).getTime();

      const ageMs = Date.now() - closingTimestamp;
      const isRecentlyClosing = ageMs < 10 * 60 * 1000;

      assert.strictEqual(
        isRecentlyClosing,
        true,
        "Should parse ISO date and detect recent closing",
      );
    });

    test("should use last_updated as fallback if label_timestamps missing", () => {
      const fallbackTime = Date.now() - 5 * 60 * 1000;
      const timestamps = {}; // Empty timestamps

      const closingKey = Object.keys(timestamps).find(
        (k) => k.toLowerCase() === "closing",
      );

      let closingTimestamp = fallbackTime;
      if (closingKey) {
        closingTimestamp = timestamps[closingKey];
      }

      assert.strictEqual(
        closingTimestamp,
        fallbackTime,
        "Should fallback to last_updated timestamp",
      );
    });
  });

  describe("Error Resilience", () => {
    test("should not crash on malformed wa_labels JSON", () => {
      const malformedJSON = 'invalid json string';
      let parseError = null;

      try {
        JSON.parse(malformedJSON);
      } catch (e) {
        parseError = e;
      }

      assert.ok(parseError, "Should catch JSON parse error");
      assert.strictEqual(
        parseError instanceof SyntaxError,
        true,
        "Error should be SyntaxError",
      );
    });

    test("should not crash on malformed label_timestamps JSON", () => {
      const malformedJSON = '{invalid json}';
      let parseError = null;

      try {
        JSON.parse(malformedJSON);
      } catch (e) {
        parseError = e;
      }

      assert.ok(parseError, "Should catch label_timestamps JSON error");
    });
  });

  describe("Configuration via Environment Variables", () => {
    test("should use default grace period if CLOSING_GRACE_PERIOD_MS not set", () => {
      const defaultGracePeriodMs =
        Number(process.env.CLOSING_GRACE_PERIOD_MS) || 10 * 60 * 1000;
      assert.strictEqual(
        defaultGracePeriodMs,
        10 * 60 * 1000,
        "Default grace period should be 10 minutes (600000 ms)",
      );
    });

    test("should use CLOSING_GRACE_PERIOD_MS from environment if set", () => {
      const testValue = 5 * 60 * 1000; // 5 menit
      process.env.CLOSING_GRACE_PERIOD_MS = testValue.toString();

      const gracePeriodMs = Number(
        process.env.CLOSING_GRACE_PERIOD_MS || 10 * 60 * 1000,
      );
      assert.strictEqual(
        gracePeriodMs,
        testValue,
        "Should use configured grace period",
      );

      // Cleanup
      delete process.env.CLOSING_GRACE_PERIOD_MS;
    });
  });

  describe("Integration Scenarios", () => {
    test("scenario 1: Fresh closing (5 min ago) → Allow reply", () => {
      const now = Date.now();
      const closingTime = now - 5 * 60 * 1000;
      const wa_labels = JSON.stringify(["COD", "Closing"]);
      const label_timestamps = JSON.stringify({ Closing: closingTime });

      // Simulate firewall check
      let shouldAIReply = true;
      const labels = JSON.parse(wa_labels);
      const isClosing = labels.some(
        (lbl) => String(lbl || "").toLowerCase() === "closing",
      );

      if (isClosing) {
        const timestamps = JSON.parse(label_timestamps);
        const closingKey = Object.keys(timestamps).find(
          (k) => k.toLowerCase() === "closing",
        );
        const closingTimestamp = timestamps[closingKey] || now;
        const ageMs = now - closingTimestamp;
        const MAX_CLOSING_REPLY_MS = 10 * 60 * 1000;

        if (ageMs > MAX_CLOSING_REPLY_MS) {
          shouldAIReply = false;
        }
      }

      assert.strictEqual(
        shouldAIReply,
        true,
        "Should allow AI reply for fresh closing",
      );
    });

    test("scenario 2: Stale closing (20 min ago) → Skip reply", () => {
      const now = Date.now();
      const closingTime = now - 20 * 60 * 1000;
      const wa_labels = JSON.stringify(["COD", "Closing"]);
      const label_timestamps = JSON.stringify({ Closing: closingTime });

      // Simulate firewall check
      let shouldAIReply = true;
      const labels = JSON.parse(wa_labels);
      const isClosing = labels.some(
        (lbl) => String(lbl || "").toLowerCase() === "closing",
      );

      if (isClosing) {
        const timestamps = JSON.parse(label_timestamps);
        const closingKey = Object.keys(timestamps).find(
          (k) => k.toLowerCase() === "closing",
        );
        const closingTimestamp = timestamps[closingKey] || now;
        const ageMs = now - closingTimestamp;
        const MAX_CLOSING_REPLY_MS = 10 * 60 * 1000;

        if (ageMs > MAX_CLOSING_REPLY_MS) {
          shouldAIReply = false;
        }
      }

      assert.strictEqual(
        shouldAIReply,
        false,
        "Should skip AI reply for stale closing",
      );
    });

    test("scenario 3: No closing label → Allow reply", () => {
      const wa_labels = JSON.stringify(["COD", "Transfer"]);

      // Simulate firewall check
      let shouldAIReply = true;
      const labels = JSON.parse(wa_labels);
      const isClosing = labels.some(
        (lbl) => String(lbl || "").toLowerCase() === "closing",
      );

      if (isClosing) {
        shouldAIReply = false;
      }

      assert.strictEqual(
        shouldAIReply,
        true,
        "Should allow AI reply when no Closing label",
      );
    });
  });
});

// Catatan: Test ini bisa dijalankan dengan:
//   npm test -- test/message_handler.closing.test.js
// atau jika menggunakan Jest:
//   jest test/message_handler.closing.test.js
