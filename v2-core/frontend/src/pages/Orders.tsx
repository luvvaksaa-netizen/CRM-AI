import { useEffect, useState, useCallback, useRef } from 'react';
import { Package, RefreshCw, MapPin, Truck, Search, Plus, X, ChevronLeft, ChevronRight, Filter, ExternalLink, FileText, CheckCircle2, AlertTriangle } from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';

// ── Status mapping lengkap ─────────────────────────────────────
const STATUS_MAP: Record<string, { label: string; class: string; icon: string }> = {
  '100': { label: 'Pickup',     class: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',    icon: '📦' },
  '200': { label: 'In Transit', class: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',  icon: '🚚' },
  '300': { label: 'Delivered',  class: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20', icon: '✅' },
  '400': { label: 'Return',     class: 'bg-red-500/10 text-red-400 border border-red-500/20',       icon: '↩️' },
};

const COURIERS = ['', 'JT', 'JNE', 'SAP', 'ANTERAJA', 'SICEPAT', 'LION'];

// ── Create Resi Modal ─────────────────────────────────────────
const CreateResiModal = ({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) => {
  const [form, setForm] = useState({
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    destinationKeyword: '',
    parcelContent: 'Label Nama / Stiker DTF',
    weight: '1',
    quantity: '1',
    codAmount: '',
    courier: 'JT',
    pickupType: 'dropOff',
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customerName || !form.customerAddress || !form.destinationKeyword) {
      toast.error('Nama, alamat, dan kota tujuan wajib diisi');
      return;
    }
    setLoading(true);
    try {
      const payload: any = {
        customerName: form.customerName,
        customerPhone: form.customerPhone,
        customerAddress: form.customerAddress,
        destinationKeyword: form.destinationKeyword,
        parcelContent: form.parcelContent,
        weight: Number(form.weight) || 1,
        quantity: Number(form.quantity) || 1,
        courier: form.courier,
        pickupType: form.pickupType,
      };
      if (form.codAmount && Number(form.codAmount) > 0) {
        payload.codAmount = Number(form.codAmount);
      }
      const res = await api.post('/mengantar/create-order', payload);
      if (res.data?.success) {
        setResult(res.data);
        toast.success(`Resi berhasil dibuat: ${res.data.cnote_no || '-'}`);
      } else {
        toast.error(res.data?.error || 'Gagal membuat resi');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal membuat resi');
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full">
          <div className="text-center mb-4">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
            <h3 className="text-xl font-bold text-white">Resi Berhasil Dibuat!</h3>
          </div>
          <div className="bg-slate-800/60 rounded-xl p-4 space-y-2 mb-4">
            <div className="flex justify-between">
              <span className="text-slate-400 text-sm">No. Resi</span>
              <span className="text-blue-400 font-mono font-bold">{result.cnote_no || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 text-sm">Kurir</span>
              <span className="text-white text-sm">{result.courier || form.courier}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 text-sm">Penerima</span>
              <span className="text-white text-sm">{result.customer || form.customerName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 text-sm">Tujuan</span>
              <span className="text-white text-sm">{result.destination || form.destinationKeyword}</span>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => { setResult(null); }} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white rounded-xl py-2.5 text-sm font-medium transition-colors">
              Buat Lagi
            </button>
            <button onClick={() => { onSuccess(); onClose(); }} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white rounded-xl py-2.5 text-sm font-medium transition-colors">
              Selesai
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-lg w-full my-4">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-400" />
            Buat Resi Mengantar
          </h3>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-400 mb-1 block">Nama Penerima *</label>
              <input
                type="text"
                value={form.customerName}
                onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                placeholder="Nama lengkap penerima"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 mb-1 block">No. HP Penerima</label>
              <input
                type="text"
                value={form.customerPhone}
                onChange={e => setForm(f => ({ ...f, customerPhone: e.target.value }))}
                placeholder="08xxxx"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 mb-1 block">Kota/Kecamatan Tujuan *</label>
              <input
                type="text"
                value={form.destinationKeyword}
                onChange={e => setForm(f => ({ ...f, destinationKeyword: e.target.value }))}
                placeholder="Contoh: Bekasi Barat"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                required
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-400 mb-1 block">Alamat Lengkap *</label>
              <textarea
                value={form.customerAddress}
                onChange={e => setForm(f => ({ ...f, customerAddress: e.target.value }))}
                placeholder="Jl. ..., RT/RW, Kelurahan, Kecamatan, Kota/Kab"
                rows={2}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
                required
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-400 mb-1 block">Isi Paket</label>
              <input
                type="text"
                value={form.parcelContent}
                onChange={e => setForm(f => ({ ...f, parcelContent: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 mb-1 block">Berat (kg)</label>
              <input
                type="number"
                min="1"
                value={form.weight}
                onChange={e => setForm(f => ({ ...f, weight: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 mb-1 block">Jumlah Paket</label>
              <input
                type="number"
                min="1"
                value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 mb-1 block">COD Amount (opsional)</label>
              <input
                type="number"
                value={form.codAmount}
                onChange={e => setForm(f => ({ ...f, codAmount: e.target.value }))}
                placeholder="Rp 0 = Non-COD"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 mb-1 block">Kurir</label>
              <select
                value={form.courier}
                onChange={e => setForm(f => ({ ...f, courier: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="JT">J&T Express</option>
                <option value="JNE">JNE</option>
                <option value="SAP">SAP</option>
                <option value="ANTERAJA">Anteraja</option>
                <option value="SICEPAT">Sicepat</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-400 mb-1 block">Tipe Pickup</label>
              <div className="flex gap-2">
                {['dropOff', 'scheduledPickup'].map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, pickupType: t }))}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${form.pickupType === t ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                  >
                    {t === 'dropOff' ? '🏪 Drop Off' : '🏍️ Scheduled Pickup'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
            <p className="text-xs text-amber-300 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              COD Amount diisi jika pembayaran COD. Kosongkan jika sudah transfer.
            </p>
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl py-2.5 text-sm font-medium transition-colors">
              Batal
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              {loading ? 'Membuat Resi...' : 'Buat Resi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Orders Page ────────────────────────────────────────────────
const Orders = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalOrders, setTotalOrders] = useState<any>(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [courierFilter, setCourierFilter] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchOrders = useCallback(async (p = 1, q = search, courier = courierFilter) => {
    setLoading(true);
    try {
      const params: any = { page: p, size: 25 };
      if (q) params.tracking_id = q;
      if (courier) params.courier = courier;
      
      const res = await api.get('/mengantar/orders', { params });
      if (res.data?.success) {
        const data = res.data.data || [];
        setOrders(data);
        // Mengantar API tidak return total, estimasi dari data
        const hasMore = data.length === 25;
        setTotalOrders(hasMore ? `${p * 25}+ resi` : (p - 1) * 25 + data.length);
        setPage(p);
      }
    } catch (e) {
      console.error(e);
      toast.error('Gagal memuat data resi');
    } finally {
      setLoading(false);
    }
  }, [search, courierFilter]);

  useEffect(() => {
    fetchOrders(1, search, courierFilter);
  }, [courierFilter]);

  useEffect(() => {
    fetchOrders(1, '', '');
  }, []);

  const handleSearchInput = (val: string) => {
    setSearchInput(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setSearch(val);
      fetchOrders(1, val, courierFilter);
    }, 600);
  };

  const getStatus = (o: any) => {
    if (o.pod_code && STATUS_MAP[o.pod_code]) return STATUS_MAP[o.pod_code];
    if (o.isPaid === false) return { label: 'Unpaid', class: 'bg-amber-500/10 text-amber-400 border border-amber-500/20', icon: '⏳' };
    return { label: 'Paid', class: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20', icon: '✅' };
  };

  const formatDate = (val: any) => {
    if (!val) return '-';
    try {
      return new Date(val).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return '-'; }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white dark:text-slate-900 flex items-center gap-3">
            <Package className="w-8 h-8 text-blue-500" />
            Riwayat Resi
          </h1>
          <p className="text-slate-400 dark:text-slate-500 mt-1">
            Data pengiriman dari Mengantar
            {totalOrders > 0 && <span className="ml-2 text-blue-400 font-medium">· {totalOrders} resi</span>}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors shadow-lg shadow-blue-500/25"
          >
            <Plus className="w-4 h-4" />
            Buat Resi
          </button>
          <button
            onClick={() => fetchOrders(1)}
            className="flex items-center gap-2 bg-slate-800/50 hover:bg-slate-700/50 text-white px-4 py-2 rounded-xl text-sm transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchInput}
            onChange={e => handleSearchInput(e.target.value)}
            placeholder="Cari no. resi, nama..."
            className="w-full bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-xl pl-9 pr-8 py-2 text-sm text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500"
          />
          {searchInput && (
            <button onClick={() => { setSearchInput(''); setSearch(''); fetchOrders(1, '', courierFilter); }} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="w-4 h-4 text-slate-400 hover:text-white" />
            </button>
          )}
        </div>

        {/* Courier filter */}
        <div className="flex items-center gap-1.5 bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-xl px-3 py-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={courierFilter}
            onChange={e => setCourierFilter(e.target.value)}
            className="bg-transparent text-sm text-slate-200 dark:text-slate-700 focus:outline-none"
          >
            <option value="">Semua Kurir</option>
            {COURIERS.filter(Boolean).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Link ke Mengantar */}
        <a
          href="https://app.mengantar.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-blue-400 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Buka Mengantar
        </a>
      </div>

      {/* Table */}
      <div className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-2xl p-4 backdrop-blur-xl">
        {loading && orders.length === 0 ? (
          <div className="flex justify-center py-16">
            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-16 text-slate-500">
            <Package className="w-14 h-14 mx-auto mb-4 opacity-20" />
            <p className="text-lg font-medium">Belum ada data resi</p>
            <p className="text-sm mt-1 text-slate-600">
              {search ? 'Coba kata kunci lain' : 'Buat resi pertama dengan tombol "Buat Resi"'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300 dark:text-slate-600">
              <thead className="bg-slate-800/50 dark:bg-slate-100 text-slate-400 dark:text-slate-500 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 rounded-tl-lg">Resi / Cnote</th>
                  <th className="px-4 py-3">Penerima</th>
                  <th className="px-4 py-3">Kota Tujuan</th>
                  <th className="px-4 py-3">Kurir</th>
                  <th className="px-4 py-3">Tgl Update</th>
                  <th className="px-4 py-3 rounded-tr-lg">Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o: any, i: number) => {
                  const status = getStatus(o);
                  return (
                    <tr
                      key={i}
                      className="border-b border-slate-800/30 dark:border-slate-100 hover:bg-slate-800/20 transition-colors cursor-pointer"
                      title={o.cnote_no}
                    >
                      <td className="px-4 py-3 font-mono font-medium text-blue-400 text-xs">
                        {o.cnote_no || '-'}
                      </td>
                      <td className="px-4 py-3 font-medium text-white dark:text-slate-900 max-w-[160px]">
                        <p className="truncate">{o.RECEIVER_NAME || o.receiver_name || '-'}</p>
                        {o.RECEIVER_PHONE && (
                          <p className="text-xs text-slate-500 truncate">{o.RECEIVER_PHONE}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-400 max-w-[140px]">
                        <div className="flex items-start gap-1">
                          <MapPin className="w-3 h-3 shrink-0 mt-0.5" />
                          <span className="truncate">{o.RECEIVER_CITY || o.receiver_city || '-'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="bg-blue-500/10 text-blue-400 px-2 py-1 rounded text-xs flex items-center gap-1 w-fit whitespace-nowrap">
                          <Truck className="w-3 h-3" />
                          {o.courier || o.COURIER_NAME || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                        {formatDate(o.lastStatusChange || o.updatedAt || o.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap ${status.class}`}>
                          {status.icon} {status.label}
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

      {/* Pagination */}
      {orders.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Halaman {page} · {orders.length} resi ditampilkan
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchOrders(page - 1)}
              disabled={page <= 1 || loading}
              className="flex items-center gap-1 px-3 py-2 bg-slate-800/50 hover:bg-slate-700/50 disabled:opacity-30 text-white rounded-xl text-sm transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Sebelumnya
            </button>
            <span className="text-sm text-slate-400 px-3">
              Hal {page}
            </span>
            <button
              onClick={() => fetchOrders(page + 1)}
              disabled={orders.length < 25 || loading}
              className="flex items-center gap-1 px-3 py-2 bg-slate-800/50 hover:bg-slate-700/50 disabled:opacity-30 text-white rounded-xl text-sm transition-colors"
            >
              Berikutnya
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Create Resi Modal */}
      {showCreateModal && (
        <CreateResiModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => fetchOrders(1)}
        />
      )}
    </div>
  );
};

export default Orders;
