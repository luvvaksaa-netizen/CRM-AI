/**
 * Test suite untuk URL encoding/decoding utilities
 * Tests untuk memastikan encoding dan decoding bekerja dengan benar
 * khususnya untuk WhatsApp IDs dengan special characters
 */

import {
  encodeWAId,
  decodeWAId,
  isValidWAId,
  testRoundtripEncoding,
} from "./urlEncoding";

describe("URL Encoding Utilities for WhatsApp IDs", () => {
  describe("encodeWAId", () => {
    it("should encode regular phone number IDs", () => {
      const id = "62123456789@c.us";
      const encoded = encodeWAId(id);
      expect(encoded).toContain("%40"); // @ is encoded to %40
      expect(encoded).toContain("c.us");
    });

    it("should encode LID format", () => {
      const id = "120@lid";
      const encoded = encodeWAId(id);
      expect(encoded).toEqual("120%40lid");
    });

    it("should handle special characters", () => {
      const id = "62812345@c.us";
      const encoded = encodeWAId(id);
      expect(typeof encoded).toBe("string");
      expect(encoded.length).toBeGreaterThan(0);
    });
  });

  describe("decodeWAId", () => {
    it("should decode encoded phone number IDs", () => {
      const encoded = "62123456789%40c.us";
      const decoded = decodeWAId(encoded);
      expect(decoded).toEqual("62123456789@c.us");
    });

    it("should decode encoded LID format", () => {
      const encoded = "120%40lid";
      const decoded = decodeWAId(encoded);
      expect(decoded).toEqual("120@lid");
    });

    it("should handle double encoding (edge case)", () => {
      const id = "62123456789@c.us";
      const doubleEncoded = encodeURIComponent(encodeURIComponent(id));
      const decoded = decodeWAId(doubleEncoded);
      // Note: This is expected behavior - decoding once should give partially decoded string
      expect(decoded).toContain("@");
    });
  });

  describe("roundtrip encoding", () => {
    it("should encode and decode to original for @c.us format", () => {
      const original = "62123456789@c.us";
      const result = testRoundtripEncoding(original);
      expect(result).toBe(true);
    });

    it("should encode and decode to original for @lid format", () => {
      const original = "120@lid";
      const result = testRoundtripEncoding(original);
      expect(result).toBe(true);
    });

    it("should encode and decode to original for complex IDs", () => {
      const testIds = [
        "6281234567890@c.us",
        "12345@lid",
        "919876543210@c.us",
        "999999999@lid",
      ];

      testIds.forEach((id) => {
        const result = testRoundtripEncoding(id);
        expect(result).toBe(true);
      });
    });
  });

  describe("isValidWAId", () => {
    it("should validate @c.us format", () => {
      expect(isValidWAId("62123456789@c.us")).toBe(true);
      expect(isValidWAId("919876543210@c.us")).toBe(true);
    });

    it("should validate @lid format", () => {
      expect(isValidWAId("120@lid")).toBe(true);
      expect(isValidWAId("999999@lid")).toBe(true);
    });

    it("should reject invalid formats", () => {
      expect(isValidWAId("invalid")).toBe(false);
      expect(isValidWAId("62123456789")).toBe(false);
      expect(isValidWAId("@c.us")).toBe(false);
      expect(isValidWAId("")).toBe(false);
      expect(isValidWAId(null as any)).toBe(false);
    });
  });

  describe("URL compatibility", () => {
    it("should produce URL-safe encoded strings", () => {
      const id = "62123456789@c.us";
      const encoded = encodeWAId(id);
      // URL-safe means no spaces or special chars that break URLs
      expect(/^[a-zA-Z0-9%._-]*$/.test(encoded)).toBe(true);
    });

    it("should work in URL path context", () => {
      const storeId = "62123456789@c.us";
      const contactId = "62987654321@c.us";
      const path = `/api/smart-labels/${encodeWAId(storeId)}/${encodeWAId(contactId)}`;
      // Should not contain unencoded @ or other problematic chars
      expect(path).not.toContain("/@");
      expect(path).toContain("%40");
    });
  });

  describe("error handling", () => {
    it("should handle undefined values gracefully", () => {
      expect(() => encodeWAId(undefined as any)).toThrow();
    });

    it("should handle null values gracefully", () => {
      expect(() => encodeWAId(null as any)).toThrow();
    });

    it("should decode non-encoded strings without error", () => {
      const result = decodeWAId("120@lid");
      expect(result).toEqual("120@lid");
    });
  });
});

describe("Real-world scenarios", () => {
  it("Test 1: Normal Indonesia phone number", () => {
    const storeId = "62123456789@c.us";
    const contactId = "62987654321@c.us";

    const encodedStore = encodeWAId(storeId);
    const encodedContact = encodeWAId(contactId);

    expect(decodeWAId(encodedStore)).toEqual(storeId);
    expect(decodeWAId(encodedContact)).toEqual(contactId);
  });

  it("Test 2: LID format contact", () => {
    const storeId = "62123456789@c.us";
    const contactId = "120@lid";

    const encodedStore = encodeWAId(storeId);
    const encodedContact = encodeWAId(contactId);

    expect(decodeWAId(encodedStore)).toEqual(storeId);
    expect(decodeWAId(encodedContact)).toEqual(contactId);

    // Verify in URL context
    const url = `/api/smart-labels/${encodedStore}/${encodedContact}`;
    expect(url).not.toContain("/@");
  });

  it("Test 3: API call simulation", () => {
    const storeId = "62123456789@c.us";
    const contactId = "62987654321@c.us";
    const labelName = "follow-up";

    // Simulating API URL construction
    const baseUrl = "/api/smart-labels";
    const deleteUrl = `${baseUrl}/${encodeWAId(storeId)}/${encodeURIComponent(labelName)}`;

    // Should be able to decode back (though labelName is not a WA ID)
    const decodedStore = decodeWAId(encodeWAId(storeId));
    expect(decodedStore).toEqual(storeId);
  });
});
