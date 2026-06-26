import { Request, Response, NextFunction } from "express";
import * as MengantarService from "../services/mengantar.service";
import { AppConfig, ChatSummary, Store } from "../models";
import {
  validateMengantarAddress,
  auditOrderAddresses,
} from "../services/mengantar-address.validator";
import { mengantarAddressFixer } from "../services/mengantar-address-fixer";

export const getAddresses = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const addresses = await MengantarService.getAddresses();
    res.json({ success: true, data: addresses });
  } catch (e) {
    next(e);
  }
};

export const getOrders = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const filters: any = {
      page: parseInt(req.query.page as string) || 1,
      size: parseInt(req.query.size as string) || 500,
    };
    if (req.query.courier) filters.courier = req.query.courier as string;
    if (req.query.tracking_id)
      filters.tracking_id = req.query.tracking_id as string;
    if (req.query.order_id) filters.order_id = req.query.order_id as string;

    const dbAddressId = await AppConfig.findOne({
      where: { key: "mengantar_address_id" },
    });
    if (dbAddressId) {
      // Filter khusus origin id yang terdaftar untuk limitasi scope
      filters.origin_id = dbAddressId.getDataValue("value");
    }

    const result = await MengantarService.getOrders(filters);

    // MAPPING DATA KE CONTACT DATABASE
    if (result.success && Array.isArray(result.data)) {
      try {
        const summaries = await ChatSummary.findAll({
          attributes: [
            "contact_phone",
            "store_wa_id",
            "contact_name",
            "contact_id",
          ],
        });
        const summaryMap: Record<string, any> = {};
        for (const s of summaries) {
          if ((s as any).contact_phone) {
            const norm = (s as any).contact_phone.replace(/\D/g, "");
            if (norm) {
              summaryMap[norm] = s.toJSON();
            }
          }
        }

        // LOOKUP STORE NAME
        const stores = await Store.findAll({
          attributes: ["id", "wa_id", "name"],
          raw: true,
        });
        const storeMap: Record<string, string> = {};
        stores.forEach((store: any) => {
          const normalized = String(store.wa_id || "").replace(/\D/g, "");
          if (normalized) {
            storeMap[normalized] = store.name || "Toko Tidak Terdaftar";
          }
        });

        result.data = result.data.map((order: any) => {
          const cPhone = String(
            order.customer_phone || order.phone || "",
          ).replace(/\D/g, "");
          if (cPhone) {
            const match =
              summaryMap[cPhone] ||
              summaryMap[
                cPhone.startsWith("0") ? "62" + cPhone.slice(1) : ""
              ] ||
              summaryMap[cPhone.startsWith("62") ? "0" + cPhone.slice(2) : ""];
            if (match) {
              order.crm_mapped_contact = match;

              // ENRICH STORE NAME
              if (order.crm_mapped_contact?.store_wa_id) {
                const storeWaId = String(
                  order.crm_mapped_contact.store_wa_id,
                ).replace(/\D/g, "");
                order.crm_mapped_contact.store_name =
                  storeMap[storeWaId] || "Toko Tidak Terdaftar";
              }
            }
          }
          return order;
        });
      } catch (dbErr) {
        console.error("[Mengantar Controller] Failed to map contacts:", dbErr);
      }

      // ADD ADDRESS VALIDATION
      result.data = result.data.map((order: any) => {
        const validation = validateMengantarAddress(
          order.pickup_address || order.PICKUP_ADDRESS || {},
        );
        order._addressValidation = {
          valid: validation.valid,
          errors: validation.errors,
        };
        return order;
      });

      // APPLY SORTING
      const statusPriority: Record<string, number> = {
        pending: 1,
        processing: 2,
        picked: 3,
        in_transit: 4,
        delivered: 5,
      };

      result.data.sort((a: any, b: any) => {
        // 1. Sort by status (Pending > Processing > Picked > In Transit > Delivered)
        const statusA =
          statusPriority[(a.status || a.pod_code || "unknown").toLowerCase()] ||
          99;
        const statusB =
          statusPriority[(b.status || b.pod_code || "unknown").toLowerCase()] ||
          99;

        if (statusA !== statusB) return statusA - statusB;

        // 2. Same status: sort by date (newest first)
        const dateA = new Date(
          a.lastStatusChange || a.updatedAt || a.createdAt || 0,
        ).getTime();
        const dateB = new Date(
          b.lastStatusChange || b.updatedAt || b.createdAt || 0,
        ).getTime();

        if (dateA !== dateB) return dateB - dateA;

        // 3. Same date: sort by toko name (alphabetically)
        const tokoA = String(
          a.crm_mapped_contact?.store_name || "",
        ).toLowerCase();
        const tokoB = String(
          b.crm_mapped_contact?.store_name || "",
        ).toLowerCase();

        return tokoA.localeCompare(tokoB);
      });
    }

    res.json(result);
  } catch (e) {
    next(e);
  }
};

