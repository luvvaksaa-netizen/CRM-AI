/**
 * @file mengantar.service.ts
 * @description Mengantar Shipping Service (TypeScript) — v2-core
 *
 * Re-export dari mengantar_service.js yang sudah direfactor,
 * plus typed wrappers untuk integrasi dengan TypeScript controllers.
 *
 * ENV:
 *   MENGANTAR_API_KEY    - API Key Mengantar
 *   MENGANTAR_ADDRESS_ID - Default pickup address ID
 *   MENGANTAR_COURIER    - Default courier (JT/JNE/Sap/...)
 */

import axios, { AxiosInstance } from "axios";
import * as fs from "fs";
import * as path from "path";

// ── Konfigurasi ──────────────────────────────────────────────────────────────
const BASE_URL = "https://app.mengantar.com";
const KEDIRI_KOTA_ORIGIN_ID = "5fc63405f8f44b34aa4c4f9a";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const CACHE_FILE = path.join(DATA_DIR, "mengantar_cache.json");

// ── Types ─────────────────────────────────────────────────────────────────────
export interface MengantarAddress {
  _id: string;
  PICKUP_NAME: string;
  PICKUP_PIC: string;
  PICKUP_PIC_PHONE: string;
  PICKUP_ADDRESS: string;
  PICKUP_DISTRICT: string;
  PICKUP_SUBDISTRICT: string;
  PICKUP_CITY: string;
  PICKUP_REGION: string;
  PICKUP_ZIP: string;
  PICKUP_AUTOFILL: string;
  PICKUP_ORIGIN_CODE: string;
}

export interface MengantarAddressSearchResult {
  id: string;
  label: string;
  province: string;
  city: string;
  district: string;
  subdistrict: string;
  zip: string;
  destination_code: string;
}

export interface MengantarCreateOrderParams {
  customerName: string;
  customerPhone?: string;
  customerAddress: string;
  destinationKeyword?: string;
  destinationId?: string;
  weight?: number;
  quantity?: number;
  parcelContent: string;
  goodsValue?: number;
  codAmount?: number;
  courier?: string;
  addressId?: string;
  customProducts?: Array<{
    name: string;
    variant?: string;
    qty: number;
    price?: number;
    weight?: number;
  }>;
  pickupType?: "scheduledPickup" | "dropOff";
  deliveryInstruction?: string;
}

export interface MengantarCreateOrderResult {
  success: boolean;
  cnote_no?: string;
  order_id?: string;
  batch?: string;
  batch_id?: string;
  courier?: string;
  customer?: string;
  destination?: string;
  is_paid?: boolean;
  is_unpaid?: boolean;
  error?: string;
  raw?: any;
}

// ── Cache ─────────────────────────────────────────────────────────────────────
function _loadCache(): Record<string, any> {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {};
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch (_) {
    return {};
  }
}

function _persistCache(cache: Record<string, any>): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (_) {}
}

function _setCache(key: string, value: any, ttlMs?: number): void {
  const cache = _loadCache();
  cache[key] = { value, expiresAt: Date.now() + (ttlMs ?? CACHE_TTL_MS) };
  _persistCache(cache);
}

function _getCache(key: string): any | null {
  const cache = _loadCache();
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    delete cache[key];
    _persistCache(cache);
    return null;
  }
  return entry.value;
}

// ── HTTP Client (Authenticated) ───────────────────────────────────────────────
function _getAuthClient(): AxiosInstance | null {
  const apiKey = process.env.MENGANTAR_API_KEY || "";
  if (!apiKey) return null;
  return axios.create({
    baseURL: `${BASE_URL}/api/public/${apiKey}`,
    timeout: 20000,
    headers: { "Content-Type": "application/json" },
  });
}

function _getDefaultAddressId(): string {
  return process.env.MENGANTAR_ADDRESS_ID || "68ec580f5a3c0be9373681f2";
}

function _getDefaultCourier(): string {
  return process.env.MENGANTAR_COURIER || "JT";
}

