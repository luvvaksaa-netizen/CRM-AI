/**
 * @file Orders.tsx
 * @description Halaman Riwayat Resi — Terintegrasi dengan Mengantar API.
 *
 * Fitur:
 *  - Tabel resi dari Mengantar dengan mapping ke CRM DB
 *  - Filter: kurir, toko, tanggal (date range)
 *  - Search nama penerima (client-side, dari data Mengantar + CRM)
 *  - Klik baris → Detail Modal (data real dari Mengantar)
 *  - Tombol Kirim Resi ke WA customer
 *  - Tombol "Buat Resi" dinonaktifkan sementara (menunggu keputusan admin)
 *  - Refresh manual agar tidak bikin app lemot
 *  - Sorting: Status aktif dulu → tanggal terbaru → nama toko
 */

import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  Package,
  RefreshCw,
  MapPin,
  Truck,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Filter,
  ExternalLink,
  MessageCircle,
  Calendar,
  AlertCircle,
  CheckCircle,
  Clock,
  RotateCcw,
  Info,
} from "lucide-react";
import api from "../services/api";
import toast from "react-hot-toast";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface CrmContact {
  contact_name: string;
  contact_phone: string;
  contact_id: string;
  store_wa_id: string;
  store_name: string;
}

interface AddressValidation {
  valid: boolean;
  errors?: string[];
}

interface Order {
  cnote_no?: string;
  RECEIVER_NAME?: string;
  receiver_name?: string;
  RECEIVER_PHONE?: string;
  receiver_phone?: string;
  RECEIVER_CITY?: string;
  receiver_city?: string;
  RECEIVER_ADDRESS?: string;
  receiver_address?: string;
  courier?: string;
  COURIER_NAME?: string;
  pod_code?: string;
  status?: string;
  isPaid?: boolean;
  lastStatusChange?: string;
  updatedAt?: string;
  createdAt?: string;
  customer_phone?: string;
  phone?: string;
  weight?: number;
  quantity?: number;
  parcel_content?: string;
  goods_value?: number;
  crm_mapped_contact?: CrmContact;
  _addressValidation?: AddressValidation;
  [key: string]: any;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; className: string; icon: React.ReactElement }> = {
  "100": {
    label: "Pickup",
    className: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
    icon: <Package className="w-3 h-3" />,
  },
  "200": {
    label: "In Transit",
    className: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
    icon: <Truck className="w-3 h-3" />,
  },
  "300": {
    label: "Delivered",
    className: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
    icon: <CheckCircle className="w-3 h-3" />,
  },
  "400": {
    label: "Return",
    className: "bg-red-500/10 text-red-400 border border-red-500/20",
    icon: <RotateCcw className="w-3 h-3" />,
  },
};

const COURIERS = ["JT", "JNE", "SAP", "ANTERAJA", "SICEPAT", "LION"];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Dapatkan info status dari data order Mengantar */
function getOrderStatus(order: Order): { label: string; className: string; icon: React.ReactElement } {
  if (order.pod_code && STATUS_MAP[order.pod_code]) {
    return STATUS_MAP[order.pod_code];
  }
  if (order.isPaid === false) {
    return {
      label: "Belum Bayar",
      className: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
      icon: <Clock className="w-3 h-3" />,
    };
  }
  return {
    label: "Lunas",
    className: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
    icon: <CheckCircle className="w-3 h-3" />,
  };
}

/** Format tanggal ke format Indonesia yang mudah dibaca */
function formatDate(value?: string | null): string {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
}

/**
 * Parsing nama penerima dari format Mengantar.
 * Mengantar kadang menyimpan dengan prefix ID, misal: "1234-Bunda Sari".
 * Fungsi ini mengekstrak hanya nama bagian belakang.
 */
