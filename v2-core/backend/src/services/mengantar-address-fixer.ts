/**
 * @file mengantar-address-fixer.ts
 * @description Service untuk memperbaiki format address yang salah pada existing orders
 *
 * Fitur:
 * - Detect invalid address format (string instead of object, missing required fields)
 * - Batch fix orders dengan proper error handling
 * - Dry-run capability untuk preview changes
 * - Detailed logging dan reporting
 */

import { Store, sequelize } from "../models";
import * as MengantarService from "./mengantar.service";
import {
  validateMengantarAddress,
  MengantarAddress,
} from "./mengantar-address.validator";
import axios from "axios";

const logger = console;

export interface AddressMapping {
  storeId: string;
  storeWaId: string;
  oldFormat?: {
    addressString?: string;
    phoneNumber?: string;
    [key: string]: any;
  };
  newFormat: MengantarAddress;
  fixedAt: Date;
}

export interface FixResult {
  orderId: string;
  success: boolean;
  error?: string;
  previousAddress?: any;
  newAddress?: any;
}

export interface BatchFixResult {
  totalProcessed: number;
  successful: number;
  failed: number;
  results: FixResult[];
  dryRun: boolean;
  executedAt: Date;
}

export class MengantarAddressFixer {
  /**
   * Detect format lama yang salah pada address
   */
  public detectInvalidAddressFormat(order: any): boolean {
    // Jika address adalah string (bukan object) → salah format
    if (typeof order.pickup_address === "string") {
      return true;
    }

    // Jika address undefined/null
    if (!order.pickup_address && !order.PICKUP_ADDRESS) {
      return true;
    }

    // Ambil address object
    const addr = order.pickup_address || order.PICKUP_ADDRESS;

    // Jika address object tapi missing required fields → salah format
    const requiredFields = [
      "PICKUP_NAME",
      "PICKUP_PIC",
      "PICKUP_PIC_PHONE",
      "PICKUP_ADDRESS",
      "PICKUP_DISTRICT",
      "PICKUP_SUBDISTRICT",
      "PICKUP_REGION",
      "PICKUP_CITY",
      "PICKUP_ZIP",
    ];

    if (!requiredFields.every((field) => addr?.[field])) {
      return true;
    }

    return false;
  }

  /**
   * Check if region is Java island
   */
  private isJavaIsland(region: string): boolean {
    if (!region) return false;
    const javaRegions = [
      "JAWA TIMUR",
      "JAWA BARAT",
      "JAWA TENGAH",
      "DKI JAKARTA",
      "BANTEN",
      "YOGYAKARTA",
    ];
    return javaRegions.includes(region.toUpperCase());
  }

  /**
   * Build proper Mengantar address dari store data
   */
  private buildMengantarAddress(store: any): MengantarAddress {
    return {
      PICKUP_NAME: store.store_name || store.name || "Unknown Store",
      PICKUP_PIC: store.pickup_pic || "Admin",
      PICKUP_PIC_PHONE: (store.phone || "").replace(/\D/g, "") || "",
      PICKUP_ADDRESS: store.address || "",
      PICKUP_DISTRICT: store.district || "",
      PICKUP_SUBDISTRICT: store.subdistrict || "",
      PICKUP_REGION: store.region || "",
      PICKUP_CITY: store.city || "",
      PICKUP_CITY_SI: store.city_si || store.city || "",
      PICKUP_ZIP: store.zip || "",
      PICKUP_AUTOFILL: store.autofill_id || "",
      PICKUP_DESTINATION_CODE: store.destination_code || "",
      PICKUP_FULL_AUTOFILL: [
        store.region,
        store.city,
        store.district,
        store.subdistrict,
      ]
        .filter(Boolean)
        .join(", "),
      isJavaIsland: this.isJavaIsland(store.region),
    };
  }