// ── Search Address ─────────────────────────────────────────────────────────────
export async function searchAddress(
  keyword: string,
): Promise<MengantarAddressSearchResult | null> {
  const cacheKey = `addr_search_${keyword.toLowerCase().trim()}`;
  const cached = _getCache(cacheKey);
  if (cached) return cached;

  try {
    // API key tidak divalidasi di endpoint search (legacy)
    const url = `${BASE_URL}/api/public/legacy/address/search?keyword=${encodeURIComponent(keyword)}`;
    const res = await axios.get(url, { timeout: 10000 });
    const results: any[] = res.data?.data || [];
    if (results.length === 0) return null;

    const first = results[0];
    const result: MengantarAddressSearchResult = {
      id: first._id,
      label: `${first.SUBDISTRICT_NAME}, ${first.CITY_NAME}`,
      province: first.PROVINCE_NAME,
      city: first.CITY_NAME,
      district: first.DISTRICT_NAME,
      subdistrict: first.SUBDISTRICT_NAME,
      zip: first.ZIP_CODE,
      destination_code: first.DESTINATION_CODE,
    };
    _setCache(cacheKey, result);
    return result;
  } catch (err: any) {
    console.error(`[Mengantar] searchAddress error [${keyword}]:`, err.message);
    return null;
  }
}

// ── Get Addresses ─────────────────────────────────────────────────────────────
export async function getAddresses(): Promise<MengantarAddress[]> {
  const client = _getAuthClient();
  if (!client) return [];

  const cached = _getCache("mengantar_addresses");
  if (cached) return cached;

  try {
    const res = await client.get("/address");
    const addresses: MengantarAddress[] = res.data?.data || [];
    _setCache("mengantar_addresses", addresses);
    return addresses;
  } catch (err: any) {
    console.error("[Mengantar] getAddresses error:", err.message);
    return [];
  }
}

// ── Get Available Times ────────────────────────────────────────────────────────
export async function getAvailableTimes(addressId?: string): Promise<any[]> {
  const client = _getAuthClient();
  if (!client) return [];

  const addrId = addressId || _getDefaultAddressId();
  const cacheKey = `mengantar_times_${addrId}_${new Date().toDateString()}`;
  const cached = _getCache(cacheKey);
  if (cached) return cached;

  try {
    const res = await client.get("/time", { params: { address: addrId } });
    const times: any[] = res.data?.data || [];
    _setCache(cacheKey, times, 60 * 60 * 1000); // 1 jam
    return times;
  } catch (err: any) {
    console.error("[Mengantar] getAvailableTimes error:", err.message);
    return [];
  }
}

// ── Check Shipping Fee Public ─────────────────────────────────────────────────
export async function checkShippingFeePublic(
  originId: string,
  destinationId: string,
  weight: number = 1,
): Promise<Record<string, any> | null> {
  const cacheKey = `mengantar_public_fee_${originId}_${destinationId}_${weight}`;
  const cached = _getCache(cacheKey);
  if (cached) return cached;

  try {
    const res = await axios.get(`${BASE_URL}/api/order/allEstimatePublic`, {
      params: {
        origin_id: originId,
        destination_id: destinationId,
        weight,
        COD_AMOUNT: 1,
      },
      timeout: 10000,
    });
    const data = res.data?.data;
    if (data) _setCache(cacheKey, data);
    return data ?? null;
  } catch (err: any) {
    console.error("[Mengantar] checkShippingFeePublic error:", err.message);
    return null;
  }
}

// ── Get Shipping Cost (for Bot) ───────────────────────────────────────────────
function _getEtdByProvince(province: string): string {
  const p = province.toUpperCase();
  if (
    p.includes("JAWA") ||
    p.includes("DKI") ||
    p.includes("BANTEN") ||
    p.includes("YOGYAKARTA")
  )
    return "3-4 hari kerja";
  if (p.includes("BALI")) return "4-5 hari kerja";
  if (p.includes("SULAWESI") || p.includes("KALIMANTAN"))
    return "5-7 hari kerja";
  return "4-6 hari kerja";
}

