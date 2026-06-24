import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings2,
  UserCog,
  Activity,
  Database,
  Wifi,
  WifiOff,
  Download,
  Trash2,
  Plus,
  RefreshCw,
  RotateCw,
  Shield,
  Cpu,
  HardDrive,
  Clock,
  Server,
  AlertTriangle,
  Save,
  CheckCircle2,
  XCircle,
  Store,
  Smartphone,
  DollarSign,
  Send,
  Bot,
  Package,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Filter,
  TrendingUp,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import toast from 'react-hot-toast';
import api from '../services/api';
import { socketService } from '../services/socket';

// ─── Types ───

interface HealthData {
  ram: { total: number; used: number; free: number; percent: number };
  cpu: { count: number; load: number; percent: number };
  uptime: { process: string; system: string; processRaw: number; systemRaw: number };
  hostname: string;
  platform: string;
}

interface BackupItem {
  name: string;
  size: number;
  created: string;
}

interface WAStatusData {
  engineRunning: boolean;
  activeSessions: number;
  sessions: { storeId: string; status: string }[];
}

interface ProfileForm {
  currentPassword: string;
  newUsername: string;
  newPassword: string;
  confirmPassword: string;
}

/** Satu baris log request AI dari endpoint /api/openai/billing/usage-logs */
interface UsageLogItem {
  id: number;
  model: string;
  function_name: string;
  endpoint: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  cost_idr: number;
  store_wa_id: string | null;
  contact_id: string | null;
  contact_phone: string | null;
  created_at: string;
}

/** Respons paginasi dari endpoint usage-logs */
interface UsageLogsResponse {
  logs: UsageLogItem[];
  total: number;
  page: number;
  totalPages: number;
  limit: number;
}

/** Data biaya ringkasan (actual-costs endpoint) */
interface CostSummary {
  total_requests: number;
  total_cost: number;
  total_cost_openai: number;
  total_cost_deepseek: number;
  total_cost_idr: number;
  total_tokens: number;
  deepseek_balance: number | null;
  by_model: Record<string, { requests: number; cost: number; cost_idr: number; tokens: number }>;
  by_function: Record<string, { requests: number; cost: number; cost_idr: number; tokens: number }>;
  daily: Array<{ date: string; requests: number; cost: number; cost_idr: number; tokens: number }>;
}