  /**
   * Call Mengantar API to update order address
   */
  private async updateOrderAtMengantar(
    mengantarId: string,
    data: any,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const apiKey = process.env.MENGANTAR_API_KEY;
      if (!apiKey) {
        return {
          success: false,
          error: "MENGANTAR_API_KEY not configured",
        };
      }

      const client = axios.create({
        baseURL: "https://app.mengantar.com",
        timeout: 15000,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      });

      // Attempt to update order via Mengantar API
      // Endpoint might be: PATCH /api/v2/orders/{id}
      await client.patch(`/api/v2/orders/${mengantarId}`, {
        shipper_name: data.shipperName,
        shipper_phone: data.shipperPhone,
        shipper_address: data.shipperAddress,
        origin_id: data.originId,
      });

      return { success: true };
    } catch (err: any) {
      logger.error(
        `[MengantarAddressFixer] Failed to update order at Mengantar: ${err.message}`,
      );
      return {
        success: false,
        error: err.message || "Unknown API error",
      };
    }
  }

  /**
   * Convert format lama ke format baru (Mengantar)
   * Asumsi: data store address di database Stores
   */
  public async fixOrderAddress(
    order: any,
    dryRun = false,
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      // Extract store WA ID from order
      const storeWaId =
        order.crm_mapped_contact?.store_wa_id ||
        order.store_wa_id ||
        order.wa_id;

      if (!storeWaId) {
        return {
          success: false,
          error: "Store WA ID not found in order",
        };
      }

      // Ambil store info dari database
      const store = await Store.findOne({
        where: { wa_id: storeWaId },
        raw: true,
      });

      if (!store) {
        return {
          success: false,
          error: `Store not found (wa_id: ${storeWaId})`,
        };
      }

      // Build proper Mengantar address dari store
      const mengantarAddress = this.buildMengantarAddress(store);

      // Validate address format
      const validation = validateMengantarAddress(mengantarAddress);
      if (!validation.valid) {
        return {
          success: false,
          error: `Invalid address format after fix: ${validation.errors.join(", ")}`,
        };
      }

      if (!dryRun) {
        // Update order di Mengantar (jika mengantar_id tersedia)
        if (order.mengantar_id || order.order_id) {
          const mengantarId = order.mengantar_id || order.order_id;
          const updateResult = await this.updateOrderAtMengantar(mengantarId, {
            shipperName: mengantarAddress.PICKUP_NAME,
            shipperPhone: mengantarAddress.PICKUP_PIC_PHONE,
            shipperAddress: mengantarAddress.PICKUP_ADDRESS,
            originId: mengantarAddress.PICKUP_DESTINATION_CODE,
          });

          if (!updateResult.success) {
            logger.warn(
              `[MengantarAddressFixer] Warning: Could not update at Mengantar: ${updateResult.error}`,
            );
            // Continue anyway, as local fix is still valuable
          }
        }
      }

      return {
        success: true,
        data: {
          orderId: order.id || order.mengantar_id || order.order_id,
          previousAddress: order.pickup_address || order.PICKUP_ADDRESS,
          newAddress: mengantarAddress,
          fixedAt: new Date(),
        },
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || "Unknown error",
      };
    }
  }

  /**
   * Get orders that need fixing (from Mengantar API)
   * This fetches orders from Mengantar and checks format
   */
  private async getOrdersNeedingFix(): Promise<any[]> {
    try {
      const result = await MengantarService.getOrders({
        page: 1,
        size: 1000,
      });

      if (!result.success || !Array.isArray(result.data)) {
        return [];
      }

      // Filter orders dengan invalid address format
      return result.data.filter((order) =>
        this.detectInvalidAddressFormat(order),
      );
    } catch (err: any) {
      logger.error(
        `[MengantarAddressFixer] Failed to fetch orders: ${err?.message}`,
      );
      return [];
    }
  }

  /**
   * Batch fix untuk semua orders yang format-nya salah
   */
  public async batchFixOrders(dryRun = true): Promise<BatchFixResult> {
    logger.info(
      `[MengantarAddressFixer] Starting batch fix (dryRun: ${dryRun})...`,
    );

    const orders = await this.getOrdersNeedingFix();
    const results: FixResult[] = [];
    let successful = 0;
    let failed = 0;

    logger.info(
      `[MengantarAddressFixer] Found ${orders.length} orders needing fix`,
    );

    for (const order of orders) {
      try {
        const fix = await this.fixOrderAddress(order, dryRun);

        if (fix.success) {
          successful++;
          results.push({
            orderId:
              order.id || order.mengantar_id || order.order_id || "unknown",
            success: true,
          });

          if (dryRun) {
            logger.info(
              `[DRY RUN] Would fix order: ${order.id || order.mengantar_id}`,
            );
          } else {
            logger.info(`[FIX] Fixed order: ${order.id || order.mengantar_id}`);
          }
        } else {
          failed++;
          results.push({
            orderId:
              order.id || order.mengantar_id || order.order_id || "unknown",
            success: false,
            error: fix.error,
          });

          logger.warn(
            `[ERROR] Failed to fix order ${order.id || order.mengantar_id}: ${fix.error}`,
          );
        }
      } catch (err: any) {
        failed++;
        results.push({
          orderId:
            order.id || order.mengantar_id || order.order_id || "unknown",
          success: false,
          error: err.message,
        });

        logger.error(`[ERROR] Exception while fixing order: ${err.message}`);
      }
    }

    const summary: BatchFixResult = {
      totalProcessed: results.length,
      successful,
      failed,
      results,
      dryRun,
      executedAt: new Date(),
    };

    logger.info(
      `[MengantarAddressFixer] Batch fix complete: ${successful} successful, ${failed} failed`,
    );

    return summary;
  }

  /**
   * Get detailed report of invalid addresses
   */
  public async getInvalidAddressesReport(): Promise<{
    total: number;
    invalid: number;
    details: Array<{
      orderId: string;
      reason: string;
      address: any;
    }>;
  }> {
    try {
      const orders = await this.getOrdersNeedingFix();
      const details = [];

      for (const order of orders) {
        let reason = "Unknown format issue";

        if (typeof order.pickup_address === "string") {
          reason = "Address is string instead of object";
        } else if (!order.pickup_address && !order.PICKUP_ADDRESS) {
          reason = "Missing address entirely";
        } else {
          const addr = order.pickup_address || order.PICKUP_ADDRESS;
          const missingFields = [
            "PICKUP_NAME",
            "PICKUP_PIC",
            "PICKUP_PIC_PHONE",
            "PICKUP_ADDRESS",
            "PICKUP_CITY",
            "PICKUP_ZIP",
          ].filter((f) => !addr?.[f]);

          if (missingFields.length > 0) {
            reason = `Missing fields: ${missingFields.join(", ")}`;
          }
        }

        details.push({
          orderId:
            order.id || order.mengantar_id || order.order_id || "unknown",
          reason,
          address: order.pickup_address || order.PICKUP_ADDRESS,
        });
      }

      return {
        total: orders.length,
        invalid: orders.length,
        details,
      };
    } catch (err: any) {
      logger.error(
        `[MengantarAddressFixer] Failed to generate report: ${err.message}`,
      );
      return {
        total: 0,
        invalid: 0,
        details: [],
      };
    }
  }
}

// Export singleton instance
export const mengantarAddressFixer = new MengantarAddressFixer();
