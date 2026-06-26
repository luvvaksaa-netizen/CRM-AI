/**
 * @file mengantar-address-fixer.test.ts
 * @description Test suite for MengantarAddressFixer service
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { MengantarAddressFixer } from "../../src/services/mengantar-address-fixer";
import { MengantarAddress } from "../../src/services/mengantar-address.validator";

describe("MengantarAddressFixer", () => {
  let fixer: MengantarAddressFixer;

  beforeEach(() => {
    fixer = new MengantarAddressFixer();
  });

  describe("detectInvalidAddressFormat", () => {
    it("should detect string address as invalid", () => {
      const order = {
        id: "order-123",
        pickup_address: "This is a string address, not an object",
      };

      expect(fixer.detectInvalidAddressFormat(order)).toBe(true);
    });

    it("should detect missing address as invalid", () => {
      const order = {
        id: "order-123",
        // No pickup_address or PICKUP_ADDRESS
      };

      expect(fixer.detectInvalidAddressFormat(order)).toBe(true);
    });

    it("should detect object with missing required fields as invalid", () => {
      const order = {
        id: "order-123",
        pickup_address: {
          PICKUP_NAME: "Store Name",
          // Missing other required fields
        },
      };

      expect(fixer.detectInvalidAddressFormat(order)).toBe(true);
    });

    it("should accept valid address format", () => {
      const order = {
        id: "order-123",
        pickup_address: {
          PICKUP_NAME: "Store Name",
          PICKUP_PIC: "Admin",
          PICKUP_PIC_PHONE: "6281234567890",
          PICKUP_ADDRESS: "Jl. Main St 123",
          PICKUP_DISTRICT: "Kec. Test",
          PICKUP_SUBDISTRICT: "Kel. Test",
          PICKUP_REGION: "JAWA TIMUR",
          PICKUP_CITY: "Surabaya",
          PICKUP_ZIP: "60123",
        },
      };

      expect(fixer.detectInvalidAddressFormat(order)).toBe(false);
    });

    it("should use PICKUP_ADDRESS fallback when pickup_address is missing", () => {
      const order = {
        id: "order-123",
        PICKUP_ADDRESS: {
          PICKUP_NAME: "Store Name",
          PICKUP_PIC: "Admin",
          PICKUP_PIC_PHONE: "6281234567890",
          PICKUP_ADDRESS: "Jl. Main St 123",
          PICKUP_DISTRICT: "Kec. Test",
          PICKUP_SUBDISTRICT: "Kel. Test",
          PICKUP_REGION: "JAWA TIMUR",
          PICKUP_CITY: "Surabaya",
          PICKUP_ZIP: "60123",
        },
      };

      expect(fixer.detectInvalidAddressFormat(order)).toBe(false);
    });
  });

  describe("fixOrderAddress", () => {
    it("should fail when store WA ID not found", async () => {
      const order = {
        id: "order-123",
        pickup_address: "invalid",
      };

      const result = await fixer.fixOrderAddress(order, true);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Store WA ID not found");
    });

    it("should handle dryRun mode correctly", async () => {
      const order = {
        id: "order-123",
        wa_id: "628123456789",
        pickup_address: "invalid",
      };

      // Mock Store lookup would fail in test environment
      // This is a partial test showing the structure
      const result = await fixer.fixOrderAddress(order, true);

      // In dry-run mode, should not attempt API updates
      expect(typeof result.success).toBe("boolean");
    });
  });

  describe("batchFixOrders", () => {
    it("should return correct structure for batch results", async () => {
      // This test assumes no orders need fixing in test env
      const result = await fixer.batchFixOrders(true);

      expect(result).toHaveProperty("totalProcessed");
      expect(result).toHaveProperty("successful");
      expect(result).toHaveProperty("failed");
      expect(result).toHaveProperty("results");
      expect(result).toHaveProperty("dryRun");
      expect(result).toHaveProperty("executedAt");

      expect(result.dryRun).toBe(true);
      expect(Array.isArray(result.results)).toBe(true);
      expect(typeof result.totalProcessed).toBe("number");
      expect(typeof result.successful).toBe("number");
      expect(typeof result.failed).toBe("number");
    });

    it("should respect dryRun flag", async () => {
      const result = await fixer.batchFixOrders(true);
      expect(result.dryRun).toBe(true);

      const resultActual = await fixer.batchFixOrders(false);
      expect(resultActual.dryRun).toBe(false);
    });
  });

  describe("getInvalidAddressesReport", () => {
    it("should return report structure", async () => {
      const report = await fixer.getInvalidAddressesReport();

      expect(report).toHaveProperty("total");
      expect(report).toHaveProperty("invalid");
      expect(report).toHaveProperty("details");

      expect(typeof report.total).toBe("number");
      expect(typeof report.invalid).toBe("number");
      expect(Array.isArray(report.details)).toBe(true);
    });

    it("should include error reasons in report", async () => {
      const report = await fixer.getInvalidAddressesReport();

      if (report.details.length > 0) {
        const detail = report.details[0];

        expect(detail).toHaveProperty("orderId");
        expect(detail).toHaveProperty("reason");
        expect(detail).toHaveProperty("address");

        expect(typeof detail.orderId).toBe("string");
        expect(typeof detail.reason).toBe("string");
      }
    });
  });

  describe("detectInvalidAddressFormat - edge cases", () => {
    it("should handle null address", () => {
      const order = {
        id: "order-123",
        pickup_address: null,
      };

      expect(fixer.detectInvalidAddressFormat(order)).toBe(true);
    });

    it("should handle empty object", () => {
      const order = {
        id: "order-123",
        pickup_address: {},
      };

      expect(fixer.detectInvalidAddressFormat(order)).toBe(true);
    });

    it("should handle number as address", () => {
      const order = {
        id: "order-123",
        pickup_address: 12345,
      };

      expect(fixer.detectInvalidAddressFormat(order)).toBe(true);
    });

    it("should handle array as address", () => {
      const order = {
        id: "order-123",
        pickup_address: ["item1", "item2"],
      };

      expect(fixer.detectInvalidAddressFormat(order)).toBe(true);
    });
  });

  describe("Integration scenarios", () => {
    it("should handle mixed valid and invalid orders", async () => {
      // This simulates a batch with both valid and invalid orders
      const validOrder = {
        id: "valid-123",
        pickup_address: {
          PICKUP_NAME: "Store",
          PICKUP_PIC: "Admin",
          PICKUP_PIC_PHONE: "6281234567890",
          PICKUP_ADDRESS: "Jl. Main",
          PICKUP_DISTRICT: "Kec.",
          PICKUP_SUBDISTRICT: "Kel.",
          PICKUP_REGION: "JAWA TIMUR",
          PICKUP_CITY: "Surabaya",
          PICKUP_ZIP: "60123",
        },
      };

      const invalidOrder = {
        id: "invalid-123",
        pickup_address: "string address",
      };

      expect(fixer.detectInvalidAddressFormat(validOrder)).toBe(false);
      expect(fixer.detectInvalidAddressFormat(invalidOrder)).toBe(true);
    });

    it("should maintain order integrity during processing", async () => {
      const result = await fixer.batchFixOrders(true);

      // Each result should have an orderId
      result.results.forEach((r) => {
        expect(r.orderId).toBeDefined();
        expect(typeof r.success).toBe("boolean");
        if (!r.success) {
          expect(r.error).toBeDefined();
        }
      });
    });
  });
});
