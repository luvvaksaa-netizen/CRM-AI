import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Target, TrendingUp, Star, BarChart3, Lightbulb, X, Check, Zap, Download, Trash2, ExternalLink, Calendar, Store, CreditCard } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { format } from 'date-fns';

interface ClosingStats {
  totalClosings: number;
  qualifiedClosings: number;
  productBreakdown: Record<string, number>;
  codCount: number;
  transferCount: number;
  avgScore: number;
}

interface Pattern {
  id: number;
  teknik: string;
  contoh_kalimat: string;
  konteks: string;
  dampak: string;
  frequency: number;
  confidence: number;
  product_type: string;
  source_type: string;
  is_active: boolean;
  last_seen_at: string;
}

interface Analytic {
  id: number;
  store_wa_id: string;
  contact_id: string;
  product_type: string;
  conversation_score: number;
  pesan_sampai_closing: number;
  metode_bayar: string;
  alur_lengkap: boolean;
  data_lengkap: boolean;
  patterns_extracted: number;
  analyzed_at: string;
  ChatSummary?: {
    summary: string;
    contact_name: string;
    contact_phone: string;
    last_updated: string;
  };
  Store?: {
    name: string;
    wa_id: string;
  };
}

const PRODUCT_TYPES = ['semua', 'dtf', 'uv', 'generic'];
const PAYMENT_METHODS = ['semua', 'COD', 'Transfer'];