function _isUnsupported(d: any): boolean {
  if (!d) return true;
  if (d.unsupported === true) return true;
  if ((d.price || d.estimatedPrice || d.estimatedSpecialPrice || 0) === 0)
    return true;
  return false;
}

export async function getShippingCost(
  destinationCity: string,
  weightGrams: number = 1000,
): Promise<string> {
  try {
    const cleanDest = destinationCity
      .toLowerCase()
      .replace(/kota\s+/g, "")
      .replace(/kabupaten\s+/g, "")
      .replace(/kecamatan\s+/g, "")
      .trim();

    const destData = await searchAddress(cleanDest);
    if (!destData) {
      return `Aduh bund, wilayah "${destinationCity}" tidak terdeteksi di sistem pengiriman kami 🙏 Bisa sebutkan nama Kecamatan atau Kota/Kabupaten yang lebih spesifik? 😊`;
    }

    // Dynamically get origin_id based on configured address
    let originId = KEDIRI_KOTA_ORIGIN_ID;
    const defaultAddressId = process.env.MENGANTAR_ADDRESS_ID;
    if (defaultAddressId) {
      try {
        const addrs = await getAddresses();
        const matched = addrs.find((a: any) => a._id === defaultAddressId);
        if (matched && matched.PICKUP_AUTOFILL) {
          originId = matched.PICKUP_AUTOFILL;
        }
      } catch (e) {
        console.error("[Mengantar] Gagal mengambil origin_id dinamis:", e);
      }
    }

    const weight = Math.max(1, Math.ceil(weightGrams / 1000));
    const pricingData = await checkShippingFeePublic(
      originId,
      destData.id,
      weight,
    );

    if (!pricingData || Object.keys(pricingData).length === 0) {
      return `Wah, maaf bund. Saat ini belum ada layanan pengiriman ke ${destData.label} dari Kediri 🙏`;
    }

    const MARKUP = 3000;
    for (const courierKey of ["JT", "JNE"]) {
      const data = pricingData[courierKey];
      if (_isUnsupported(data)) continue;

      // Gunakan harga normal (bukan diskon) agar penjual bisa mendapat margin dari diskon ekspedisi
      const basePrice =
        data.price || data.estimatedPrice || data.estimatedSpecialPrice || 0;
      const finalPrice = basePrice + MARKUP;
      let etd: string = data.estimatedDate || data.estimate_delivery || "";
      if (!etd || etd === "-") etd = _getEtdByProvince(destData.province);

      return `Hore! Ini hasil cek ongkir ke ${destData.label} (${weight}kg):\n\n✅ Pengiriman Reguler\n   Harga: Rp ${finalPrice.toLocaleString("id-ID")}\n   Estimasi: ${etd}\n\nBisa dibantu konfirmasi untuk lanjut pesanannya bund? 😊`;
    }

    const shopeeLink = process.env.SHOPEE_LINK || "";
    if (shopeeLink) {
      return `Aduh bund, maaf ya 🙏 Layanan pengiriman ke ${destData.label} belum tersedia saat ini.\n\nTapi bisa pesan via Shopee kami ya 😊\n👉 ${shopeeLink}`;
    }
    return `Aduh bund, maaf ya 🙏 Layanan pengiriman ke ${destData.label} belum tersedia saat ini.`;
  } catch (err: any) {
    console.error("[Mengantar] getShippingCost error:", err.message);
    return "Aduh maaf bund, server pengiriman sedang istirahat sejenak. Nanti kami bantu cekkan manual ya! 🙏";
  }
}

