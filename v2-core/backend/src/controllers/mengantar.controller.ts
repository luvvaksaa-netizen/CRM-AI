import { Request, Response, NextFunction } from 'express';
import * as MengantarService from '../services/mengantar.service';
import { AppConfig } from '../models';

export const getAddresses = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const addresses = await MengantarService.getAddresses();
    res.json({ success: true, data: addresses });
  } catch (e) {
    next(e);
  }
};

export const getOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters: any = {
      page: parseInt(req.query.page as string) || 1,
      size: parseInt(req.query.size as string) || 25,
    };
    if (req.query.courier) filters.courier = req.query.courier as string;
    if (req.query.tracking_id) filters.tracking_id = req.query.tracking_id as string;
    if (req.query.order_id) filters.order_id = req.query.order_id as string;
    const result = await MengantarService.getOrders(filters);
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
export const createOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      customerName,
      customerPhone,
      customerAddress,
      destinationKeyword,
      destinationId,
      parcelContent = 'Label Nama / Stiker',
      weight = 1,
      quantity = 1,
      codAmount,
      goodsValue,
      courier,
      addressId,
      pickupType = 'dropOff',
      deliveryInstruction,
      customProducts,
    } = req.body;

    if (!customerName || !customerAddress || (!destinationKeyword && !destinationId)) {
      return res.status(400).json({
        success: false,
        error: 'customerName, customerAddress, dan destinationKeyword wajib diisi'
      });
    }

    // Ambil address_id dari DB jika tidak dikirim
    let effectiveAddressId = addressId;
    if (!effectiveAddressId) {
      const dbAddressId = await AppConfig.findOne({ where: { key: 'mengantar_address_id' } });
      if (dbAddressId) {
        effectiveAddressId = dbAddressId.getDataValue('value');
        // Update env sementara agar service bisa baca
        process.env.MENGANTAR_ADDRESS_ID = effectiveAddressId;
      }
    }

    // Ambil API key dari DB jika belum di env
    if (!process.env.MENGANTAR_API_KEY) {
      const dbApiKey = await AppConfig.findOne({ where: { key: 'mengantar_api_key' } });
      if (dbApiKey) process.env.MENGANTAR_API_KEY = dbApiKey.getDataValue('value');
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

    res.json(result);
  } catch (e) {
    next(e);
  }
};

export const getConfig = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [apiKey, addressId, courier, senderName, phone] = await Promise.all([
      AppConfig.findOne({ where: { key: 'mengantar_api_key' } }),
      AppConfig.findOne({ where: { key: 'mengantar_address_id' } }),
      AppConfig.findOne({ where: { key: 'mengantar_courier' } }),
      AppConfig.findOne({ where: { key: 'mengantar_sender_name' } }),
      AppConfig.findOne({ where: { key: 'mengantar_phone' } }),
    ]);

    const rawKey = apiKey?.getDataValue('value') || '';
    res.json({
      success: true,
      config: {
        api_key: rawKey ? '••••••••' : '',
        api_key_raw: rawKey,
        address_id: addressId?.getDataValue('value') || '',
        courier: courier?.getDataValue('value') || 'JT',
        sender_name: senderName?.getDataValue('value') || '',
        phone: phone?.getDataValue('value') || '',
      },
      has_env: MengantarService.isMengantarConfigured()
    });
  } catch (e) {
    next(e);
  }
};

export const updateConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { api_key, address_id, courier, sender_name, phone } = req.body;

    const upserts: Promise<any>[] = [];
    if (api_key)      upserts.push(AppConfig.upsert({ key: 'mengantar_api_key',    value: api_key } as any));
    if (address_id)   upserts.push(AppConfig.upsert({ key: 'mengantar_address_id', value: address_id } as any));
    if (courier)      upserts.push(AppConfig.upsert({ key: 'mengantar_courier',    value: courier } as any));
    if (sender_name !== undefined) upserts.push(AppConfig.upsert({ key: 'mengantar_sender_name', value: sender_name } as any));
    if (phone !== undefined)       upserts.push(AppConfig.upsert({ key: 'mengantar_phone',       value: phone } as any));

    await Promise.all(upserts);

    // Sync env vars agar service langsung pakai config baru
    if (api_key)    process.env.MENGANTAR_API_KEY    = api_key;
    if (address_id) process.env.MENGANTAR_ADDRESS_ID = address_id;
    if (courier)    process.env.MENGANTAR_COURIER    = courier;

    res.json({ success: true, message: 'Konfigurasi Mengantar berhasil disimpan' });
  } catch (e) {
    next(e);
  }
};