const Closing = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'overview' | 'patterns' | 'analytics'>('overview');
  const [stats, setStats] = useState<ClosingStats | null>(null);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [analytics, setAnalytics] = useState<Analytic[]>([]);
  const [loading, setLoading] = useState(true);
  const [productFilter, setProductFilter] = useState('semua');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [stores, setStores] = useState<any[]>([]);
  const [storeFilter, setStoreFilter] = useState('');
  const [metodeBayarFilter, setMetodeBayarFilter] = useState('semua');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedAnalytic, setSelectedAnalytic] = useState<Analytic | null>(null);
  const [showAnalyticDetail, setShowAnalyticDetail] = useState(false);

  // Expanded pattern
  const [expandedPattern, setExpandedPattern] = useState<number | null>(null);

  useEffect(() => {
    api.get('/stores').then(res => setStores(res.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === 'overview') fetchStats();
    else if (tab === 'patterns') fetchPatterns();
    else fetchAnalytics();
  }, [tab, productFilter, page, storeFilter, metodeBayarFilter, startDate, endDate]);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (productFilter !== 'semua') params.product_type = productFilter;
      if (storeFilter) params.store_wa_id = storeFilter;
      if (metodeBayarFilter !== 'semua') params.metode_bayar = metodeBayarFilter;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      const res = await api.get('/closing/stats', { params });
      setStats(res.data);
    } catch { toast.error('Gagal mengambil statistik closing'); }
    finally { setLoading(false); }
  };

  const fetchPatterns = async () => {
    setLoading(true);
    try {
      const params: any = { limit: 30 };
      if (productFilter !== 'semua') params.product_type = productFilter;
      const res = await api.get('/closing/patterns', { params });
      setPatterns(res.data.data);
    } catch { toast.error('Gagal mengambil pola closing'); }
    finally { setLoading(false); }
  };

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 20 };
      if (productFilter !== 'semua') params.product_type = productFilter;
      if (storeFilter) params.store_wa_id = storeFilter;
      if (metodeBayarFilter !== 'semua') params.metode_bayar = metodeBayarFilter;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      const res = await api.get('/closing/analytics', { params });
      setAnalytics(res.data.data);
      setTotalPages(res.data.totalPages);
    } catch { toast.error('Gagal mengambil data analitik'); }
    finally { setLoading(false); }
  };

  const togglePattern = async (id: number) => {
    try {
      await api.put(`/closing/patterns/${id}/toggle`);
      toast.success('Status pola diubah');
      fetchPatterns();
    } catch { toast.error('Gagal mengubah status pola'); }
  };

  const handleDeletePattern = async (id: number) => {
    if (!confirm('Hapus pola closing ini?')) return;
    try {
      await api.delete(`/closing/patterns/${id}`);
      toast.success('Pola dihapus');
      fetchPatterns();
    } catch { toast.error('Gagal menghapus pola (perlu role admin)'); }
  };

  const handleExportCsv = () => {
    const params = new URLSearchParams();
    if (productFilter !== 'semua') params.set('product_type', productFilter);
    if (storeFilter) params.set('store_wa_id', storeFilter);
    if (metodeBayarFilter !== 'semua') params.set('metode_bayar', metodeBayarFilter);
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3002/api';
    window.open(`${API_BASE}/closing/export/csv?${params.toString()}`, '_blank');
    toast.success('Download CSV dimulai');
  };

  const navigateToChat = (storeWaId: string, contactId: string) => {
    sessionStorage.setItem('chatTarget', JSON.stringify({ storeWaId, contactId }));
    navigate('/chat');
  };

  const getProductLabel = (type: string) => {
    const map: Record<string, string> = { dtf: 'DTF (Label Baju)', uv: 'UV (Stiker Keras)', generic: 'Generic' };
    return map[type] || type;
  };

  const getScoreColor = (score: number) => {
    if (score >= 8) return 'text-emerald-400';
    if (score >= 6) return 'text-yellow-400';
    return 'text-red-400';
  };

  const clearFilters = () => {
    setProductFilter('semua');
    setStoreFilter('');
    setMetodeBayarFilter('semua');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  const hasActiveFilters = productFilter !== 'semua' || storeFilter || metodeBayarFilter !== 'semua' || startDate || endDate;

  // ─── Filter Bar (shared across tabs) ──────────────────────────
  const FilterBar = () => (
    <div className="flex flex-wrap items-center gap-3">
      {/* Produk filter */}
      <span className="text-sm text-slate-400 dark:text-slate-500">Produk:</span>
      {PRODUCT_TYPES.map(pt => (
        <button
          key={pt}
          onClick={() => { setProductFilter(pt); setPage(1); }}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            productFilter === pt ? 'bg-purple-600 text-white dark:text-slate-900' : 'bg-slate-800 dark:bg-slate-100 text-slate-400 dark:text-slate-700 hover:text-slate-200'
          }`}
        >
          {pt === 'semua' ? 'Semua' : pt.toUpperCase()}
        </button>
      ))}

      <span className="text-slate-700 dark:text-slate-300 mx-1">|</span>

      {/* Metode bayar filter */}
      <span className="text-sm text-slate-400 dark:text-slate-500 flex items-center gap-1">
        <CreditCard className="w-3.5 h-3.5" /> Bayar:
      </span>
      {PAYMENT_METHODS.map(mb => (
        <button
          key={mb}
          onClick={() => { setMetodeBayarFilter(mb); setPage(1); }}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            metodeBayarFilter === mb ? 'bg-cyan-600 text-white dark:text-slate-900' : 'bg-slate-800 dark:bg-slate-100 text-slate-400 dark:text-slate-700 hover:text-slate-200'
          }`}
        >
          {mb === 'semua' ? 'Semua' : mb}
        </button>
      ))}

      <span className="text-slate-700 dark:text-slate-300 mx-1">|</span>

      {/* Store filter */}
      <span className="text-sm text-slate-400 dark:text-slate-500 flex items-center gap-1">
        <Store className="w-3.5 h-3.5" /> Toko:
      </span>
      <select
        value={storeFilter}
        onChange={e => { setStoreFilter(e.target.value); setPage(1); }}
        className="px-3 py-1.5 rounded-lg text-xs bg-slate-800 dark:bg-slate-100 text-slate-300 dark:text-slate-700 border border-slate-700 dark:border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option value="">Semua Toko</option>
        {stores.map((s: any) => (
          <option key={s.id || s.wa_id} value={s.wa_id}>{s.name || s.wa_id}</option>
        ))}
      </select>

      <span className="text-slate-700 dark:text-slate-300 mx-1">|</span>

      {/* Date range */}
      <span className="text-sm text-slate-400 dark:text-slate-500 flex items-center gap-1">
        <Calendar className="w-3.5 h-3.5" /> Tgl:
      </span>
      <input
        type="date"
        value={startDate}
        onChange={e => { setStartDate(e.target.value); setPage(1); }}
        className="px-2 py-1.5 rounded-lg text-xs bg-slate-800 dark:bg-slate-100 text-slate-300 dark:text-slate-700 border border-slate-700 dark:border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        title="Tanggal mulai"
      />
      <span className="text-slate-500 text-xs">s/d</span>
      <input
        type="date"
        value={endDate}
        onChange={e => { setEndDate(e.target.value); setPage(1); }}
        className="px-2 py-1.5 rounded-lg text-xs bg-slate-800 dark:bg-slate-100 text-slate-300 dark:text-slate-700 border border-slate-700 dark:border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        title="Tanggal akhir"
      />

      {/* Clear filters */}
      {hasActiveFilters && (
        <button
          onClick={clearFilters}
          className="px-3 py-1.5 rounded-lg text-xs bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
        >
          Clear Filter
        </button>
      )}
    </div>
  );

  // ─── Detail Modal ─────────────────────────────────────────────
  const DetailModal = () => {
    if (!selectedAnalytic) return null;
    const a = selectedAnalytic;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowAnalyticDetail(false)}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          onClick={e => e.stopPropagation()}
          className="bg-slate-900 dark:bg-white border border-slate-800 dark:border-slate-200 rounded-2xl p-6 w-full max-w-lg mx-4 shadow-2xl max-h-[80vh] overflow-y-auto"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-white dark:text-slate-900">Detail Closing</h2>
            <button onClick={() => setShowAnalyticDetail(false)} className="text-slate-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-slate-500 dark:text-slate-400">Tanggal</span>
                <p className="text-white dark:text-slate-900 font-medium">{format(new Date(a.analyzed_at), 'dd MMM yyyy, HH:mm')}</p>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400">Score</span>
                <p className={`font-bold text-lg ${getScoreColor(a.conversation_score)}`}>{a.conversation_score.toFixed(1)}</p>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400">Produk</span>
                <p className="text-white dark:text-slate-900">{getProductLabel(a.product_type)}</p>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400">Metode Bayar</span>
                <p className="text-white dark:text-slate-900">{a.metode_bayar || '-'}</p>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400">Pesan s/d Closing</span>
                <p className="text-white dark:text-slate-900">{a.pesan_sampai_closing}</p>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400">Pola Diekstrak</span>
                <p className="text-white dark:text-slate-900">{a.patterns_extracted}</p>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400">Alur Lengkap</span>
                <p className="text-white dark:text-slate-900">{a.alur_lengkap ? <Check className="w-4 h-4 text-emerald-400 inline" /> : <X className="w-4 h-4 text-red-400 inline" />}</p>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400">Data Lengkap</span>
                <p className="text-white dark:text-slate-900">{a.data_lengkap ? <Check className="w-4 h-4 text-emerald-400 inline" /> : <X className="w-4 h-4 text-red-400 inline" />}</p>
              </div>
            </div>

            {/* Store info */}
            {a.Store && (
              <div className="border-t border-slate-800 dark:border-slate-200 pt-3">
                <span className="text-slate-500 dark:text-slate-400">Toko</span>
                <p className="text-white dark:text-slate-900">{a.Store.name || a.store_wa_id}</p>
              </div>
            )}

            {/* Contact info */}
            {a.ChatSummary && (
              <div className="border-t border-slate-800 dark:border-slate-200 pt-3">
                <span className="text-slate-500 dark:text-slate-400">Kontak</span>
                <p className="text-white dark:text-slate-900 font-medium">{a.ChatSummary.contact_name || a.contact_id}</p>
                {a.ChatSummary.contact_phone && (
                  <p className="text-slate-400 dark:text-slate-500 text-xs">{a.ChatSummary.contact_phone}</p>
                )}
              </div>
            )}

            {/* Summary */}
            {a.ChatSummary?.summary && (
              <div className="border-t border-slate-800 dark:border-slate-200 pt-3">
                <span className="text-slate-500 dark:text-slate-400">Ringkasan Chat</span>
                <p className="text-white dark:text-slate-900 mt-1 leading-relaxed whitespace-pre-wrap">{a.ChatSummary.summary}</p>
              </div>
            )}
          </div>

          {/* Jump to Chat button */}
          <div className="mt-6 flex gap-3">
            <button
              onClick={() => {
                setShowAnalyticDetail(false);
                navigateToChat(a.store_wa_id, a.contact_id);
              }}
              className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <ExternalLink className="w-4 h-4" /> Buka Chat
            </button>
            <button
              onClick={() => setShowAnalyticDetail(false)}
              className="px-4 py-2.5 bg-slate-800 dark:bg-slate-100 text-slate-400 dark:text-slate-700 rounded-xl text-sm hover:bg-slate-700 dark:hover:bg-slate-200 transition-colors"
            >
              Tutup
            </button>
          </div>
        </motion.div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white dark:text-slate-900 flex items-center gap-3">
            <Target className="w-8 h-8 text-emerald-400" />
            Closing Management
          </h1>
          <p className="text-slate-400 dark:text-slate-500 mt-1">Analisis closing, pola sukses, dan statistik penjualan.</p>
        </div>
      </motion.div>

      {/* Tabs */}
      <div className="flex bg-slate-900 dark:bg-white/80 p-1 rounded-xl border border-slate-800 dark:border-slate-200 w-fit">
        {[
          { key: 'overview', label: 'Overview', icon: BarChart3 },
          { key: 'patterns', label: 'Patterns', icon: Lightbulb },
          { key: 'analytics', label: 'Analytics', icon: Star },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key as any); setPage(1); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
              tab === t.key ? 'bg-blue-600 text-white dark:text-slate-900 shadow-lg' : 'text-slate-400 dark:text-slate-700 hover:text-slate-200'
            }`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* Unified Filter Bar */}
      <FilterBar />

      {/* CSV Export + Action Bar (only for analytics tab) */}
      {tab === 'analytics' && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCsv}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-colors shadow-lg shadow-emerald-500/20"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Filter saat ini akan diterapkan ke CSV
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Overview Tab */}
          {tab === 'overview' && stats && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Total Closing', value: stats.totalClosings, icon: Target, color: 'text-emerald-400' },
                  { label: 'Qualified (Score ≥6)', value: stats.qualifiedClosings, icon: Star, color: 'text-yellow-400' },
                  { label: 'Avg Score', value: stats.avgScore.toFixed(1), icon: TrendingUp, color: 'text-blue-400' },
                  { label: 'Qualified Rate', value: stats.totalClosings > 0 ? `${Math.round((stats.qualifiedClosings / stats.totalClosings) * 100)}%` : '0%', icon: Zap, color: 'text-purple-400' },
                ].map((card, i) => (
                  <motion.div
                    key={card.label}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 p-5 rounded-2xl backdrop-blur-xl"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-slate-400 dark:text-slate-500">{card.label}</p>
                        <p className={`text-2xl font-bold mt-1 ${card.color}`}>{card.value}</p>
                      </div>
                      <card.icon className={`w-8 h-8 ${card.color} opacity-50`} />
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* COD vs Transfer */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 p-5 rounded-2xl backdrop-blur-xl">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-400 dark:text-slate-500">COD (Cash on Delivery)</p>
                      <p className="text-2xl font-bold text-cyan-400 mt-1">{stats.codCount}</p>
                    </div>
                    <CreditCard className="w-8 h-8 text-cyan-400 opacity-50" />
                  </div>
                </div>
                <div className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 p-5 rounded-2xl backdrop-blur-xl">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-400 dark:text-slate-500">Transfer</p>
                      <p className="text-2xl font-bold text-yellow-400 mt-1">{stats.transferCount}</p>
                    </div>
                    <CreditCard className="w-8 h-8 text-yellow-400 opacity-50" />
                  </div>
                </div>
              </div>

              {Object.keys(stats.productBreakdown).length > 0 && (
                <div className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-2xl p-6 backdrop-blur-xl">
                  <h3 className="text-lg font-bold text-white dark:text-slate-900 mb-4">Breakdown per Produk</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {Object.entries(stats.productBreakdown).map(([type, count]) => (
                      <div key={type} className="bg-slate-950/50 dark:bg-slate-50 border border-slate-800 dark:border-slate-200 rounded-xl p-4 text-center">
                        <p className="text-sm text-slate-400 dark:text-slate-500">{getProductLabel(type)}</p>
                        <p className="text-2xl font-bold text-white dark:text-slate-900 mt-1">{count}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Patterns Tab */}
          {tab === 'patterns' && (
            <div className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-2xl backdrop-blur-xl overflow-hidden">
              {patterns.length > 0 ? (
                <div className="divide-y divide-slate-800">
                  {patterns.map((pattern) => (
                    <div key={pattern.id} className="p-5 hover:bg-slate-800 dark:bg-slate-100/30 transition-colors">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="font-bold text-white dark:text-slate-900 capitalize">{pattern.teknik.replace(/_/g, ' ')}</h3>
                            <span className={`px-2 py-0.5 rounded-md text-xs border ${
                              pattern.is_active ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'
                            }`}>
                              {pattern.is_active ? 'Active' : 'Inactive'}
                            </span>
                            <span className="text-xs text-slate-500 dark:text-slate-400">{getProductLabel(pattern.product_type)}</span>
                          </div>
                          <p className="text-sm text-slate-400 dark:text-slate-500 line-clamp-2">
                            {expandedPattern === pattern.id ? pattern.contoh_kalimat : pattern.contoh_kalimat?.slice(0, 150) + (pattern.contoh_kalimat?.length > 150 ? '...' : '')}
                          </p>
                          {expandedPattern === pattern.id && (
                            <div className="mt-3 space-y-2 text-sm">
                              <div>
                                <span className="text-slate-500 dark:text-slate-400">Konteks:</span>
                                <p className="text-slate-300 dark:text-slate-600">{pattern.konteks}</p>
                              </div>
                              <div>
                                <span className="text-slate-500 dark:text-slate-400">Dampak:</span>
                                <p className="text-slate-300 dark:text-slate-600">{pattern.dampak}</p>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 dark:text-slate-400">Confidence:</span>
                            <span className={`text-sm font-bold ${getScoreColor(pattern.confidence * 10)}`}>
                              {(pattern.confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">Frekuensi: {pattern.frequency}x</div>
                          <div className="flex gap-2 mt-2">
                            <button
                              onClick={() => setExpandedPattern(expandedPattern === pattern.id ? null : pattern.id)}
                              className="px-2 py-1 text-xs bg-slate-800 dark:bg-slate-100 rounded-lg text-slate-400 dark:text-slate-900 hover:text-white transition-colors"
                            >
                              {expandedPattern === pattern.id ? 'Sembunyikan' : 'Detail'}
                            </button>
                            <button
                              onClick={() => togglePattern(pattern.id)}
                              className={`px-2 py-1 text-xs rounded-lg transition-colors ${
                                pattern.is_active ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                              }`}
                            >
                              {pattern.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                            </button>
                            <button
                              onClick={() => handleDeletePattern(pattern.id)}
                              className="px-2 py-1 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                              title="Hapus pola"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-slate-800/50 dark:bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Lightbulb className="w-8 h-8 text-slate-500 dark:text-slate-400" />
                  </div>
                  <h3 className="text-lg font-medium text-slate-300 dark:text-slate-600">Belum ada pola</h3>
                  <p className="text-slate-500 dark:text-slate-400 mt-1">Sistem akan otomatis belajar saat closing terjadi.</p>
                </div>
              )}
            </div>
          )}

          {/* Analytics Tab */}
          {tab === 'analytics' && (
            <div className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-2xl backdrop-blur-xl">
              {analytics.length > 0 ? (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-800 dark:border-slate-200">
                          <th className="text-left p-4 text-slate-400 dark:text-slate-500 font-medium">Tanggal</th>
                          <th className="text-left p-4 text-slate-400 dark:text-slate-500 font-medium">Kontak</th>
                          <th className="text-left p-4 text-slate-400 dark:text-slate-500 font-medium">Produk</th>
                          <th className="text-left p-4 text-slate-400 dark:text-slate-500 font-medium">Score</th>
                          <th className="text-left p-4 text-slate-400 dark:text-slate-500 font-medium">Pesan</th>
                          <th className="text-left p-4 text-slate-400 dark:text-slate-500 font-medium">Metode Bayar</th>
                          <th className="text-left p-4 text-slate-400 dark:text-slate-500 font-medium">Alur</th>
                          <th className="text-left p-4 text-slate-400 dark:text-slate-500 font-medium">Pola</th>
                          <th className="text-left p-4 text-slate-400 dark:text-slate-500 font-medium">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {analytics.map(a => (
                          <tr key={a.id} className="hover:bg-slate-800 dark:bg-slate-100/30 transition-colors cursor-pointer" onClick={() => { setSelectedAnalytic(a); setShowAnalyticDetail(true); }}>
                            <td className="p-4 text-slate-300 dark:text-slate-600">{format(new Date(a.analyzed_at), 'dd MMM, HH:mm')}</td>
                            <td className="p-4 text-slate-300 dark:text-slate-600 max-w-[150px] truncate">
                              {a.ChatSummary?.contact_name || a.contact_id || '-'}
                            </td>
                            <td className="p-4">
                              <span className="text-xs px-2 py-1 rounded-md bg-purple-500/10 text-purple-400">
                                {getProductLabel(a.product_type)}
                              </span>
                            </td>
                            <td className={`p-4 font-bold ${getScoreColor(a.conversation_score)}`}>
                              {a.conversation_score.toFixed(1)}
                            </td>
                            <td className="p-4 text-slate-300 dark:text-slate-600">{a.pesan_sampai_closing}</td>
                            <td className="p-4">
                              {a.metode_bayar ? (
                                <span className={`text-xs px-2 py-1 rounded-md ${a.metode_bayar === 'COD' ? 'bg-cyan-500/10 text-cyan-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
                                  {a.metode_bayar}
                                </span>
                              ) : '-'}
                            </td>
                            <td className="p-4">
                              {a.alur_lengkap ? <Check className="w-4 h-4 text-emerald-400" /> : <X className="w-4 h-4 text-red-400" />}
                            </td>
                            <td className="p-4 text-slate-300 dark:text-slate-600">{a.patterns_extracted}</td>
                            <td className="p-4">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigateToChat(a.store_wa_id, a.contact_id);
                                }}
                                className="px-2 py-1 text-xs bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors flex items-center gap-1"
                                title="Buka chat"
                              >
                                <ExternalLink className="w-3 h-3" /> Chat
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {totalPages > 1 && (
                    <div className="flex justify-center gap-2 p-4 border-t border-slate-800 dark:border-slate-200">
                      <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="px-4 py-2 bg-slate-800 dark:bg-slate-100 rounded-xl text-sm text-slate-300 dark:text-slate-600 disabled:opacity-30 hover:bg-slate-700"
                      >
                        ← Prev
                      </button>
                      <span className="px-4 py-2 text-sm text-slate-400 dark:text-slate-500">Page {page} / {totalPages}</span>
                      <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        className="px-4 py-2 bg-slate-800 dark:bg-slate-100 rounded-xl text-sm text-slate-300 dark:text-slate-600 disabled:opacity-30 hover:bg-slate-700"
                      >
                        Next →
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-slate-800/50 dark:bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Star className="w-8 h-8 text-slate-500 dark:text-slate-400" />
                  </div>
                  <h3 className="text-lg font-medium text-slate-300 dark:text-slate-600">Belum ada data analitik</h3>
                  <p className="text-slate-500 dark:text-slate-400 mt-1">Analitik akan muncul setelah sistem menganalisis percakapan closing.</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Detail Modal */}
      {showAnalyticDetail && <DetailModal />}
    </div>
  );
};

export default Closing;