/**
 * POST /api/mengantar/create-order
 * Buat resi baru langsung dari CRM.
 * Body: customerName, customerPhone, customerAddress, destinationKeyword, parcelContent,
 *       weight, quantity, codAmount, courier, pickupType
 */
export const createOrder = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const {
      customerName,
      customerPhone,
      customerAddress,
      destinationKeyword,
      destinationId,
      parcelContent = "Label Nama / Stiker",
      weight = 1,
      quantity = 1,
      codAmount,
      goodsValue,
      courier,
      addressId,
      pickupType = "dropOff",
      deliveryInstruction,
      customProducts,
    } = req.body;

    if (
      !customerName ||
      !customerAddress ||
      (!destinationKeyword && !destinationId)
    ) {
      return res.status(400).json({
        success: false,
        error:
          "customerName, customerAddress, dan destinationKeyword wajib diisi",
      });
    }

    // Ambil address_id dari DB jika tidak dikirim
    let effectiveAddressId = addressId;
    if (!effectiveAddressId) {
      const dbAddressId = await AppConfig.findOne({
        where: { key: "mengantar_address_id" },
      });
      if (dbAddressId) {
        effectiveAddressId = dbAddressId.getDataValue("value");
        // Update env sementara agar service bisa baca
        process.env.MENGANTAR_ADDRESS_ID = effectiveAddressId;
      }
    }

    // Ambil API key dari DB jika belum di env
    if (!process.env.MENGANTAR_API_KEY) {
      const dbApiKey = await AppConfig.findOne({
        where: { key: "mengantar_api_key" },
      });
      if (dbApiKey)
        process.env.MENGANTAR_API_KEY = dbApiKey.getDataValue("value");
    }

    const result = await MengantarService.createOrder({
      customerName,
      customerPhone,
      customerAddress,
      destinationKeyword,
      destinationId,
      parcelContent,
      weight: Number(weight) || 1,
      quantity: Number(quantity) || 1,
      codAmount: codAmount ? Number(codAmount) : undefined,
      goodsValue: goodsValue ? Number(goodsValue) : undefined,
      courier,
      addressId: effectiveAddressId,
      pickupType,
      deliveryInstruction,
      customProducts,
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    // AUTO SEND RESI KE CUSTOMER
    try {
      const { sendManualMessage } = require("../whatsapp_service");
      const cPhone = String(customerPhone).replace(/\D/g, "");

      const summaries = await ChatSummary.findAll({
        attributes: ["contact_phone", "store_wa_id", "contact_id"],
      });
      let matchedSummary = null;
      for (const s of summaries) {
        if ((s as any).contact_phone) {
          const norm = (s as any).contact_phone.replace(/\D/g, "");
          if (
            norm === cPhone ||
            (norm.startsWith("0") ? "62" + norm.slice(1) : norm) === cPhone ||
            (norm.startsWith("62") ? "0" + norm.slice(2) : norm) === cPhone
          ) {
            matchedSummary = s;
            break;
          }
        }
      }

      if (matchedSummary) {
        const { formatResiMessage } = require("../services/mengantar.service");
        const resiMsg = formatResiMessage(result);
        await sendManualMessage(
          (matchedSummary as any).store_wa_id,
          (matchedSummary as any).contact_id,
          resiMsg,
        );
        console.log(
          `[Auto-Resi] Resi dikirim otomatis ke ${customerPhone} via ${(matchedSummary as any).store_wa_id}`,
        );
      } else {
        console.log(
          `[Auto-Resi] Kontak ${customerPhone} tidak ditemukan di DB. Pesan WA resi tidak dikirim otomatis.`,
        );
      }
    } catch (waErr: any) {
      console.error(
        "[Auto-Resi] Gagal mengirim pesan otomatis:",
        waErr.message,
      );
    }

    res.json(result);
  } catch (e) {
    next(e);
  }
};