// ── Create Order (Resi) ───────────────────────────────────────────────────────
export async function createOrder(
  params: MengantarCreateOrderParams,
): Promise<MengantarCreateOrderResult> {
  const client = _getAuthClient();
  if (!client) {
    return {
      success: false,
      error: "MENGANTAR_API_KEY belum dikonfigurasi di .env",
    };
  }

  const {
    customerName,
    customerPhone,
    customerAddress,
    destinationKeyword,
    destinationId,
    weight = 1,
    quantity = 1,
    parcelContent,
    goodsValue,
    codAmount,
    courier,
    addressId,
    customProducts,
    pickupType = "dropOff",
    deliveryInstruction,
  } = params;

  if (!customerName)
    return { success: false, error: "customerName wajib diisi" };
  if (!customerAddress)
    return { success: false, error: "customerAddress wajib diisi" };
  if (!parcelContent)
    return { success: false, error: "parcelContent wajib diisi" };
  if (!destinationKeyword && !destinationId)
    return {
      success: false,
      error: "destinationKeyword atau destinationId wajib diisi",
    };

  try {
    // Resolve destination ID
    let destId = destinationId;
    let destLabel = "";
    if (!destId && destinationKeyword) {
      const destData = await searchAddress(destinationKeyword);
      if (!destData) {
        return {
          success: false,
          error: `Wilayah "${destinationKeyword}" tidak ditemukan`,
        };
      }
      destId = destData.id;
      destLabel = destData.label;
    }

    const courierName = courier || _getDefaultCourier();
    const pickupAddressId = addressId || _getDefaultAddressId();

    // Pickup config
    let pickup: any;
    if (pickupType === "scheduledPickup") {
      const times = await getAvailableTimes(pickupAddressId);
      const futureTime = times.find((t: any) => new Date(t.date) > new Date());
      if (futureTime) {
        pickup = {
          type: "scheduledPickup",
          volume: "volumeMotor",
          address_id: pickupAddressId,
          time_id: futureTime._id,
        };
      } else {
        pickup = { type: "dropOff", address_id: pickupAddressId };
      }
    } else {
      pickup = { type: "dropOff", address_id: pickupAddressId };
    }

    // Order item
    const orderItem: any = {
      customerAddressDataId: destId,
      customerAddress,
      customerName,
      customerPhone: String(customerPhone || "").replace(/^(0|62|\+62)/, ""),
      parcelContent,
      weight: Math.max(1, Number(weight) || 1),
      quantity: Math.max(1, Number(quantity) || 1),
    };

    if (codAmount && Number(codAmount) > 0) {
      orderItem.COD = Math.round(Number(codAmount));
    } else if (goodsValue && Number(goodsValue) > 0) {
      orderItem.goodsValue = Math.round(Number(goodsValue));
    }
    if (deliveryInstruction)
      orderItem.deliveryInstruction = deliveryInstruction;
    if (customProducts && customProducts.length > 0) {
      orderItem.customProducts = customProducts.map((p) => ({
        name: p.name || parcelContent,
        variant: p.variant || "",
        qty: Math.max(1, Number(p.qty ?? 1)),
        price: Math.round(Number(p.price ?? 0)),
        weight: Number(p.weight ?? 1),
      }));
    }

    const payload = { courier: courierName, pickup, orders: [orderItem] };
    console.log(
      `[Mengantar] Membuat order: ${customerName} → ${destLabel || destId} via ${courierName}`,
    );

    let res;
    let data;
    try {
      res = await client.post("/order", payload);
      data = res.data;
    } catch (err: any) {
      data = err.response?.data || { success: false, message: err.message };
    }

    if (!data.success) {
      const errMsg = (data.message || data.error || "").toLowerCase();
      // Jika J&T gagal karena tidak menjangkau, otomatis coba JNE
      if (
        courierName.toUpperCase() === "JT" &&
        (errMsg.includes("jangkau") ||
          errMsg.includes("coverage") ||
          errMsg.includes("area") ||
          errMsg.includes("support") ||
          errMsg.includes("layanan") ||
          errMsg.includes("tersedia"))
      ) {
        console.log(
          `[Mengantar] J&T tidak menjangkau ${destLabel || destId}, otomatis mencoba JNE...`,
        );
        payload.courier = "JNE";
        try {
          res = await client.post("/order", payload);
          data = res.data;
        } catch (retryErr: any) {
          data = retryErr.response?.data || {
            success: false,
            message: retryErr.message,
          };
        }
      }
    }

    if (!data.success) {
      return {
        success: false,
        error: data.message || data.error || "Gagal membuat order di Mengantar",
      };
    }

    const orders: any[] = data.data || [];
    const firstOrder = orders[0];
    const cnoteNo: string = firstOrder?.cnote_no || "";
    const orderId: string = firstOrder?.ORDER_ID || firstOrder?._id || "";
    const batch: string = data.batch || "";
    const batchId: string = data.batch_id || "";
    const isPaid: boolean = firstOrder?.isPaid !== false;
    const isUnpaid: boolean = firstOrder?.isPaid === false;

    console.log(
      `[Mengantar] ✅ Order: cnote=${cnoteNo} order_id=${orderId} batch=${batch} paid=${isPaid}`,
    );

    return {
      success: true,
      cnote_no: cnoteNo,
      order_id: orderId,
      batch,
      batch_id: batchId,
      courier: courierName,
      customer: customerName,
      destination: destLabel,
      is_paid: isPaid,
      is_unpaid: isUnpaid,
      raw: data,
    };
  } catch (err: any) {
    const errMsg =
      err.response?.data?.message || err.response?.data?.error || err.message;
    console.error(`[Mengantar] createOrder error: ${errMsg}`);
    return { success: false, error: errMsg };
  }
}

