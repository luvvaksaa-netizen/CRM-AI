import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Search, Tag, Filter, Eye, X, ChevronLeft, MessageCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { format } from 'date-fns';

interface Summary {
  store_wa_id: string;
  store_name: string;
  contact_id: string;
  contact_name: string;
  contact_phone?: string;
  summary: string;
  wa_labels: string[];
  last_updated: string;
}

interface SummaryDetail extends Summary {
  messages: Array<{
    id: number;
    body: string;
    is_from_me: boolean;
    sender_name: string;
    timestamp: string;
  }>;
}

const LABEL_COLORS: Record<string, string> = {
  'Closing': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  'Cancel': 'bg-red-500/10 text-red-400 border-red-500/20',
  'Hot Lead': 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  'Menunggu Transfer': 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  'Menunggu Rekap': 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  'Menunggu Alamat': 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  'AI Lead Aktif': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'AI Lead Baru': 'bg-slate-500/10 text-slate-400 dark:text-slate-500 border-slate-500/20',
  'COD': 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
};



const Summaries = () => {
  const navigate = useNavigate();
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [labelFilter, setLabelFilter] = useState('semua');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [stores, setStores] = useState<any[]>([]);
  const [storeFilter, setStoreFilter] = useState('semua');
  const [labelData, setLabelData] = useState<{ labelCounts: Record<string, number>; total: number }>({ labelCounts: {}, total: 0 });

  // Detail modal
  const [selectedSummary, setSelectedSummary] = useState<SummaryDetail | null>(null);
  const [, setLoadingDetail] = useState(false);

  // Fetch stores for dropdown (once on mount)
  useEffect(() => {
    api.get('/stores').then(res => setStores(res.data || [])).catch(() => {});
  }, []);

  // Fetch labels for filter chips — refetch when store filter changes
  useEffect(() => {
    const params: any = {};
    if (storeFilter !== 'semua') params.store_wa_id = storeFilter;
    api.get('/summaries/labels', { params }).then(res => {
      setLabelData({ labelCounts: res.data.labelCounts || {}, total: res.data.total || 0 });
    }).catch(() => {});
  }, [storeFilter]);

  useEffect(() => { fetchSummaries(); }, [page, labelFilter, storeFilter]);

  const fetchSummaries = async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 20 };
      if (searchQuery) params.search = searchQuery;
      if (labelFilter !== 'semua') params.label = labelFilter;
      if (storeFilter !== 'semua') params.store_wa_id = storeFilter;

      const res = await api.get('/summaries', { params });
      setSummaries(res.data.data || []);
      setTotalPages(res.data.totalPages || 1);
      setTotal(res.data.total || 0);
    } catch {
      // Jangan reset data — biarkan data lama tetap tampil
      toast.error('Gagal mengambil data rekap');
    } finally { setLoading(false); }
  };


  const handleSearch = () => {
    setPage(1);
    fetchSummaries();
  };

  const navigateToChat = (storeWaId: string, contactId: string) => {
    // Simpan target di sessionStorage agar ChatManagement bisa auto-select
    sessionStorage.setItem('chatTarget', JSON.stringify({ storeWaId, contactId }));
    setSelectedSummary(null);
    navigate('/chat');
  };

  const openDetail = async (s: Summary) => {
    setLoadingDetail(true);
    try {
      const res = await api.get(`/summaries/${encodeURIComponent(s.store_wa_id)}/${encodeURIComponent(s.contact_id)}`);
      setSelectedSummary(res.data);
    } catch {
      toast.error('Gagal mengambil detail rekap');
    } finally { setLoadingDetail(false); }
  };

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white dark:text-slate-900 flex items-center gap-3">
            <FileText className="w-8 h-8 text-yellow-400" />
            Rekap Pembahasan
          </h1>
          <p className="text-slate-400 dark:text-slate-500 mt-1">Ringkasan percakapan AI per kontak. {total > 0 && `${total} total rekap.`}</p>
        </div>
      </motion.div>

      {/* Store filter */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-sm text-slate-400 dark:text-slate-500">Toko:</span>
        <select
          value={storeFilter}
          onChange={(e) => { setStoreFilter(e.target.value); setPage(1); }}
          className="bg-slate-800 dark:bg-slate-100 border border-slate-700 dark:border-slate-300 text-sm text-white dark:text-slate-900 rounded-lg px-3 py-1.5 outline-none focus:border-blue-500"
        >
          <option value="semua">Semua Toko</option>
          {stores.map((s: any) => (
            <option key={s.wa_id} value={s.wa_id}>{s.name || s.wa_id}</option>
          ))}
        </select>
      </div>

      <div className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-2xl p-6 backdrop-blur-xl">
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="flex-1 flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="Cari nama, nomor, atau ID kontak..."
                className="w-full bg-slate-950/50 dark:bg-slate-50 border border-slate-700/50 dark:border-slate-300 rounded-xl py-2.5 pl-9 pr-4 text-sm text-slate-200 dark:text-slate-700 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all"
              />
            </div>
            <button
              onClick={handleSearch}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl text-white dark:text-slate-900 text-sm font-medium transition-colors"
            >
              Cari
            </button>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <Filter className="w-4 h-4 text-slate-400 dark:text-slate-500" />
            <button
              onClick={() => { setLabelFilter('semua'); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                labelFilter === 'semua'
                  ? 'bg-blue-600 text-white dark:text-slate-900'
                  : 'bg-slate-800 dark:bg-slate-100 text-slate-400 dark:text-slate-700 hover:text-slate-200'
              }`}
            >
              Semua{labelData.total > 0 ? ` (${labelData.total})` : ''}
            </button>
            {Object.entries(labelData.labelCounts).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => (
              <button
                key={label}
                onClick={() => { setLabelFilter(label); setPage(1); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  labelFilter === label
                    ? 'bg-blue-600 text-white dark:text-slate-900'
                    : 'bg-slate-800 dark:bg-slate-100 text-slate-400 dark:text-slate-700 hover:text-slate-200'
                }`}
              >
                {label} ({count})
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : summaries.length > 0 ? (
          <>
            <div className="grid gap-3">
              {summaries.map((s, i) => (
                <motion.div
                  key={`${s.store_wa_id}_${s.contact_id}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.5) }}
                  onClick={() => openDetail(s)}
                  className="bg-slate-950/50 dark:bg-slate-50 border border-slate-800 dark:border-slate-200/80 rounded-xl p-4 hover:bg-slate-800/50 dark:bg-slate-100 transition-colors cursor-pointer group"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="font-bold text-white dark:text-slate-900 truncate">{s.contact_name || 'Pelanggan'}</h3>
                        {s.contact_phone && (
                          <span className="text-xs text-slate-500 dark:text-slate-400">{s.contact_phone}</span>
                        )}
                        <span className="text-xs text-slate-600">{s.store_name}</span>
                      </div>
                      <p className="text-sm text-slate-400 dark:text-slate-500 line-clamp-2 mt-1">{s.summary || 'Belum ada rekapan.'}</p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {s.wa_labels.map(label => (
                          <span key={label} className={`px-2 py-0.5 rounded-md text-xs border ${LABEL_COLORS[label] || 'bg-slate-800 dark:bg-slate-100 text-slate-400 dark:text-slate-500 border-slate-700 dark:border-slate-300'}`}>
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xs text-slate-500 dark:text-slate-400">{format(new Date(s.last_updated), 'dd MMM, HH:mm')}</span>
                      <div className="mt-2">
                        <Eye className="w-4 h-4 text-slate-500 dark:text-slate-400 group-hover:text-blue-400 transition-colors ml-auto" />
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-6">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-4 py-2 bg-slate-800 dark:bg-slate-100 rounded-xl text-sm text-slate-300 dark:text-slate-600 disabled:opacity-30 hover:bg-slate-700 transition-colors"
                >
                  ← Prev
                </button>
                <span className="px-4 py-2 text-sm text-slate-400 dark:text-slate-500">Page {page} / {totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-4 py-2 bg-slate-800 dark:bg-slate-100 rounded-xl text-sm text-slate-300 dark:text-slate-600 disabled:opacity-30 hover:bg-slate-700 transition-colors"
                >
                  Next →
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-slate-800/50 dark:bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-slate-500 dark:text-slate-400" />
            </div>
            <h3 className="text-lg font-medium text-slate-300 dark:text-slate-600">Tidak ada rekap</h3>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              {labelFilter !== 'semua' ? `Tidak ada kontak dengan label "${labelFilter}".` : 'Belum ada percakapan yang direkap oleh AI.'}
            </p>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedSummary && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedSummary(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 dark:bg-white border border-slate-800 dark:border-slate-200 rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-6 border-b border-slate-800 dark:border-slate-200">
                <div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setSelectedSummary(null)} className="p-1 text-slate-400 dark:text-slate-500 hover:text-white dark:text-slate-900">
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <h2 className="text-lg font-bold text-white dark:text-slate-900">{selectedSummary.contact_name || 'Pelanggan'}</h2>
                  </div>
                  <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">ID: {selectedSummary.contact_id}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigateToChat(selectedSummary.store_wa_id, selectedSummary.contact_id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 text-xs font-medium transition-colors"
                    title="Buka chat dengan kontak ini"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Buka Chat
                  </button>
                  <button onClick={() => setSelectedSummary(null)} className="p-2 text-slate-400 dark:text-slate-500 hover:text-white dark:text-slate-900">
                  <X className="w-5 h-5" />
                </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {/* AI Summary */}
                <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4">
                  <h3 className="text-sm font-bold text-blue-400 mb-2 flex items-center gap-2">
                    <FileText className="w-4 h-4" /> Rekap AI
                  </h3>
                  <pre className="text-sm text-slate-300 dark:text-slate-600 whitespace-pre-wrap font-sans">{selectedSummary.summary || 'Belum ada rekapan.'}</pre>
                </div>

                {/* Labels */}
                {selectedSummary.wa_labels.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-slate-300 dark:text-slate-600 mb-2 flex items-center gap-2">
                      <Tag className="w-4 h-4" /> Labels
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedSummary.wa_labels.map(l => (
                        <span key={l} className={`px-3 py-1 rounded-lg text-xs font-medium border ${LABEL_COLORS[l] || 'bg-slate-800 dark:bg-slate-100 text-slate-400 dark:text-slate-500 border-slate-700 dark:border-slate-300'}`}>
                          {l}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent Messages */}
                {selectedSummary.messages && selectedSummary.messages.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-slate-300 dark:text-slate-600 mb-2 flex items-center gap-2">
                      <MessageCircle className="w-4 h-4" /> Percakapan Terakhir ({selectedSummary.messages.length})
                    </h3>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {selectedSummary.messages.slice(-30).map((msg, idx) => (
                        <div key={msg.id || idx} className={`flex ${msg.is_from_me ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm ${
                            msg.is_from_me
                              ? 'bg-blue-600/30 text-slate-200 dark:text-slate-700'
                              : 'bg-slate-800 dark:bg-slate-100 text-slate-300 dark:text-slate-600'
                          }`}>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">{msg.sender_name}</p>
                            <p>{msg.body}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Summaries;