function parseReceiverName(raw?: string): string {
  if (!raw) return "-";
  // Format: "1234-Nama Customer" → "Nama Customer"
  const match = raw.match(/^\d+-(.+)$/);
  return match ? match[1].trim() : raw.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// ORDER DETAIL MODAL
// ─────────────────────────────────────────────────────────────────────────────

interface OrderDetailModalProps {
  order: Order;
  onClose: () => void;
}

const OrderDetailModal = ({ order, onClose }: OrderDetailModalProps) => {
  const [sending, setSending] = useState(false);

  const status = getOrderStatus(order);
  const receiverName = parseReceiverName(order.RECEIVER_NAME || order.receiver_name);
  const receiverPhone = order.RECEIVER_PHONE || order.receiver_phone || order.customer_phone || order.phone || "";
  const receiverCity = order.RECEIVER_CITY || order.receiver_city || "-";
  const receiverAddress = order.RECEIVER_ADDRESS || order.receiver_address || "-";
  const courierName = order.courier || order.COURIER_NAME || "-";
  const crmContact = order.crm_mapped_contact;

  /** Kirim notifikasi resi ke WA customer */
  const handleSendResiWA = async () => {
    if (!order.cnote_no) {
      toast.error("Nomor resi tidak tersedia");
      return;
    }

    setSending(true);
    try {
      const payload: Record<string, string> = {
        cnote_no: order.cnote_no,
        customer_name: receiverName,
        destination: receiverCity,
        courier: courierName,
      };

      // Prioritaskan pakai store_wa_id + contact_id jika tersedia dari CRM mapping
      if (crmContact?.store_wa_id && crmContact?.contact_id) {
        payload.store_wa_id = crmContact.store_wa_id;
        payload.contact_id = crmContact.contact_id;
      } else if (receiverPhone) {
        payload.customer_phone = receiverPhone;
      } else {
        toast.error("Nomor HP customer tidak ditemukan. Tidak bisa kirim ke WA.");
        setSending(false);
        return;
      }

      const res = await api.post("/mengantar/send-resi-wa", payload);
      if (res.data?.success) {
        toast.success("Resi berhasil dikirim ke WhatsApp customer! 📦");
      } else {
        toast.error(res.data?.error || "Gagal kirim resi ke WA");
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Gagal kirim resi ke WA");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-400" />
            Detail Resi
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-slate-800"
            aria-label="Tutup"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Konten */}
        <div className="p-5 space-y-4">
          {/* Nomor Resi */}
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4">
            <p className="text-xs text-slate-400 mb-1">Nomor Resi / AWB</p>
            <p className="text-xl font-mono font-bold text-blue-400 tracking-wide">
              {order.cnote_no || "-"}
            </p>
          </div>

          {/* Status */}
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${status.className}`}>
              {status.icon}
              {status.label}
            </span>
            {order._addressValidation && (
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium ${
                  order._addressValidation.valid
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-red-500/10 text-red-400 border border-red-500/20"
                }`}
                title={order._addressValidation.errors?.join(", ")}
              >
                {order._addressValidation.valid ? (
                  <CheckCircle className="w-3 h-3" />
                ) : (
                  <AlertCircle className="w-3 h-3" />
                )}
                Alamat {order._addressValidation.valid ? "Valid" : "Invalid"}
              </span>
            )}
          </div>

          {/* Info Pengiriman */}
          <div className="grid grid-cols-2 gap-3">
            <InfoRow label="Kurir" value={courierName} />
            <InfoRow
              label="Tgl Update"
              value={formatDate(order.lastStatusChange || order.updatedAt || order.createdAt)}
            />
          </div>

          {/* Info Penerima */}
          <div className="bg-slate-800/40 rounded-xl p-4 space-y-2.5">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Informasi Penerima
            </h4>
            <InfoRow label="Nama" value={receiverName} />
            {receiverPhone && <InfoRow label="No. HP" value={receiverPhone} />}
            <InfoRow label="Kota" value={receiverCity} />
            {receiverAddress !== "-" && (
              <InfoRow label="Alamat" value={receiverAddress} multiline />
            )}
          </div>

          {/* Info Paket */}
          {(order.weight || order.quantity || order.parcel_content) && (
            <div className="bg-slate-800/40 rounded-xl p-4 space-y-2.5">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Informasi Paket
              </h4>
              {order.parcel_content && (
                <InfoRow label="Isi Paket" value={order.parcel_content} />
              )}
              {order.weight && (
                <InfoRow label="Berat" value={`${order.weight} kg`} />
              )}
              {order.quantity && (
                <InfoRow label="Jumlah" value={`${order.quantity} pcs`} />
              )}
              {order.goods_value && (
                <InfoRow
                  label="Nilai Barang"
                  value={`Rp ${Number(order.goods_value).toLocaleString("id-ID")}`}
                />
              )}
            </div>
          )}

          {/* CRM Mapping */}
          {crmContact && (
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 space-y-2.5">
              <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                Terdeteksi di CRM
              </h4>
              {crmContact.store_name && (
                <InfoRow label="Toko" value={`🏪 ${crmContact.store_name}`} />
              )}
              {crmContact.contact_name && (
                <InfoRow label="Nama di CRM" value={`👤 ${crmContact.contact_name}`} />
              )}
              {crmContact.store_wa_id && (
                <InfoRow
                  label="WA Toko"
                  value={`📱 ${String(crmContact.store_wa_id)
                    .replace("@c.us", "")
                    .replace("@lid", "")}`}
                />
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-5 border-t border-slate-800 flex gap-3">
          <button
            onClick={handleSendResiWA}
            disabled={sending || !order.cnote_no}
            className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl py-2.5 text-sm font-medium transition-colors"
          >
            {sending ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <MessageCircle className="w-4 h-4" />
            )}
            {sending ? "Mengirim..." : "Kirim Resi ke WA"}
          </button>
          <button
            onClick={onClose}
            className="px-5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl py-2.5 text-sm font-medium transition-colors"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};

/** Komponen baris info (label + nilai) yang reusable */
const InfoRow = ({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) => (
  <div className={`flex ${multiline ? "flex-col gap-0.5" : "items-center justify-between gap-2"}`}>
    <span className="text-xs text-slate-400 shrink-0">{label}</span>
    <span
      className={`text-sm text-slate-200 ${multiline ? "" : "text-right truncate max-w-[220px]"}`}
      title={value}
    >
      {value || "-"}
    </span>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// ORDERS PAGE
// ─────────────────────────────────────────────────────────────────────────────

const Orders = () => {
  // ── State ────────────────────────────────────────────────────────────────
  const [allOrders, setAllOrders] = useState<Order[]>([]); // data mentah dari API
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  // Filter state
  const [searchInput, setSearchInput] = useState("");    // nilai input sementara
  const [searchTerm, setSearchTerm] = useState("");      // nilai yang aktif dipakai filter
  const [courierFilter, setCourierFilter] = useState("");
  const [storeFilter, setStoreFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Stores untuk dropdown filter
  const [stores, setStores] = useState<any[]>([]);
  const [storesLoading, setStoresLoading] = useState(true);

  // Detail modal
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // Debounce ref untuk search input
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Computed: Filter + Search (client-side) ───────────────────────────────
  // Semua data sudah diambil (max 500 per halaman), filter dilakukan di frontend
  // agar tidak boros API call dan respons tetap cepat.
  const filteredOrders = allOrders.filter((order) => {
    // Search nama penerima (dari Mengantar) dan nama CRM
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const receiverRaw = (order.RECEIVER_NAME || order.receiver_name || "").toLowerCase();
      const receiverParsed = parseReceiverName(order.RECEIVER_NAME || order.receiver_name).toLowerCase();
      const crmName = (order.crm_mapped_contact?.contact_name || "").toLowerCase();
      const cnote = (order.cnote_no || "").toLowerCase();

      if (
        !receiverRaw.includes(q) &&
        !receiverParsed.includes(q) &&
        !crmName.includes(q) &&
        !cnote.includes(q)
      ) {
        return false;
      }
    }

    // Filter toko (berdasarkan store_wa_id dari CRM mapping)
    if (storeFilter) {
      const orderStoreWaId = String(order.crm_mapped_contact?.store_wa_id || "").replace(/\D/g, "");
      const selectedStoreWaId = String(storeFilter).replace(/\D/g, "");
      if (orderStoreWaId !== selectedStoreWaId) return false;
    }

    return true;
  });

  // Pagination client-side
  const PAGE_SIZE = 25;
  const totalPages = Math.ceil(filteredOrders.length / PAGE_SIZE);
  const paginatedOrders = filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ── Data Fetching ─────────────────────────────────────────────────────────
  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: "1", size: "500" };
      if (courierFilter) params.courier = courierFilter;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;

      const res = await api.get("/mengantar/orders", { params });
      if (res.data?.success) {
        setAllOrders(res.data.data || []);
        setPage(1); // reset ke halaman pertama setiap fetch baru
      } else {
        toast.error("Gagal memuat data resi");
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || "Gagal memuat data resi";
      toast.error(msg);
      console.error("[Orders] fetchOrders error:", err);
    } finally {
      setLoading(false);
    }
  }, [courierFilter, dateFrom, dateTo]);

  // Fetch stores untuk dropdown
  useEffect(() => {
    const fetchStores = async () => {
      try {
        const res = await api.get("/stores");
        const storeList = Array.isArray(res.data)
          ? res.data
          : res.data?.data || [];
        setStores(storeList);
      } catch (err) {
        console.error("[Orders] Failed to fetch stores:", err);
      } finally {
        setStoresLoading(false);
      }
    };
    fetchStores();
  }, []);

  // Fetch orders saat mount
  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // ── Search Debounce ───────────────────────────────────────────────────────
  const handleSearchInput = (value: string) => {
    setSearchInput(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setSearchTerm(value);
      setPage(1);
    }, 400);
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearchTerm("");
    setPage(1);
  };

  // ── Reset filter tanggal ──────────────────────────────────────────────────
  const clearDateFilter = () => {
    setDateFrom("");
    setDateTo("");
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white dark:text-slate-900 flex items-center gap-3">
            <Package className="w-8 h-8 text-blue-500" />
            Riwayat Resi
          </h1>
          <p className="text-slate-400 dark:text-slate-500 mt-1 text-sm">
            Data pengiriman dari Mengantar · diurutkan terbaru
            {filteredOrders.length > 0 && (
              <span className="ml-2 text-blue-400 font-medium">
                · {filteredOrders.length} resi
              </span>
            )}
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          {/* Buat Resi — dinonaktifkan sementara per permintaan admin */}
          <div className="relative group">
            <button
              disabled
              className="flex items-center gap-2 bg-slate-700/50 text-slate-500 px-4 py-2 rounded-xl text-sm font-medium cursor-not-allowed select-none border border-slate-700/50"
              aria-label="Buat Resi (dinonaktifkan sementara)"
            >
              <Package className="w-4 h-4" />
              Buat Resi
              <Info className="w-3.5 h-3.5" />
            </button>
            {/* Tooltip */}
            <div className="absolute right-0 top-full mt-2 w-64 bg-slate-800 border border-slate-700 rounded-xl p-3 text-xs text-slate-300 shadow-xl z-10 hidden group-hover:block">
              <p className="font-medium text-amber-400 mb-1">⏸ Sementara Dinonaktifkan</p>
              <p>Fitur buat resi sedang ditinjau ulang. Hubungi admin untuk informasi lebih lanjut.</p>
            </div>
          </div>

          {/* Refresh manual */}
          <button
            onClick={fetchOrders}
            disabled={loading}
            className="flex items-center gap-2 bg-slate-800/50 hover:bg-slate-700/50 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm transition-colors border border-slate-700/50"
            aria-label="Refresh data resi"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Memuat..." : "Refresh"}
          </button>

          {/* Link Mengantar */}
          <a
            href="https://app.mengantar.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-blue-400 transition-colors px-3 py-2 bg-slate-800/30 rounded-xl border border-slate-700/30"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Mengantar
          </a>
        </div>
      </div>

      {/* ── Filter Bar ── */}
      <div className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-2xl p-4 backdrop-blur-sm space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          {/* Search nama/resi */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              id="orders-search-input"
              type="text"
              value={searchInput}
              onChange={(e) => handleSearchInput(e.target.value)}
              placeholder="Cari nama penerima atau no. resi..."
              className="w-full bg-slate-800/60 dark:bg-slate-50 border border-slate-700/50 dark:border-slate-200 rounded-xl pl-9 pr-8 py-2 text-sm text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500 transition-colors"
            />
            {searchInput && (
              <button
                onClick={clearSearch}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                aria-label="Hapus pencarian"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Courier filter */}
          <div className="flex items-center gap-1.5 bg-slate-800/60 dark:bg-slate-50 border border-slate-700/50 dark:border-slate-200 rounded-xl px-3 py-2">
            <Truck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <select
              id="orders-courier-filter"
              value={courierFilter}
              onChange={(e) => { setCourierFilter(e.target.value); setPage(1); }}
              className="bg-transparent text-sm text-slate-200 dark:text-slate-700 focus:outline-none"
            >
              <option value="">Semua Kurir</option>
              {COURIERS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Store filter */}
          <div className="flex items-center gap-1.5 bg-slate-800/60 dark:bg-slate-50 border border-slate-700/50 dark:border-slate-200 rounded-xl px-3 py-2">
            {storesLoading ? (
              <RefreshCw className="w-3.5 h-3.5 text-slate-400 animate-spin" />
            ) : (
              <>
                <span className="text-slate-400 text-sm">🏪</span>
                <select
                  id="orders-store-filter"
                  value={storeFilter}
                  onChange={(e) => { setStoreFilter(e.target.value); setPage(1); }}
                  className="bg-transparent text-sm text-slate-200 dark:text-slate-700 focus:outline-none"
                >
                  <option value="">Semua Toko</option>
                  {stores.map((s: any) => (
                    <option key={s.id || s.wa_id} value={s.wa_id}>
                      {s.name || s.store_name || "Unnamed Store"}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        </div>

        {/* Date range filter */}
        <div className="flex flex-wrap items-center gap-3">
          <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <label className="text-xs text-slate-400">Dari:</label>
            <input
              id="orders-date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="bg-slate-800/60 dark:bg-slate-50 border border-slate-700/50 dark:border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500"
            />
            <label className="text-xs text-slate-400">s/d:</label>
            <input
              id="orders-date-to"
              type="date"
              value={dateTo}
              min={dateFrom}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="bg-slate-800/60 dark:bg-slate-50 border border-slate-700/50 dark:border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500"
            />
            {(dateFrom || dateTo) && (
              <button
                onClick={clearDateFilter}
                className="text-xs text-slate-400 hover:text-red-400 transition-colors flex items-center gap-1"
              >
                <X className="w-3 h-3" /> Hapus tanggal
              </button>
            )}
          </div>

          {/* Info filter aktif */}
          {(searchTerm || storeFilter || courierFilter || dateFrom || dateTo) && (
            <span className="text-xs text-blue-400 ml-auto">
              ● Filter aktif · {filteredOrders.length} hasil
            </span>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-2xl overflow-hidden backdrop-blur-xl">
        {loading && allOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
            <p className="text-slate-400 text-sm">Memuat data resi...</p>
          </div>
        ) : paginatedOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Package className="w-14 h-14 text-slate-600 opacity-40" />
            <p className="text-slate-400 font-medium">
              {searchTerm || storeFilter || courierFilter || dateFrom || dateTo
                ? "Tidak ada resi yang sesuai filter"
                : "Belum ada data resi"}
            </p>
            {(searchTerm || storeFilter || courierFilter || dateFrom || dateTo) && (
              <button
                onClick={() => {
                  clearSearch();
                  setStoreFilter("");
                  setCourierFilter("");
                  clearDateFilter();
                }}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                Hapus semua filter
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300 dark:text-slate-600">
              <thead className="bg-slate-800/60 dark:bg-slate-100 text-slate-400 dark:text-slate-500 uppercase text-xs sticky top-0">
                <tr>
                  <th className="px-4 py-3 font-semibold">Resi / CNO</th>
                  <th className="px-4 py-3 font-semibold">Nama Penerima</th>
                  <th className="px-4 py-3 font-semibold">Kota Tujuan</th>
                  <th className="px-4 py-3 font-semibold">Kurir</th>
                  <th className="px-4 py-3 font-semibold">Tgl Update</th>
                  <th className="px-4 py-3 font-semibold">CRM / Toko</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {paginatedOrders.map((order, idx) => {
                  const status = getOrderStatus(order);
                  const receiverName = parseReceiverName(
                    order.RECEIVER_NAME || order.receiver_name,
                  );
                  const receiverCity = order.RECEIVER_CITY || order.receiver_city || "-";

                  return (
                    <tr
                      key={order.cnote_no || idx}
                      onClick={() => setSelectedOrder(order)}
                      className="border-b border-slate-800/30 dark:border-slate-100 hover:bg-slate-800/30 dark:hover:bg-slate-50 transition-colors cursor-pointer group"
                    >
                      {/* Resi */}
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs font-semibold text-blue-400 group-hover:text-blue-300 transition-colors">
                          {order.cnote_no || "-"}
                        </span>
                      </td>

                      {/* Nama Penerima */}
                      <td className="px-4 py-3">
                        <p className="font-medium text-white dark:text-slate-900 truncate max-w-[160px]" title={receiverName}>
                          {receiverName}
                        </p>
                        {(order.RECEIVER_PHONE || order.receiver_phone) && (
                          <p className="text-xs text-slate-500 truncate">
                            {order.RECEIVER_PHONE || order.receiver_phone}
                          </p>
                        )}
                      </td>

                      {/* Kota */}
                      <td className="px-4 py-3 text-slate-400 max-w-[140px]">
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3 h-3 shrink-0" />
                          <span className="truncate" title={receiverCity}>{receiverCity}</span>
                        </div>
                      </td>

                      {/* Kurir */}
                      <td className="px-4 py-3">
                        <span className="bg-blue-500/10 text-blue-400 px-2 py-1 rounded text-xs flex items-center gap-1 w-fit whitespace-nowrap border border-blue-500/20">
                          <Truck className="w-3 h-3" />
                          {order.courier || order.COURIER_NAME || "-"}
                        </span>
                      </td>

                      {/* Tanggal */}
                      <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                        {formatDate(order.lastStatusChange || order.updatedAt || order.createdAt)}
                      </td>

                      {/* CRM Mapping */}
                      <td className="px-4 py-3 text-xs">
                        {order.crm_mapped_contact ? (
                          <div className="flex flex-col gap-0.5">
                            {order.crm_mapped_contact.store_name && (
                              <span
                                className="text-slate-300 dark:text-slate-600 font-medium truncate max-w-[140px]"
                                title={order.crm_mapped_contact.store_name}
                              >
                                🏪 {order.crm_mapped_contact.store_name}
                              </span>
                            )}
                            {order.crm_mapped_contact.contact_name && (
                              <span className="text-slate-400 truncate max-w-[140px]" title={order.crm_mapped_contact.contact_name}>
                                👤 {order.crm_mapped_contact.contact_name}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap ${status.className}`}
                        >
                          {status.icon}
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Pagination ── */}
      {filteredOrders.length > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Halaman {page} dari {totalPages} · {paginatedOrders.length} dari {filteredOrders.length} resi ditampilkan
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center gap-1 px-3 py-2 bg-slate-800/50 hover:bg-slate-700/50 disabled:opacity-30 text-white rounded-xl text-sm transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Sebelumnya
            </button>
            <span className="text-sm text-slate-400 px-2">Hal {page}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex items-center gap-1 px-3 py-2 bg-slate-800/50 hover:bg-slate-700/50 disabled:opacity-30 text-white rounded-xl text-sm transition-colors"
            >
              Berikutnya
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Detail Modal ── */}
      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
        />
      )}
    </div>
  );
};

export default Orders;