// ── Get Orders ────────────────────────────────────────────────────────────────
export async function getOrders(
  filters: {
    page?: number;
    size?: number;
    courier?: string;
    tracking_id?: string;
    order_id?: string;
    category?: string;
    origin_id?: string;
    dateRange?: { startDate: string; endDate: string };
  } = {},
): Promise<{ success: boolean; data: any[]; error?: string }> {
  const client = _getAuthClient();
  if (!client)
    return { success: false, data: [], error: "API key not configured" };

  try {
    const params: any = { page: filters.page || 1, size: filters.size || 20 };
    if (filters.courier) params.courier = filters.courier;
    if (filters.tracking_id) params.tracking_id = filters.tracking_id;
    if (filters.order_id) params.order_id = filters.order_id;
    if (filters.category) params.category = filters.category;
    if (filters.origin_id) params.origin_id = filters.origin_id;
    if (filters.dateRange) params.dateRange = JSON.stringify(filters.dateRange);

    const res = await client.get("/order", { params });
    return { success: true, data: res.data?.data || [] };
  } catch (err: any) {
    return { success: false, data: [], error: err.message };
  }
}

// ── Format Resi Message ───────────────────────────────────────────────────────
export function formatResiMessage(
  orderResult: MengantarCreateOrderResult,
): string {
  if (!orderResult.success) {
    return `Maaf bund, ada kendala saat membuat resi: ${orderResult.error} 🙏`;
  }

  const lines: string[] = [
    `Alhamdulillah, pesanan bunda sudah kami proses dan resi sudah dibuat! 📦`,
    ``,
    `📋 *Informasi Pengiriman:*`,
    orderResult.cnote_no ? `🔖 Nomor Resi: *${orderResult.cnote_no}*` : "",
    orderResult.customer ? `👤 Penerima: ${orderResult.customer}` : "",
    orderResult.destination ? `📍 Tujuan: ${orderResult.destination}` : "",
    `🚚 Kurir: ${orderResult.courier || "J&T Express"}`,
    ``,
  ];

  if (orderResult.is_unpaid) {
    lines.push(
      `⚠️ Catatan: Resi masih perlu diaktivasi (saldo pengiriman sedang diproses).`,
    );
    lines.push(``);
  }

  if (orderResult.cnote_no) {
    lines.push(
      `Bisa lacak paket di aplikasi ${orderResult.courier || "J&T"} ya bund, atau cek di Mengantar Pelacakan 😊`,
    );
  }

  lines.push(
    ``,
    `Terima kasih sudah berbelanja bund 🥰 Semoga produknya sesuai harapan ya!`,
  );

  return lines.filter(Boolean).join("\n").trim();
}

// ── Check if API configured ───────────────────────────────────────────────────
export function isMengantarConfigured(): boolean {
  return !!process.env.MENGANTAR_API_KEY;
}