export const getConfig = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const [apiKey, addressId, courier, senderName, phone] = await Promise.all([
      AppConfig.findOne({ where: { key: "mengantar_api_key" } }),
      AppConfig.findOne({ where: { key: "mengantar_address_id" } }),
      AppConfig.findOne({ where: { key: "mengantar_courier" } }),
      AppConfig.findOne({ where: { key: "mengantar_sender_name" } }),
      AppConfig.findOne({ where: { key: "mengantar_phone" } }),
    ]);

    const rawKey = apiKey?.getDataValue("value") || "";
    res.json({
      success: true,
      config: {
        api_key: rawKey ? "••••••••" : "",
        api_key_raw: rawKey,
        address_id: addressId?.getDataValue("value") || "",
        courier: courier?.getDataValue("value") || "JT",
        sender_name: senderName?.getDataValue("value") || "",
        phone: phone?.getDataValue("value") || "",
      },
      has_env: MengantarService.isMengantarConfigured(),
    });
  } catch (e) {
    next(e);
  }
};

export const updateConfig = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { api_key, address_id, courier, sender_name, phone } = req.body;

    const upserts: Promise<any>[] = [];
    if (api_key)
      upserts.push(
        AppConfig.upsert({ key: "mengantar_api_key", value: api_key } as any),
      );
    if (address_id)
      upserts.push(
        AppConfig.upsert({
          key: "mengantar_address_id",
          value: address_id,
        } as any),
      );
    if (courier)
      upserts.push(
        AppConfig.upsert({ key: "mengantar_courier", value: courier } as any),
      );
    if (sender_name !== undefined)
      upserts.push(
        AppConfig.upsert({
          key: "mengantar_sender_name",
          value: sender_name,
        } as any),
      );
    if (phone !== undefined)
      upserts.push(
        AppConfig.upsert({ key: "mengantar_phone", value: phone } as any),
      );

    await Promise.all(upserts);

    // Sync env vars agar service langsung pakai config baru
    if (api_key) process.env.MENGANTAR_API_KEY = api_key;
    if (address_id) process.env.MENGANTAR_ADDRESS_ID = address_id;
    if (courier) process.env.MENGANTAR_COURIER = courier;

    res.json({
      success: true,
      message: "Konfigurasi Mengantar berhasil disimpan",
    });
  } catch (e) {
    next(e);
  }
};

/**
 * GET /api/mengantar/audit
 * Audit all order addresses for validation issues
 * Returns counts of valid/invalid addresses and detailed error list
 */
export const auditOrders = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const audit = await auditOrderAddresses();
    res.json({
      success: true,
      audit,
      message:
        audit.totalOrders > 0
          ? `${audit.validAddresses}/${audit.totalOrders} orders have valid addresses`
          : "No orders found to audit",
    });
  } catch (e) {
    next(e);
  }
};

/**
 * GET /api/mengantar/fix-addresses/report
 * Get report of addresses needing fixes
 * Returns detailed list of invalid address format issues
 */
export const getAddressFixReport = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const report = await mengantarAddressFixer.getInvalidAddressesReport();
    res.json({
      success: true,
      data: report,
      message:
        report.invalid > 0
          ? `Found ${report.invalid} orders with invalid address format`
          : "All addresses are properly formatted",
    });
  } catch (e) {
    next(e);
  }
};

/**
 * POST /api/mengantar/fix-addresses
 * Fix invalid order addresses
 * Body: { dryRun?: boolean }
 * Requires admin authorization
 */
export const fixOrderAddresses = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Require authorization (admin only)
    if ((req as any).user?.role !== "admin") {
      return res.status(403).json({
        success: false,
        error: "Admin access required",
      });
    }

    const { dryRun = true } = req.body;

    if (typeof dryRun !== "boolean") {
      return res.status(400).json({
        success: false,
        error: "dryRun must be boolean",
      });
    }

    const result = await mengantarAddressFixer.batchFixOrders(dryRun);

    res.json({
      success: true,
      dryRun,
      data: result,
      message: dryRun
        ? `[DRY RUN] Would fix ${result.successful}/${result.totalProcessed} orders`
        : `Fixed ${result.successful}/${result.totalProcessed} orders successfully`,
    });
  } catch (e) {
    next(e);
  }
};