// ─── Helpers ───

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatDate = (iso: string): string => {
  try {
    const d = new Date(iso);
    return d.toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};


interface StoreSettings {
  wa_id: string;
  name: string;
  is_bot_active: boolean;
  agent_id: number | null;
  last_active?: string;
  bot_phone?: string;
  connection_mode?: string;
}

// ─── Tabs ───

type TabId = 'profile' | 'monitor' | 'backup' | 'wa' | 'stores' | 'billing' | 'mengantar';

interface TabItem {
  id: TabId;
  label: string;
  icon: React.FC<{ className?: string }>;
}

const TABS: TabItem[] = [
  { id: 'profile', label: 'Profil Admin', icon: UserCog },
  { id: 'monitor', label: 'System Monitor', icon: Activity },
  { id: 'backup', label: 'Database Backup', icon: Database },
  { id: 'wa', label: 'WA Engine', icon: Wifi },
  { id: 'stores', label: 'Per-Store', icon: Store },
  { id: 'billing', label: 'AI Billing', icon: DollarSign },
  { id: 'mengantar', label: 'Mengantar / Expedisi', icon: Package },
];

// ─── Main Component ───

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-2xl backdrop-blur-xl ${className}`}>
    {children}
  </div>
);

const Settings = () => {
  const [activeTab, setActiveTab] = useState<TabId>('profile');

  // Profile state
  const [profileForm, setProfileForm] = useState<ProfileForm>({
    currentPassword: '',
    newUsername: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [profileLoading, setProfileLoading] = useState(false);

  // Health state
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Backup state
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupCreating, setBackupCreating] = useState(false);

  // WA state
  const [waStatus, setWaStatus] = useState<WAStatusData | null>(null);
  const [waLoading, setWaLoading] = useState(false);
  const [waRestarting, setWaRestarting] = useState(false);

  // Per-store settings state
  const [storeList, setStoreList] = useState<StoreSettings[]>([]);
  const [storeLoading, setStoreLoading] = useState(false);
  const [editingStore, setEditingStore] = useState<string | null>(null);
  const [storeForm, setStoreForm] = useState<{name: string; agent_id: number | ''; is_bot_active: boolean}>({name: '', agent_id: '', is_bot_active: true});
  const [storeSaving, setStoreSaving] = useState(false);

  // OpenAI Billing state
  const [billingConfig, setBillingConfig] = useState<any>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingSaving, setBillingSaving] = useState(false);
  const [billingForm, setBillingForm] = useState({
    openai_billing_enabled: 'true',
    openai_billing_interval_min: '360',
    openai_billing_daily_threshold: '10',
    openai_billing_telegram_token: '',
    openai_billing_telegram_chat_id: '',
    openai_billing_telegram_enabled: 'false',
  });
  const [billingTestingTelegram, setBillingTestingTelegram] = useState(false);

  // AI Billing Detail state
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);
  const [costSummaryLoading, setCostSummaryLoading] = useState(false);
  const [usageLogs, setUsageLogs] = useState<UsageLogsResponse | null>(null);
  const [usageLogsLoading, setUsageLogsLoading] = useState(false);
  const [usageLogsDays, setUsageLogsDays] = useState(30);
  const [usageLogsPage, setUsageLogsPage] = useState(1);
  const [usageLogsModel, setUsageLogsModel] = useState('');

  // Per-store agent list (pakai di stores tab juga)
  const [agentList, setAgentList] = useState<Array<{id: number; name: string}>>([]);

  // Mengantar state
  const [mengantarLoading, setMengantarLoading] = useState(false);
  const [mengantarSaving, setMengantarSaving] = useState(false);
  const [mengantarForm, setMengantarForm] = useState({
    api_key: '',
    address_id: '',
    sender_name: '',
    phone: '',
  });

  // ─── Fetch functions ───

  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const res = await api.get('/settings/health');
      setHealthData(res.data);
    } catch {
      toast.error('Gagal mengambil data health.');
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const fetchBackups = useCallback(async () => {
    setBackupLoading(true);
    try {
      const res = await api.get('/settings/backups');
      setBackups(res.data);
    } catch {
      toast.error('Gagal mengambil daftar backup.');
    } finally {
      setBackupLoading(false);
    }
  }, []);

  const fetchWAStatus = useCallback(async () => {
    setWaLoading(true);
    try {
      const res = await api.get('/settings/wa-status');
      setWaStatus(res.data);
    } catch {
      toast.error('Gagal mengambil status WA.');
    } finally {
      setWaLoading(false);
    }
  }, []);

  const fetchStores = useCallback(async () => {
    setStoreLoading(true);
    try {
      const res = await api.get('/bot-activation/stores');
      setStoreList(res.data);
    } catch {
      toast.error('Gagal mengambil daftar store.');
    } finally {
      setStoreLoading(false);
    }
  }, []);

  const fetchMengantarConfig = useCallback(async () => {
    setMengantarLoading(true);
    try {
      const res = await api.get('/mengantar/config');
      const cfg = res.data.config || res.data;
      setMengantarForm({
        api_key: cfg.api_key_raw || cfg.api_key || '',
        address_id: cfg.address_id || '',
        sender_name: cfg.sender_name || '',
        phone: cfg.phone || '',
      });
    } catch {
      toast.error('Gagal mengambil konfigurasi Mengantar.');
    } finally {
      setMengantarLoading(false);
    }
  }, []);

  const fetchBillingConfig = useCallback(async () => {
    setBillingLoading(true);
    try {
      const res = await api.get('/openai/billing/config');
      setBillingConfig(res.data);
      setBillingForm({
        openai_billing_enabled: res.data.enabled ? 'true' : 'false',
        openai_billing_interval_min: String(res.data.interval_min || 360),
        openai_billing_daily_threshold: String(res.data.daily_threshold || 10),
        openai_billing_telegram_token: res.data.telegram_token_raw || '',
        openai_billing_telegram_chat_id: res.data.telegram_chat_id || '',
        openai_billing_telegram_enabled: res.data.telegram_enabled ? 'true' : 'false',
      });
    } catch {
      toast.error('Gagal mengambil konfigurasi billing.');
    } finally {
      setBillingLoading(false);
    }
  }, []);

  /** Ambil ringkasan biaya AI (summary cards + grafik harian + per model) */
  const fetchCostSummary = useCallback(async (days = 30) => {
    setCostSummaryLoading(true);
    try {
      const res = await api.get(`/openai/billing/actual-costs?days=${days}`);
      setCostSummary(res.data);
    } catch {
      // Non-fatal — tampilkan error kecil saja
    } finally {
      setCostSummaryLoading(false);
    }
  }, []);

  /** Ambil log per-request (paginated) */
  const fetchUsageLogs = useCallback(async (days: number, page: number, model: string) => {
    setUsageLogsLoading(true);
    try {
      const params = new URLSearchParams({
        days: String(days),
        page: String(page),
        limit: '50',
      });
      if (model) params.set('model', model);
      const res = await api.get(`/openai/billing/usage-logs?${params.toString()}`);
      setUsageLogs(res.data);
    } catch {
      // Non-fatal
    } finally {
      setUsageLogsLoading(false);
    }
  }, []);

  const fetchAgentList = useCallback(async () => {
    try {
      const res = await api.get('/agents');
      setAgentList(res.data);
    } catch {}
  }, []);

  const handleEditStore = (store: StoreSettings) => {
    setEditingStore(store.wa_id);
    setStoreForm({
      name: store.name,
      agent_id: store.agent_id || '',
      is_bot_active: store.is_bot_active,
    });
  };

  const handleSaveStore = async (wa_id: string) => {
    setStoreSaving(true);
    try {
      await api.post(`/settings/${encodeURIComponent(wa_id)}`, {
        name: storeForm.name,
        agent_id: storeForm.agent_id || null,
        is_bot_active: storeForm.is_bot_active,
      });
      toast.success('Pengaturan store berhasil disimpan!');
      setEditingStore(null);
      fetchStores();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menyimpan.');
    } finally {
      setStoreSaving(false);
    }
  };

  // Auto-fetch when tab changes
  useEffect(() => {
    if (activeTab === 'monitor') fetchHealth();
    if (activeTab === 'backup') fetchBackups();
    if (activeTab === 'wa') fetchWAStatus();
    if (activeTab === 'stores') { fetchStores(); fetchAgentList(); }
    if (activeTab === 'billing') {
      fetchBillingConfig();
      fetchCostSummary(usageLogsDays);
      fetchUsageLogs(usageLogsDays, 1, usageLogsModel);
    }
    if (activeTab === 'mengantar') fetchMengantarConfig();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  /** Handler filter hari/model berubah: reset page ke 1 dan re-fetch */
  const handleUsageFilterChange = (newDays: number, newModel: string) => {
    setUsageLogsDays(newDays);
    setUsageLogsModel(newModel);
    setUsageLogsPage(1);
    fetchCostSummary(newDays);
    fetchUsageLogs(newDays, 1, newModel);
  };

  /** Handler pindah halaman log */
  const handleUsageLogsPageChange = (newPage: number) => {
    setUsageLogsPage(newPage);
    fetchUsageLogs(usageLogsDays, newPage, usageLogsModel);
  };

  // Real-time socket: live system stats & logs
  useEffect(() => {
    const socket = socketService.connect(); // Always returns valid connected socket
    const onSysStats = (data: any) => {
      setHealthData({
        ram: data.ram,
        cpu: data.cpu,
        uptime: data.uptime,
        hostname: '',
        platform: '',
      } as any);
    };
    const onSysLog = (data: any) => {
      // Logs bisa digunakan untuk monitoring real-time
      console.log('[SysLog]', data.type, data.msg);
    };
    socket?.on('sysStats', onSysStats);
    socket?.on('sysLog', onSysLog);
    return () => {
      socket?.off('sysStats', onSysStats);
      socket?.off('sysLog', onSysLog);
    };
  }, []);

  // Auto-refresh for System Monitor
  useEffect(() => {
    if (autoRefresh && activeTab === 'monitor') {
      autoRefreshRef.current = setInterval(() => {
        fetchHealth();
      }, 10000);
    }
    return () => {
      if (autoRefreshRef.current) {
        clearInterval(autoRefreshRef.current);
        autoRefreshRef.current = null;
      }
    };
  }, [autoRefresh, activeTab, fetchHealth]);

  // ─── Handlers ───

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileForm.currentPassword) {
      toast.error('Password saat ini wajib diisi.');
      return;
    }
    if (profileForm.newPassword && profileForm.newPassword.length < 4) {
      toast.error('Password baru minimal 4 karakter.');
      return;
    }
    if (profileForm.newPassword && profileForm.newPassword !== profileForm.confirmPassword) {
      toast.error('Konfirmasi password tidak cocok.');
      return;
    }
    setProfileLoading(true);
    try {
      const res = await api.put('/settings/profile', profileForm);
      toast.success(res.data.message || 'Profil berhasil diperbarui!');
      setProfileForm({ currentPassword: '', newUsername: '', newPassword: '', confirmPassword: '' });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal update profil.');
    } finally {
      setProfileLoading(false);
    }
  };

  const handleCreateBackup = async () => {
    setBackupCreating(true);
    try {
      await api.post('/settings/backups');
      toast.success('Snapshot database berhasil dibuat!');
      await fetchBackups();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal membuat backup.');
    } finally {
      setBackupCreating(false);
    }
  };

  const handleDeleteBackup = async (name: string) => {
    if (!confirm(`Yakin ingin menghapus ${name}?`)) return;
    try {
      await api.delete(`/settings/backups/${encodeURIComponent(name)}`);
      toast.success(`Backup ${name} dihapus.`);
      await fetchBackups();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menghapus backup.');
    }
  };

  const handleDownloadBackup = (name: string) => {
    const token = sessionStorage.getItem('crm_token');
    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3002/api';
    const url = `${baseUrl}/settings/backups/${encodeURIComponent(name)}/download`;
    // Create hidden anchor to trigger download with auth
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => {
        if (!res.ok) throw new Error('Download failed');
        return res.blob();
      })
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        URL.revokeObjectURL(a.href);
        toast.success(`Download ${name} dimulai.`);
      })
      .catch(() => toast.error('Gagal mendownload backup.'));
  };

  const handleDownloadLogs = () => {
    const token = sessionStorage.getItem('crm_token');
    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3002/api';
    const url = `${baseUrl}/settings/logs`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => {
        if (!res.ok) throw new Error('Download failed');
        return res.blob();
      })
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'debug-logs.txt';
        a.click();
        URL.revokeObjectURL(a.href);
        toast.success('Download debug logs dimulai.');
      })
      .catch(() => toast.error('Gagal mendownload logs.'));
  };

  const handleRestartWA = async () => {
    if (!confirm('Yakin ingin restart WA Engine? Sesi yang sedang aktif akan terputus sementara.')) return;
    setWaRestarting(true);
    try {
      const res = await api.post('/settings/wa-restart');
      toast.success(res.data.message || 'WA Engine restart dimulai.');
      setTimeout(() => fetchWAStatus(), 5000);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal restart WA.');
    } finally {
      setWaRestarting(false);
    }
  };

  // ─── OpenAI Billing Handlers ───

  const handleBillingSave = async () => {
    setBillingSaving(true);
    try {
      const res = await api.put('/openai/billing/config', billingForm);
      if (res.data?.success) {
        toast.success('Konfigurasi billing berhasil disimpan!');
        setBillingConfig(res.data.config);
        // Reload form with fresh data (masked token)
        await fetchBillingConfig();
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menyimpan konfigurasi.');
    } finally {
      setBillingSaving(false);
    }
  };

  const handleMengantarSave = async () => {
    setMengantarSaving(true);
    try {
      const res = await api.put('/mengantar/config', mengantarForm);
      if (res.data?.success) {
        toast.success('Konfigurasi Mengantar berhasil disimpan!');
        await fetchMengantarConfig();
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menyimpan konfigurasi.');
    } finally {
      setMengantarSaving(false);
    }
  };

  const handleBillingTestTelegram = async () => {
    setBillingTestingTelegram(true);
    try {
      const res = await api.post('/openai/billing/test-telegram');
      if (res.data?.success) {
        toast.success('Notifikasi Telegram berhasil terkirim!');
      } else {
        toast.error('Gagal kirim notifikasi. Cek token & chat ID.');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal test Telegram.');
    } finally {
      setBillingTestingTelegram(false);
    }
  };



  // ─── Render ───

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
        <h1 className="text-3xl font-bold text-white dark:text-slate-900 flex items-center gap-3">
          <Settings2 className="w-8 h-8 text-blue-400" />
          System Settings
        </h1>
        <p className="text-slate-400 dark:text-slate-500 mt-1">Kelola profil, monitoring sistem, backup database & WA Engine.</p>
      </motion.div>

      {/* Tab Navigation */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all whitespace-nowrap
                ${isActive
                  ? 'bg-blue-600 text-white dark:text-slate-900 shadow-lg shadow-blue-500/20'
                  : 'bg-slate-900/60 dark:bg-white text-slate-400 dark:text-slate-500 hover:text-slate-200 dark:text-slate-700 hover:bg-slate-800 dark:bg-slate-100/60 border border-slate-800/50 dark:border-slate-200'
                }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          {/* ─── Tab: Profil Admin ─── */}
          {activeTab === 'profile' && (
            <Card className="p-6 max-w-xl">
              <h2 className="text-xl font-bold text-white dark:text-slate-900 flex items-center gap-2 mb-6">
                <Shield className="w-5 h-5 text-blue-400" />
                Ubah Profil Admin
              </h2>
              <form onSubmit={handleProfileSubmit} className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-slate-300 dark:text-slate-600 block mb-1.5">Password Saat Ini</label>
                  <input
                    type="password"
                    value={profileForm.currentPassword}
                    onChange={e => setProfileForm(p => ({ ...p, currentPassword: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 dark:border-slate-300 rounded-xl py-2.5 px-4 text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500 placeholder-slate-500"
                    placeholder="Masukkan password saat ini"
                    autoComplete="current-password"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-300 dark:text-slate-600 block mb-1.5">Username Baru <span className="text-slate-500 dark:text-slate-400 font-normal">(opsional)</span></label>
                  <input
                    type="text"
                    value={profileForm.newUsername}
                    onChange={e => setProfileForm(p => ({ ...p, newUsername: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 dark:border-slate-300 rounded-xl py-2.5 px-4 text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500 placeholder-slate-500"
                    placeholder="Nama pengguna baru"
                    autoComplete="username"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-300 dark:text-slate-600 block mb-1.5">Password Baru <span className="text-slate-500 dark:text-slate-400 font-normal">(opsional)</span></label>
                  <input
                    type="password"
                    value={profileForm.newPassword}
                    onChange={e => setProfileForm(p => ({ ...p, newPassword: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 dark:border-slate-300 rounded-xl py-2.5 px-4 text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500 placeholder-slate-500"
                    placeholder="Minimal 4 karakter"
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-300 dark:text-slate-600 block mb-1.5">Konfirmasi Password Baru</label>
                  <input
                    type="password"
                    value={profileForm.confirmPassword}
                    onChange={e => setProfileForm(p => ({ ...p, confirmPassword: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 dark:border-slate-300 rounded-xl py-2.5 px-4 text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500 placeholder-slate-500"
                    placeholder="Ulangi password baru"
                    autoComplete="new-password"
                  />
                </div>
                <button
                  type="submit"
                  disabled={profileLoading}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white dark:text-slate-900 px-6 py-2.5 rounded-xl font-medium shadow-lg shadow-blue-500/20 flex items-center gap-2 transition-all active:scale-95"
                >
                  <Save className="w-4 h-4" />
                  {profileLoading ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </form>
            </Card>
          )}

          {/* ─── Tab: System Monitor ─── */}
          {activeTab === 'monitor' && (
            <div className="space-y-6">
              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* RAM */}
                <Card className="p-5 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full blur-2xl group-hover:bg-blue-500/10 transition-colors" />
                  <div className="flex items-start justify-between relative z-10">
                    <div>
                      <p className="text-sm text-slate-400 dark:text-slate-500 mb-1">RAM Usage</p>
                      <p className="text-2xl font-bold text-white dark:text-slate-900">
                        {healthData ? `${healthData.ram.percent}%` : '—'}
                      </p>
                      {healthData && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          {formatBytes(healthData.ram.used)} / {formatBytes(healthData.ram.total)}
                        </p>
                      )}
                    </div>
                    <div className="p-2.5 bg-blue-500/10 rounded-xl text-blue-400">
                      <HardDrive className="w-5 h-5" />
                    </div>
                  </div>
                  {/* Mini progress bar */}
                  {healthData && (
                    <div className="mt-3 w-full h-1.5 bg-slate-800 dark:bg-slate-100 rounded-full overflow-hidden relative z-10">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${healthData.ram.percent}%` }}
                        className={`h-full rounded-full ${healthData.ram.percent > 80 ? 'bg-red-500' : healthData.ram.percent > 60 ? 'bg-yellow-500' : 'bg-blue-500'}`}
                      />
                    </div>
                  )}
                </Card>

                {/* CPU */}
                <Card className="p-5 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/5 rounded-full blur-2xl group-hover:bg-purple-500/10 transition-colors" />
                  <div className="flex items-start justify-between relative z-10">
                    <div>
                      <p className="text-sm text-slate-400 dark:text-slate-500 mb-1">CPU Load</p>
                      <p className="text-2xl font-bold text-white dark:text-slate-900">
                        {healthData ? `${healthData.cpu.percent}%` : '—'}
                      </p>
                      {healthData && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{healthData.cpu.count} core</p>
                      )}
                    </div>
                    <div className="p-2.5 bg-purple-500/10 rounded-xl text-purple-400">
                      <Cpu className="w-5 h-5" />
                    </div>
                  </div>
                </Card>

                {/* Uptime */}
                <Card className="p-5 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl group-hover:bg-emerald-500/10 transition-colors" />
                  <div className="flex items-start justify-between relative z-10">
                    <div>
                      <p className="text-sm text-slate-400 dark:text-slate-500 mb-1">Uptime Server</p>
                      <p className="text-2xl font-bold text-white dark:text-slate-900">
                        {healthData ? healthData.uptime.system : '—'}
                      </p>
                      {healthData && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Process: {healthData.uptime.process}</p>
                      )}
                    </div>
                    <div className="p-2.5 bg-emerald-500/10 rounded-xl text-emerald-400">
                      <Clock className="w-5 h-5" />
                    </div>
                  </div>
                </Card>

                {/* System Info */}
                <Card className="p-5 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl group-hover:bg-amber-500/10 transition-colors" />
                  <div className="flex items-start justify-between relative z-10">
                    <div>
                      <p className="text-sm text-slate-400 dark:text-slate-500 mb-1">System Info</p>
                      <p className="text-lg font-bold text-white dark:text-slate-900">
                        {healthData ? healthData.hostname : '—'}
                      </p>
                      {healthData && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{healthData.platform}</p>
                      )}
                    </div>
                    <div className="p-2.5 bg-amber-500/10 rounded-xl text-amber-400">
                      <Server className="w-5 h-5" />
                    </div>
                  </div>
                </Card>
              </div>

              {/* Actions */}
              <Card className="p-5 flex flex-wrap items-center gap-3">
                <button
                  onClick={fetchHealth}
                  disabled={healthLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-800 dark:bg-slate-100 hover:bg-slate-700 text-slate-200 dark:text-slate-700 rounded-xl text-sm font-medium transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${healthLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
                <button
                  onClick={() => setAutoRefresh(prev => !prev)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                    autoRefresh
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white dark:text-slate-900 shadow-lg shadow-emerald-500/20'
                      : 'bg-slate-800 dark:bg-slate-100 hover:bg-slate-700 text-slate-200 dark:text-slate-700'
                  }`}
                >
                  <RefreshCw className={`w-4 h-4 ${autoRefresh ? 'animate-spin' : ''}`} />
                  Auto Refresh {autoRefresh ? 'ON' : 'OFF'}
                </button>
                <button
                  onClick={handleDownloadLogs}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white dark:text-slate-900 rounded-xl text-sm font-medium transition-colors shadow-lg shadow-blue-500/20"
                >
                  <Download className="w-4 h-4" />
                  Download Debug Logs
                </button>
              </Card>
            </div>
          )}

          {/* ─── Tab: Database Backup ─── */}
          {activeTab === 'backup' && (
            <div className="space-y-4">
              {/* Actions */}
              <Card className="p-5 flex flex-wrap items-center gap-3">
                <button
                  onClick={handleCreateBackup}
                  disabled={backupCreating}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white dark:text-slate-900 rounded-xl text-sm font-medium transition-colors shadow-lg shadow-blue-500/20"
                >
                  <Plus className="w-4 h-4" />
                  {backupCreating ? 'Membuat...' : 'Buat Snapshot Manual'}
                </button>
                <button
                  onClick={fetchBackups}
                  disabled={backupLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-800 dark:bg-slate-100 hover:bg-slate-700 text-slate-200 dark:text-slate-700 rounded-xl text-sm font-medium transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${backupLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </Card>

              {/* Backup List */}
              <Card className="overflow-hidden">
                {backupLoading ? (
                  <div className="flex justify-center py-16">
                    <div className="w-8 h-8 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                  </div>
                ) : backups.length === 0 ? (
                  <div className="text-center py-16 text-slate-500 dark:text-slate-400">
                    <Database className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>Belum ada snapshot database.</p>
                    <p className="text-sm mt-1">Klik "Buat Snapshot Manual" untuk memulai.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-800 dark:border-slate-200">
                          <th className="text-left py-3 px-5 text-slate-400 dark:text-slate-500 font-medium">Nama Snapshot</th>
                          <th className="text-left py-3 px-5 text-slate-400 dark:text-slate-500 font-medium">Ukuran</th>
                          <th className="text-left py-3 px-5 text-slate-400 dark:text-slate-500 font-medium hidden sm:table-cell">Tanggal</th>
                          <th className="text-right py-3 px-5 text-slate-400 dark:text-slate-500 font-medium">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {backups.map((b) => (
                          <motion.tr
                            key={b.name}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="hover:bg-slate-800 dark:bg-slate-100/30 transition-colors"
                          >
                            <td className="py-3 px-5 text-white dark:text-slate-900 font-mono text-xs">{b.name}</td>
                            <td className="py-3 px-5 text-slate-300 dark:text-slate-600">{formatBytes(b.size)}</td>
                            <td className="py-3 px-5 text-slate-400 dark:text-slate-500 hidden sm:table-cell">{formatDate(b.created)}</td>
                            <td className="py-3 px-5">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={() => handleDownloadBackup(b.name)}
                                  className="p-2 text-slate-400 dark:text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                                  title="Download"
                                >
                                  <Download className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteBackup(b.name)}
                                  className="p-2 text-slate-400 dark:text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                  title="Hapus"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </motion.tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* ─── Tab: WA Engine Status ─── */}
          {activeTab === 'wa' && (
            <div className="space-y-6">
              {/* Status Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Engine Status */}
                <Card className="p-5 relative overflow-hidden">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-slate-400 dark:text-slate-500 mb-1">WA Engine</p>
                      <div className="flex items-center gap-2 mt-1">
                        {waLoading ? (
                          <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                        ) : waStatus?.engineRunning ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                        ) : (
                          <XCircle className="w-5 h-5 text-red-400" />
                        )}
                        <p className="text-lg font-bold text-white dark:text-slate-900">
                          {waLoading ? 'Loading...' : waStatus?.engineRunning ? 'Running' : 'Stopped'}
                        </p>
                      </div>
                    </div>
                    <div className={`p-3 rounded-xl ${waStatus?.engineRunning ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                      {waStatus?.engineRunning ? <Wifi className="w-6 h-6" /> : <WifiOff className="w-6 h-6" />}
                    </div>
                  </div>
                </Card>

                {/* Active Sessions */}
                <Card className="p-5 relative overflow-hidden">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-slate-400 dark:text-slate-500 mb-1">Sesi Aktif</p>
                      <p className="text-3xl font-bold text-white dark:text-slate-900 mt-1">
                        {waLoading ? '—' : waStatus?.activeSessions ?? '—'}
                      </p>
                    </div>
                    <div className="p-3 bg-blue-500/10 rounded-xl text-blue-400">
                      <Activity className="w-6 h-6" />
                    </div>
                  </div>
                </Card>
              </div>

              {/* Session List */}
              {waStatus && waStatus.sessions.length > 0 && (
                <Card className="p-5">
                  <h3 className="text-sm font-medium text-slate-400 dark:text-slate-500 mb-3">Detail Sesi</h3>
                  <div className="space-y-2">
                    {waStatus.sessions.map((s) => (
                      <div key={s.storeId} className="flex items-center justify-between bg-slate-950/50 dark:bg-slate-50 rounded-lg px-4 py-2.5 border border-slate-800/50 dark:border-slate-200">
                        <span className="text-slate-200 dark:text-slate-700 text-sm font-mono">{s.storeId}</span>
                        <span className="flex items-center gap-1.5 text-emerald-400 text-xs">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          {s.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Actions */}
              <Card className="p-5 flex flex-wrap items-center gap-3">
                <button
                  onClick={fetchWAStatus}
                  disabled={waLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-800 dark:bg-slate-100 hover:bg-slate-700 text-slate-200 dark:text-slate-700 rounded-xl text-sm font-medium transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${waLoading ? 'animate-spin' : ''}`} />
                  Refresh Status
                </button>
                <button
                  onClick={handleRestartWA}
                  disabled={waRestarting || !waStatus?.engineRunning}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white dark:text-slate-900 rounded-xl text-sm font-medium transition-colors shadow-lg shadow-amber-500/20"
                >
                  <RotateCw className={`w-4 h-4 ${waRestarting ? 'animate-spin' : ''}`} />
                  {waRestarting ? 'Restarting...' : 'Restart WA Engine'}
                </button>
                {!waStatus?.engineRunning && !waLoading && (
                  <p className="text-xs text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    WA Engine tidak berjalan. Jalankan legacy server untuk mengaktifkan.
                  </p>
                )}
              </Card>
            </div>
          )}

          {/* ─── Tab: Per-Store Settings ─── */}
          {activeTab === 'stores' && (
            <div className="space-y-4">
              <Card className="p-5 flex flex-wrap items-center gap-3">
                <button
                  onClick={fetchStores}
                  disabled={storeLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-800 dark:bg-slate-100 hover:bg-slate-700 text-slate-200 dark:text-slate-700 rounded-xl text-sm font-medium transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${storeLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </Card>

              {storeLoading ? (
                <div className="flex justify-center py-16">
                  <div className="w-8 h-8 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                </div>
              ) : storeList.length === 0 ? (
                <div className="text-center py-16 text-slate-500 dark:text-slate-400">
                  <Smartphone className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>Belum ada store terdaftar.</p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {storeList.map(store => (
                    <Card key={store.wa_id} className="p-5">
                      {editingStore === store.wa_id ? (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="font-bold text-white dark:text-slate-900 text-sm font-mono">{store.wa_id}</h3>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-400 dark:text-slate-500 mb-1">Nama Store</label>
                            <input
                              type="text"
                              value={storeForm.name}
                              onChange={e => setStoreForm({...storeForm, name: e.target.value})}
                              className="w-full bg-slate-950 dark:bg-slate-50 border border-slate-700 dark:border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-200 dark:text-slate-700"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-400 dark:text-slate-500 mb-1">Agent</label>
                            <select
                              value={storeForm.agent_id}
                              onChange={e => setStoreForm({...storeForm, agent_id: e.target.value ? Number(e.target.value) : ''})}
                              className="w-full bg-slate-950 dark:bg-slate-50 border border-slate-700 dark:border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-200 dark:text-slate-700"
                            >
                              <option value="">Tanpa Agent</option>
                              {agentList.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </select>
                          </div>
                          <div className="flex items-center gap-3">
                            <label className="text-xs font-medium text-slate-400 dark:text-slate-500">Bot Active</label>
                            <button
                              onClick={() => setStoreForm({...storeForm, is_bot_active: !storeForm.is_bot_active})}
                              className={`relative w-12 h-6 rounded-full transition-colors ${storeForm.is_bot_active ? 'bg-emerald-500' : 'bg-slate-600'}`}
                            >
                              <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${storeForm.is_bot_active ? 'translate-x-6' : 'translate-x-0.5'}`} />
                            </button>
                          </div>
                          <div className="flex gap-2 pt-2">
                            <button
                              onClick={() => handleSaveStore(store.wa_id)}
                              disabled={storeSaving}
                              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium flex items-center gap-1.5 transition-colors"
                            >
                              <Save className="w-3.5 h-3.5" />
                              {storeSaving ? 'Menyimpan...' : 'Simpan'}
                            </button>
                            <button
                              onClick={() => setEditingStore(null)}
                              className="px-4 py-2 bg-slate-800 dark:bg-slate-100 hover:bg-slate-700 text-slate-300 dark:text-slate-600 rounded-xl text-sm transition-colors"
                            >
                              Batal
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <Smartphone className="w-4 h-4 text-slate-400" />
                              <h3 className="font-bold text-white dark:text-slate-900">{store.name}</h3>
                              <span className={`px-2 py-0.5 rounded text-xs ${store.is_bot_active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                                {store.is_bot_active ? 'Active' : 'Inactive'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 font-mono">{store.wa_id}</p>
                            {store.last_active && (
                              <p className="text-xs text-slate-500 mt-1">
                                Last active: {new Date(store.last_active).toLocaleString('id-ID')}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => handleEditStore(store)}
                            className="px-3 py-1.5 bg-slate-800 dark:bg-slate-100 hover:bg-slate-700 text-slate-300 dark:text-slate-600 rounded-lg text-xs transition-colors"
                          >
                            Edit
                          </button>
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* ─── Tab: AI Billing ─── */}
          {activeTab === 'billing' && (
            <div className="space-y-6">

              {/* ── 1. API Key Status Cards ─────────────────────────── */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* DeepSeek */}
                <div className="flex items-center justify-between bg-slate-800/50 dark:bg-slate-100 p-4 rounded-xl border border-slate-700/50 dark:border-slate-300">
                  <div className="flex items-center gap-3">
                    <Bot className="w-5 h-5 text-blue-400 shrink-0" />
                    <div>
                      <p className="font-bold text-white dark:text-slate-900 text-sm">DeepSeek API Key</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                        {billingConfig?.has_api_key ? '✅ Terdeteksi (Chat & Teks)' : '❌ Belum dikonfigurasi'}
                      </p>
                      {costSummary?.deepseek_balance !== null && costSummary?.deepseek_balance !== undefined && (
                        <p className="text-xs font-bold text-emerald-400 mt-0.5">
                          Saldo: ${costSummary.deepseek_balance.toFixed(2)}
                          {costSummary.deepseek_balance <= 2 && (
                            <span className="ml-1 text-red-400 animate-pulse">⚠ LOW</span>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {billingConfig?.has_api_key
                      ? <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      : <XCircle className="w-5 h-5 text-red-400" />}
                    <a href="https://platform.deepseek.com/top-up" target="_blank" rel="noopener noreferrer"
                       className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5 transition-colors">
                      Top Up <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                </div>

                {/* OpenAI — fix bug: pakai has_api_key sebagai fallback jika has_org_api_key tidak ada */}
                <div className="flex items-center justify-between bg-slate-800/50 dark:bg-slate-100 p-4 rounded-xl border border-slate-700/50 dark:border-slate-300">
                  <div className="flex items-center gap-3">
                    <Bot className="w-5 h-5 text-purple-400 shrink-0" />
                    <div>
                      <p className="font-bold text-white dark:text-slate-900 text-sm">OpenAI API Key</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                        {(billingConfig?.has_org_api_key || billingConfig?.has_api_key)
                          ? '✅ Terdeteksi (Vision & Audio)' : '❌ Belum dikonfigurasi'}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Saldo tidak bisa diambil otomatis (API deprecated)
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {(billingConfig?.has_org_api_key || billingConfig?.has_api_key)
                      ? <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      : <XCircle className="w-5 h-5 text-red-400" />}
                    <a href="https://platform.openai.com/settings/organization/billing" target="_blank" rel="noopener noreferrer"
                       className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5 transition-colors">
                      Cek Saldo <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                </div>
              </div>

              {/* ── 2. Summary Cards + Filter ────────────────────────── */}
              <Card className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                  <h2 className="text-lg font-bold text-white dark:text-slate-900 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-emerald-400" />
                    Ringkasan Penggunaan AI
                  </h2>
                  {/* Filter hari */}
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-slate-400" />
                    {([7, 30, 90] as const).map(d => (
                      <button key={d}
                        onClick={() => handleUsageFilterChange(d, usageLogsModel)}
                        className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                          usageLogsDays === d
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-800 dark:bg-slate-100 text-slate-400 dark:text-slate-500 hover:bg-slate-700'
                        }`}>
                        {d} hari
                      </button>
                    ))}
                    <button
                      onClick={() => { fetchCostSummary(usageLogsDays); fetchUsageLogs(usageLogsDays, usageLogsPage, usageLogsModel); }}
                      className="p-1.5 text-slate-400 hover:text-white transition-colors"
                      title="Refresh">
                      <RefreshCw className={`w-4 h-4 ${costSummaryLoading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>

                {costSummaryLoading ? (
                  <div className="flex justify-center py-8"><RefreshCw className="w-6 h-6 text-blue-500 animate-spin" /></div>
                ) : (
                  <>
                    {/* Summary number cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                      <div className="bg-slate-950/50 dark:bg-slate-50 rounded-xl p-3">
                        <p className="text-xs text-slate-400 dark:text-slate-500">Total Request</p>
                        <p className="text-2xl font-bold text-white dark:text-slate-900">{costSummary?.total_requests ?? 0}</p>
                        <p className="text-[11px] text-slate-500">{usageLogsDays} hari terakhir</p>
                      </div>
                      <div className="bg-slate-950/50 dark:bg-slate-50 rounded-xl p-3">
                        <p className="text-xs text-slate-400 dark:text-slate-500">Total Biaya</p>
                        <p className="text-2xl font-bold text-emerald-400">${(costSummary?.total_cost ?? 0).toFixed(4)}</p>
                        <p className="text-[11px] text-slate-500">≈ Rp {(costSummary?.total_cost_idr ?? 0).toLocaleString('id-ID')}</p>
                      </div>
                      <div className="bg-slate-950/50 dark:bg-slate-50 rounded-xl p-3">
                        <p className="text-xs text-slate-400 dark:text-slate-500">DeepSeek</p>
                        <p className="text-2xl font-bold text-blue-400">${(costSummary?.total_cost_deepseek ?? 0).toFixed(4)}</p>
                        <p className="text-[11px] text-slate-500">Pengeluaran model</p>
                      </div>
                      <div className="bg-slate-950/50 dark:bg-slate-50 rounded-xl p-3">
                        <p className="text-xs text-slate-400 dark:text-slate-500">OpenAI</p>
                        <p className="text-2xl font-bold text-purple-400">${(costSummary?.total_cost_openai ?? 0).toFixed(4)}</p>
                        <p className="text-[11px] text-slate-500">Vision & Audio</p>
                      </div>
                    </div>

                    {/* Grafik harian */}
                    {(costSummary?.daily ?? []).length > 0 && (
                      <div className="mb-6">
                        <p className="text-sm font-semibold text-slate-300 dark:text-slate-600 mb-3">📈 Pengeluaran Harian (USD)</p>
                        <ResponsiveContainer width="100%" height={180}>
                          <LineChart data={costSummary!.daily} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                            <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false}
                                   tickFormatter={v => v.slice(5)} />
                            <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} width={55}
                                   tickFormatter={v => `$${v.toFixed(4)}`} />
                            <Tooltip
                              contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
                              labelStyle={{ color: '#94a3b8' }}
                              formatter={(val: any) => [`$${Number(val).toFixed(6)}`, 'Biaya']}
                            />
                            <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                            <Line type="monotone" name="Biaya ($)" dataKey="cost" stroke="#10b981" strokeWidth={2}
                                  dot={false} activeDot={{ r: 5 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {/* Breakdown per model */}
                    {costSummary?.by_model && Object.keys(costSummary.by_model).length > 0 && (
                      <div className="mb-4">
                        <p className="text-sm font-semibold text-slate-300 dark:text-slate-600 mb-2">🤖 Breakdown per Model</p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-slate-400 dark:text-slate-500 border-b border-slate-800/50 dark:border-slate-200">
                                <th className="py-2 pr-3 font-medium">Model</th>
                                <th className="py-2 px-2 font-medium text-right">Request</th>
                                <th className="py-2 px-2 font-medium text-right">Token</th>
                                <th className="py-2 px-2 font-medium text-right">Biaya (USD)</th>
                                <th className="py-2 pl-2 font-medium text-right">Biaya (IDR)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(costSummary.by_model)
                                .sort(([, a], [, b]) => b.cost - a.cost)
                                .map(([model, data]) => (
                                  <tr key={model} className="border-b border-slate-800/20 dark:border-slate-100 hover:bg-slate-800/20 transition-colors">
                                    <td className="py-2 pr-3">
                                      <span className={`inline-flex items-center gap-1 text-xs font-mono font-medium ${
                                        model.includes('deepseek') ? 'text-blue-400' : 'text-purple-400'
                                      }`}>
                                        {model.includes('deepseek') ? '🔵' : '🟣'} {model}
                                      </span>
                                    </td>
                                    <td className="py-2 px-2 text-right text-slate-300 dark:text-slate-600">{data.requests.toLocaleString()}</td>
                                    <td className="py-2 px-2 text-right text-slate-400">{data.tokens.toLocaleString()}</td>
                                    <td className="py-2 px-2 text-right font-semibold text-emerald-400">${data.cost.toFixed(6)}</td>
                                    <td className="py-2 pl-2 text-right text-slate-300 dark:text-slate-600">
                                      Rp {(data.cost_idr ?? 0).toLocaleString('id-ID')}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Breakdown per fungsi */}
                    {costSummary?.by_function && Object.keys(costSummary.by_function).length > 0 && (
                      <details>
                        <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-200 mb-2 select-none">
                          ⚙️ Breakdown per Fungsi AI (klik untuk expand)
                        </summary>
                        <div className="mt-2 space-y-1">
                          {Object.entries(costSummary.by_function)
                            .sort(([, a], [, b]) => b.cost - a.cost)
                            .map(([fn, data]) => (
                              <div key={fn} className="flex items-center justify-between bg-slate-950/30 dark:bg-slate-50 rounded-lg px-3 py-1.5">
                                <span className="text-xs text-slate-300 dark:text-slate-600 font-mono">{fn}</span>
                                <span className="text-xs text-slate-400">
                                  {data.requests} req · <span className="text-emerald-400 font-medium">${data.cost.toFixed(6)}</span>
                                </span>
                              </div>
                            ))}
                        </div>
                      </details>
                    )}

                    {!costSummary || costSummary.total_requests === 0 && (
                      <p className="text-xs text-slate-500 text-center py-4">
                        Belum ada data penggunaan AI di {usageLogsDays} hari terakhir.
                        Data akan otomatis muncul saat bot merespons chat customer.
                      </p>
                    )}
                  </>
                )}
              </Card>

              {/* ── 3. Riwayat Request Detail (Per-Request Log) ──────── */}
              <Card className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <h2 className="text-lg font-bold text-white dark:text-slate-900 flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-blue-400" />
                    Riwayat Request Detail
                    {usageLogs && (
                      <span className="text-xs font-normal text-slate-400">({usageLogs.total} total)</span>
                    )}
                  </h2>
                  {/* Filter model */}
                  <div className="flex items-center gap-2">
                    <select
                      value={usageLogsModel}
                      onChange={e => handleUsageFilterChange(usageLogsDays, e.target.value)}
                      className="text-xs bg-slate-800 dark:bg-slate-100 border border-slate-700 dark:border-slate-300 text-slate-300 dark:text-slate-600 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500">
                      <option value="">Semua Model</option>
                      <option value="deepseek-chat">deepseek-chat</option>
                      <option value="deepseek-v4-pro">deepseek-v4-pro</option>
                      <option value="gpt-4o-mini">gpt-4o-mini</option>
                      <option value="gpt-4o">gpt-4o</option>
                      <option value="whisper-1">whisper-1</option>
                    </select>
                  </div>
                </div>

                {usageLogsLoading ? (
                  <div className="flex justify-center py-8"><RefreshCw className="w-6 h-6 text-blue-500 animate-spin" /></div>
                ) : (usageLogs?.logs ?? []).length === 0 ? (
                  <p className="text-sm text-center text-slate-500 py-8">
                    Belum ada riwayat request di periode ini.
                  </p>
                ) : (
                  <>
                    {/* Tabel log */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-slate-400 dark:text-slate-500 border-b border-slate-800/50 dark:border-slate-200">
                            <th className="py-2 pr-3 font-medium">Waktu</th>
                            <th className="py-2 px-2 font-medium">Model</th>
                            <th className="py-2 px-2 font-medium">Fungsi / Tujuan</th>
                            <th className="py-2 px-2 font-medium">Nomor HP</th>
                            <th className="py-2 px-2 font-medium">Store</th>
                            <th className="py-2 px-2 font-medium text-right">Token</th>
                            <th className="py-2 pl-2 font-medium text-right">Biaya</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(usageLogs?.logs ?? []).map(log => (
                            <tr key={log.id} className="border-b border-slate-800/10 dark:border-slate-100 hover:bg-slate-800/10 transition-colors">
                              <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">
                                {new Date(log.created_at).toLocaleString('id-ID', {
                                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                                })}
                              </td>
                              <td className="py-2 px-2">
                                <span className={`font-mono font-medium ${
                                  log.model.includes('deepseek') ? 'text-blue-400' : 'text-purple-400'
                                }`}>
                                  {log.model.length > 15 ? log.model.slice(0, 15) + '…' : log.model}
                                </span>
                              </td>
                              <td className="py-2 px-2">
                                <span className="text-slate-300 dark:text-slate-600">
                                  {/* Terjemahan fungsi ke bahasa yang mudah dipahami */}
                                  {log.function_name === 'getAIResponse' ? '💬 Balas Chat' :
                                   log.function_name === 'getAIResponse_secondCall' ? '💬 Balas Chat (2nd)' :
                                   log.function_name === 'generateChatSummary' ? '📋 Ringkasan Chat' :
                                   log.function_name === 'transcribeAudio' ? '🎤 Transkripsi Audio' :
                                   log.function_name === 'generateOrganicFollowUp' ? '📩 Follow Up' :
                                   log.function_name === 'runInspectorValidation' ? '🔍 Validasi Rekap' :
                                   log.function_name === 'analyzeImage' ? '🖼 Analisis Gambar' :
                                   log.function_name || '-'}
                                </span>
                              </td>
                              <td className="py-2 px-2">
                                {log.contact_phone ? (
                                  <span className="text-emerald-400 font-mono">
                                    {/* Tampilkan nomor HP dalam format lokal */}
                                    {String(log.contact_phone).startsWith('62')
                                      ? '0' + String(log.contact_phone).slice(2)
                                      : log.contact_phone}
                                  </span>
                                ) : (
                                  <span className="text-slate-600">—</span>
                                )}
                              </td>
                              <td className="py-2 px-2 text-slate-400 font-mono">
                                {log.store_wa_id
                                  ? String(log.store_wa_id).replace('@c.us', '').slice(-8)
                                  : '—'}
                              </td>
                              <td className="py-2 px-2 text-right text-slate-400">
                                {log.total_tokens.toLocaleString()}
                              </td>
                              <td className="py-2 pl-2 text-right">
                                <span className="text-emerald-400 font-semibold">${log.cost_usd.toFixed(6)}</span>
                                <br/>
                                <span className="text-slate-500">Rp {log.cost_idr.toLocaleString('id-ID')}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination */}
                    {usageLogs && usageLogs.totalPages > 1 && (
                      <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-800/30 dark:border-slate-100">
                        <p className="text-xs text-slate-500">
                          Halaman {usageLogs.page} dari {usageLogs.totalPages} ({usageLogs.total} request)
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleUsageLogsPageChange(usageLogs.page - 1)}
                            disabled={usageLogs.page <= 1 || usageLogsLoading}
                            className="p-1.5 rounded-lg bg-slate-800 dark:bg-slate-100 text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          {Array.from({ length: Math.min(5, usageLogs.totalPages) }, (_, i) => {
                            const p = Math.max(1, Math.min(usageLogs.page - 2, usageLogs.totalPages - 4)) + i;
                            return p <= usageLogs.totalPages ? (
                              <button key={p} onClick={() => handleUsageLogsPageChange(p)}
                                className={`w-7 h-7 rounded-lg text-xs font-medium transition-colors ${
                                  p === usageLogs.page
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-800 dark:bg-slate-100 text-slate-400 hover:text-white'
                                }`}>
                                {p}
                              </button>
                            ) : null;
                          })}
                          <button
                            onClick={() => handleUsageLogsPageChange(usageLogs.page + 1)}
                            disabled={usageLogs.page >= usageLogs.totalPages || usageLogsLoading}
                            className="p-1.5 rounded-lg bg-slate-800 dark:bg-slate-100 text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </Card>

              {/* ── 4. Konfigurasi Billing ──────────────────────────── */}
              <Card className="p-5">
                <h2 className="text-lg font-bold text-white dark:text-slate-900 flex items-center gap-2 mb-5">
                  <DollarSign className="w-5 h-5 text-emerald-400" />
                  Konfigurasi Monitoring
                </h2>

                {billingLoading ? (
                  <div className="flex justify-center py-8">
                    <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-4 max-w-xl">
                    {/* Enable/Disable */}
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-white dark:text-slate-900">Monitoring Aktif</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500">Jadwalkan fetch billing otomatis</p>
                      </div>
                      <button
                        onClick={() => setBillingForm(f => ({ ...f, openai_billing_enabled: f.openai_billing_enabled === 'true' ? 'false' : 'true' }))}
                        className={`relative w-12 h-6 rounded-full transition-colors ${billingForm.openai_billing_enabled === 'true' ? 'bg-emerald-500' : 'bg-slate-600'}`}>
                        <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${billingForm.openai_billing_enabled === 'true' ? 'translate-x-6' : 'translate-x-0.5'}`} />
                      </button>
                    </div>

                    {/* Interval */}
                    <div>
                      <label className="text-sm font-medium text-slate-300 dark:text-slate-600 block mb-1.5">Interval Fetch (menit)</label>
                      <input type="number" min={30} max={1440}
                        value={billingForm.openai_billing_interval_min}
                        onChange={e => setBillingForm(f => ({ ...f, openai_billing_interval_min: e.target.value }))}
                        className="w-full bg-slate-950 dark:bg-slate-50 border border-slate-700 dark:border-slate-300 rounded-xl py-2.5 px-4 text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500" />
                      <p className="text-xs text-slate-500 mt-1">Min: 30 menit, Default: 360 menit (6 jam)</p>
                    </div>

                    {/* Daily Threshold */}
                    <div>
                      <label className="text-sm font-medium text-slate-300 dark:text-slate-600 block mb-1.5">Threshold Harian ($)</label>
                      <input type="number" min={0.01} step={0.01}
                        value={billingForm.openai_billing_daily_threshold}
                        onChange={e => setBillingForm(f => ({ ...f, openai_billing_daily_threshold: e.target.value }))}
                        className="w-full bg-slate-950 dark:bg-slate-50 border border-slate-700 dark:border-slate-300 rounded-xl py-2.5 px-4 text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500" />
                      <p className="text-xs text-slate-500 mt-1">Notifikasi akan dikirim jika pemakaian melebihi threshold ini</p>
                    </div>
                  </div>
                )}
              </Card>

              {/* ── 5. Telegram Config ──────────────────────────────── */}
              <Card className="p-5">
                <h2 className="text-lg font-bold text-white dark:text-slate-900 flex items-center gap-2 mb-5">
                  <Send className="w-5 h-5 text-blue-400" />
                  Notifikasi Telegram
                </h2>

                {billingLoading ? (
                  <div className="flex justify-center py-8">
                    <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-4 max-w-xl">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-white dark:text-slate-900">Telegram Notifikasi Aktif</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500">Kirim laporan harian + alert ke Telegram</p>
                      </div>
                      <button
                        onClick={() => setBillingForm(f => ({ ...f, openai_billing_telegram_enabled: f.openai_billing_telegram_enabled === 'true' ? 'false' : 'true' }))}
                        className={`relative w-12 h-6 rounded-full transition-colors ${billingForm.openai_billing_telegram_enabled === 'true' ? 'bg-blue-500' : 'bg-slate-600'}`}>
                        <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${billingForm.openai_billing_telegram_enabled === 'true' ? 'translate-x-6' : 'translate-x-0.5'}`} />
                      </button>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-slate-300 dark:text-slate-600 block mb-1.5">Bot Token</label>
                      <input type="password"
                        value={billingForm.openai_billing_telegram_token}
                        onChange={e => setBillingForm(f => ({ ...f, openai_billing_telegram_token: e.target.value }))}
                        placeholder={billingConfig?.telegram_token ? '•••••• (tersimpan)' : 'Masukkan token dari @BotFather'}
                        className="w-full bg-slate-950 dark:bg-slate-50 border border-slate-700 dark:border-slate-300 rounded-xl py-2.5 px-4 text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500 placeholder-slate-500" />
                    </div>

                    <div>
                      <label className="text-sm font-medium text-slate-300 dark:text-slate-600 block mb-1.5">Chat ID</label>
                      <input type="text"
                        value={billingForm.openai_billing_telegram_chat_id}
                        onChange={e => setBillingForm(f => ({ ...f, openai_billing_telegram_chat_id: e.target.value }))}
                        placeholder={billingConfig?.telegram_chat_id || 'Contoh: -1001234567890'}
                        className="w-full bg-slate-950 dark:bg-slate-50 border border-slate-700 dark:border-slate-300 rounded-xl py-2.5 px-4 text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500 placeholder-slate-500" />
                      <p className="text-xs text-slate-500 mt-1">Dapatkan Chat ID dari @userinfobot di Telegram</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      <button onClick={handleBillingSave} disabled={billingSaving || billingLoading}
                        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors shadow-lg shadow-blue-500/20">
                        <Save className="w-4 h-4" />
                        {billingSaving ? 'Menyimpan...' : 'Simpan Konfigurasi'}
                      </button>
                      <button onClick={handleBillingTestTelegram} disabled={billingTestingTelegram || billingLoading}
                        className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors shadow-lg shadow-emerald-500/20">
                        <Send className="w-4 h-4" />
                        {billingTestingTelegram ? 'Mengirim...' : 'Test Telegram'}
                      </button>
                      <button onClick={fetchBillingConfig} disabled={billingLoading}
                        className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 dark:bg-slate-100 hover:bg-slate-700 disabled:opacity-50 text-slate-200 dark:text-slate-700 rounded-xl text-sm font-medium transition-colors">
                        <RefreshCw className={`w-4 h-4 ${billingLoading ? 'animate-spin' : ''}`} />
                        Refresh
                      </button>
                    </div>
                  </div>
                )}
              </Card>

              {/* ── 6. Info Card ────────────────────────────────────── */}
              <Card className="p-5">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-white dark:text-slate-900 mb-2">Catatan Penting</p>
                    <ul className="text-xs text-slate-400 dark:text-slate-500 space-y-1.5 list-disc list-inside">
                      <li>Biaya dihitung berdasarkan token yang digunakan, bukan saldo yang dipotong (estimasi)</li>
                      <li>Saldo DeepSeek diambil realtime dari API. Saldo OpenAI harus cek manual di dashboard</li>
                      <li>Riwayat request baru akan muncul setelah bot merespons chat customer</li>
                      <li>
                        <a href="https://platform.openai.com/usage" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">
                          Dashboard penggunaan OpenAI ↗
                        </a>
                        {' · '}
                        <a href="https://platform.deepseek.com/usage" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">
                          Dashboard penggunaan DeepSeek ↗
                        </a>
                      </li>
                    </ul>
                  </div>
                </div>
              </Card>

            </div>
          )}

          {/* ─── Tab: Mengantar ─── */}
          {activeTab === 'mengantar' && (
            <div className="space-y-6">
              {/* Config Card */}
              <div className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 p-5 rounded-2xl backdrop-blur-xl">
                <h2 className="text-lg font-bold text-white dark:text-slate-900 flex items-center gap-2 mb-5">
                  <Package className="w-5 h-5 text-emerald-400" />
                  Konfigurasi Mengantar
                </h2>

                {mengantarLoading ? (
                  <div className="flex justify-center py-8">
                    <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-4 max-w-xl">
                    {/* API Key */}
                    <div>
                      <label className="text-sm font-medium text-slate-300 dark:text-slate-600 block mb-1.5">API Key Mengantar</label>
                      <input
                        type="text"
                        value={mengantarForm.api_key}
                        onChange={e => setMengantarForm(f => ({ ...f, api_key: e.target.value }))}
                        placeholder="Masukkan API Key Mengantar"
                        className="w-full bg-slate-950 dark:bg-slate-50 border border-slate-700 dark:border-slate-300 rounded-xl py-2.5 px-4 text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500 placeholder-slate-500"
                      />
                    </div>

                    {/* Sender Name */}
                    <div>
                      <label className="text-sm font-medium text-slate-300 dark:text-slate-600 block mb-1.5">Nama Pengirim (Sender Name)</label>
                      <input
                        type="text"
                        value={mengantarForm.sender_name}
                        onChange={e => setMengantarForm(f => ({ ...f, sender_name: e.target.value }))}
                        placeholder="Contoh: Toko Berkah"
                        className="w-full bg-slate-950 dark:bg-slate-50 border border-slate-700 dark:border-slate-300 rounded-xl py-2.5 px-4 text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500 placeholder-slate-500"
                      />
                    </div>

                    {/* Sender Phone */}
                    <div>
                      <label className="text-sm font-medium text-slate-300 dark:text-slate-600 block mb-1.5">Nomor HP Pengirim</label>
                      <input
                        type="text"
                        value={mengantarForm.phone}
                        onChange={e => setMengantarForm(f => ({ ...f, phone: e.target.value }))}
                        placeholder="Contoh: 081234567890"
                        className="w-full bg-slate-950 dark:bg-slate-50 border border-slate-700 dark:border-slate-300 rounded-xl py-2.5 px-4 text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500 placeholder-slate-500"
                      />
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      <button
                        onClick={handleMengantarSave}
                        disabled={mengantarSaving || mengantarLoading}
                        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white dark:text-slate-900 rounded-xl text-sm font-medium transition-colors shadow-lg shadow-blue-500/20"
                      >
                        <Save className="w-4 h-4" />
                        {mengantarSaving ? 'Menyimpan...' : 'Simpan Konfigurasi'}
                      </button>
                      <button
                        onClick={fetchMengantarConfig}
                        disabled={mengantarLoading}
                        className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 dark:bg-slate-100 hover:bg-slate-700 disabled:opacity-50 text-slate-200 dark:text-slate-700 rounded-xl text-sm font-medium transition-colors"
                      >
                        <RefreshCw className={`w-4 h-4 ${mengantarLoading ? 'animate-spin' : ''}`} />
                        Refresh
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Info Card */}
              <div className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 p-5 rounded-2xl backdrop-blur-xl">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-white dark:text-slate-900 mb-1">Panduan Integrasi Mengantar</p>
                    <ul className="text-xs text-slate-400 dark:text-slate-500 space-y-1 list-disc list-inside">
                      <li>Dapatkan API Key di menu <strong>Integrasi Public API</strong> pada pengaturan akun Mengantar Anda.</li>
                      <li>Pastikan format nomor HP sesuai (contoh: 0812345...).</li>
                      <li>Config ini akan dipakai sistem saat membuat resi otomatis dari Bot.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default Settings;
