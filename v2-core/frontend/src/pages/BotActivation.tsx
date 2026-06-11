import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  Power,
  PowerOff,
  RefreshCw,
  Users,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';

// ─── Types ───

interface BotAgent {
  id: number;
  name: string;
}

interface StoreBotStatus {
  wa_id: string;
  name: string;
  is_bot_active: boolean;
  last_active?: string;
  agent: BotAgent | null;
  pendingFollowUps: number;
  activeContactCount: number;
}

// ─── Helpers ───

// ─── Card wrapper ───

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-2xl backdrop-blur-xl ${className}`}>
    {children}
  </div>
);

// ─── Main Component ───

const BotActivation = () => {
  const [stores, setStores] = useState<StoreBotStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingStore, setTogglingStore] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStores = useCallback(async () => {
    try {
      setError(null);
      const res = await api.get('/bot-activation/stores');
      setStores(res.data);
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Gagal mengambil data bot activation.';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStores();
  }, [fetchStores]);

  const handleToggle = async (wa_id: string, currentActive: boolean) => {
    const newState = !currentActive;
    const action = newState ? 'mengaktifkan' : 'menonaktifkan';
    
    if (!confirm(`Yakin ingin ${action} bot untuk store ini?`)) return;

    setTogglingStore(wa_id);
    try {
      const res = await api.post(`/bot-activation/${encodeURIComponent(wa_id)}/toggle`, {
        active: newState,
      });
      
      // Optimistic update
      setStores(prev =>
        prev.map(s =>
          s.wa_id === wa_id ? { ...s, is_bot_active: newState } : s
        )
      );
      
      toast.success(res.data.message || `Bot berhasil di${action}.`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || `Gagal ${action} bot.`);
    } finally {
      setTogglingStore(null);
    }
  };

  // Stats
  const activeCount = stores.filter(s => s.is_bot_active).length;
  const inactiveCount = stores.filter(s => !s.is_bot_active).length;
  const totalPendingFollowUps = stores.reduce((sum, s) => sum + s.pendingFollowUps, 0);
  const totalActiveContacts = stores.reduce((sum, s) => sum + s.activeContactCount, 0);

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
        <h1 className="text-3xl font-bold text-white dark:text-slate-900 flex items-center gap-3">
          <Bot className="w-8 h-8 text-purple-400" />
          Bot Activation
        </h1>
        <p className="text-slate-400 dark:text-slate-500 mt-1">
          Kelola aktivasi bot AI per store — nyalakan/matikan auto-reply WhatsApp.
        </p>
      </motion.div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/5 rounded-full blur-2xl group-hover:bg-purple-500/10 transition-colors" />
          <div className="flex items-start justify-between relative z-10">
            <div>
              <p className="text-sm text-slate-400 dark:text-slate-500 mb-1">Bot Active</p>
              <p className="text-2xl font-bold text-white dark:text-slate-900">
                {loading ? '—' : activeCount}
              </p>
              <p className="text-xs text-slate-500 mt-1">dari {stores.length} store</p>
            </div>
            <div className="p-2.5 bg-purple-500/10 rounded-xl text-purple-400">
              <Zap className="w-5 h-5" />
            </div>
          </div>
        </Card>

        <Card className="p-5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-slate-500/5 rounded-full blur-2xl group-hover:bg-slate-500/10 transition-colors" />
          <div className="flex items-start justify-between relative z-10">
            <div>
              <p className="text-sm text-slate-400 dark:text-slate-500 mb-1">Bot Inactive</p>
              <p className="text-2xl font-bold text-white dark:text-slate-900">
                {loading ? '—' : inactiveCount}
              </p>
            </div>
            <div className="p-2.5 bg-slate-500/10 rounded-xl text-slate-400">
              <PowerOff className="w-5 h-5" />
            </div>
          </div>
        </Card>

        <Card className="p-5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl group-hover:bg-amber-500/10 transition-colors" />
          <div className="flex items-start justify-between relative z-10">
            <div>
              <p className="text-sm text-slate-400 dark:text-slate-500 mb-1">Pending FollowUp</p>
              <p className="text-2xl font-bold text-white dark:text-slate-900">
                {loading ? '—' : totalPendingFollowUps}
              </p>
            </div>
            <div className="p-2.5 bg-amber-500/10 rounded-xl text-amber-400">
              <Clock className="w-5 h-5" />
            </div>
          </div>
        </Card>

        <Card className="p-5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full blur-2xl group-hover:bg-blue-500/10 transition-colors" />
          <div className="flex items-start justify-between relative z-10">
            <div>
              <p className="text-sm text-slate-400 dark:text-slate-500 mb-1">Active Contacts (24j)</p>
              <p className="text-2xl font-bold text-white dark:text-slate-900">
                {loading ? '—' : totalActiveContacts}
              </p>
            </div>
            <div className="p-2.5 bg-blue-500/10 rounded-xl text-blue-400">
              <Users className="w-5 h-5" />
            </div>
          </div>
        </Card>
      </div>

      {/* Actions */}
      <Card className="p-5 flex flex-wrap items-center gap-3">
        <button
          onClick={fetchStores}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 dark:bg-slate-100 hover:bg-slate-700 text-slate-200 dark:text-slate-700 rounded-xl text-sm font-medium transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
        {error && (
          <p className="text-xs text-red-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            {error}
          </p>
        )}
      </Card>

      {/* Store List */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
        </div>
      ) : stores.length === 0 ? (
        <Card className="p-12 text-center">
          <Bot className="w-16 h-16 mx-auto mb-4 text-slate-600 opacity-50" />
          <p className="text-slate-400 dark:text-slate-500 text-lg">Belum ada store terdaftar.</p>
          <p className="text-slate-500 text-sm mt-1">
            Tambahkan store di halaman WA Devices terlebih dahulu.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence>
            {stores.map((store, idx) => (
              <motion.div
                key={store.wa_id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
              >
                <Card className="p-5 hover:bg-slate-800/30 dark:hover:bg-slate-50 transition-colors group">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-bold text-white dark:text-slate-900 truncate">
                        {store.name}
                      </h3>
                      <p className="text-xs text-slate-500 font-mono mt-0.5 truncate">
                        {store.wa_id}
                      </p>
                    </div>
                    <div className={`ml-3 px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 ${
                      store.is_bot_active
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : 'bg-slate-500/10 text-slate-400 border border-slate-500/30'
                    }`}>
                      {store.is_bot_active ? (
                        <CheckCircle2 className="w-3 h-3" />
                      ) : (
                        <XCircle className="w-3 h-3" />
                      )}
                      {store.is_bot_active ? 'Active' : 'Inactive'}
                    </div>
                  </div>

                  {/* Agent Info */}
                  {store.agent && (
                    <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-slate-950/50 dark:bg-slate-50 rounded-lg border border-slate-800/50 dark:border-slate-200">
                      <Bot className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                      <span className="text-xs text-slate-300 dark:text-slate-600 truncate">
                        Agent: <span className="font-medium text-purple-400">{store.agent.name}</span>
                      </span>
                    </div>
                  )}
                  {store.last_active && (
                    <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-slate-950/50 dark:bg-slate-50 rounded-lg border border-slate-800/50 dark:border-slate-200">
                      <Clock className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span className="text-xs text-slate-400 dark:text-slate-500 truncate">
                        Last active: {new Date(store.last_active).toLocaleString('id-ID')}
                      </span>
                    </div>
                  )}

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-slate-950/50 dark:bg-slate-50 rounded-lg p-2.5 border border-slate-800/50 dark:border-slate-200">
                      <p className="text-xs text-slate-500 mb-0.5">Pending FU</p>
                      <p className="text-lg font-bold text-white dark:text-slate-900">
                        {store.pendingFollowUps}
                      </p>
                    </div>
                    <div className="bg-slate-950/50 dark:bg-slate-50 rounded-lg p-2.5 border border-slate-800/50 dark:border-slate-200">
                      <p className="text-xs text-slate-500 mb-0.5">Kontak 24j</p>
                      <p className="text-lg font-bold text-white dark:text-slate-900">
                        {store.activeContactCount}
                      </p>
                    </div>
                  </div>

                  {/* Toggle Button */}
                  <button
                    onClick={() => handleToggle(store.wa_id, store.is_bot_active)}
                    disabled={togglingStore === store.wa_id}
                    className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all active:scale-95 disabled:opacity-50 ${
                      store.is_bot_active
                        ? 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-500/20'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                    }`}
                  >
                    {togglingStore === store.wa_id ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Processing...
                      </>
                    ) : store.is_bot_active ? (
                      <>
                        <PowerOff className="w-4 h-4" />
                        Nonaktifkan Bot
                      </>
                    ) : (
                      <>
                        <Power className="w-4 h-4" />
                        Aktifkan Bot
                      </>
                    )}
                  </button>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};

export default BotActivation;
