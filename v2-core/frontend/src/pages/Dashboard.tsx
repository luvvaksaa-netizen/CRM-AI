import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Users, TrendingUp, Target, BarChart3, MessageSquare, Brain, Calendar, ChevronDown, RefreshCw, DollarSign, AlertTriangle, CheckCircle2, XCircle, Filter } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';
import api from '../services/api';
import { socketService } from '../services/socket';

const StatCard = ({ title, value, icon: Icon, sub, delay, color = 'blue' }: any) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.5 }}
    className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 p-4 rounded-2xl backdrop-blur-xl hover:bg-slate-900/60 transition-all group relative overflow-hidden"
  >
    <div className={`absolute top-0 right-0 w-32 h-32 bg-${color}-500/5 rounded-full blur-3xl group-hover:bg-${color}-500/10 transition-colors`} />
    <div className="flex justify-between items-start relative z-10">
      <div>
        <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mb-1">{title}</p>
        <h3 className="text-2xl font-bold text-white dark:text-slate-900">{value}</h3>
        {sub && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{sub}</p>}
      </div>
      <div className={`p-2 bg-${color}-500/10 rounded-lg text-${color}-400 group-hover:scale-110 transition-transform`}>
        <Icon className="w-5 h-5" />
      </div>
    </div>
  </motion.div>
);

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-900 dark:bg-white border border-slate-700 dark:border-slate-300 p-3 rounded-lg shadow-xl">
        <p className="text-slate-300 dark:text-slate-600 font-medium mb-2">{label}</p>
        {payload.map((entry: any, index: number) => (
          <p key={index} className="text-sm" style={{ color: entry.color }}>
            {entry.name}: <span className="font-bold">{entry.value}</span>
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const EmptyChart = ({ message }: { message: string }) => (
  <div className="flex flex-col items-center justify-center h-full text-slate-500 dark:text-slate-400">
    <BarChart3 className="w-12 h-12 mb-3 opacity-40" />
    <p className="text-sm font-medium">{message}</p>
    <p className="text-xs mt-1 opacity-60">Data akan muncul setelah ada aktivitas</p>
  </div>
);

interface Store {
  id: number;
  wa_id: string;
  name: string;
}

const Dashboard = () => {
  const [stats, setStats] = useState<any>({ 
    totalLeads: 0, closingRate: 0, aiHandlingRate: 0,
    aiReplyCount: 0, csManualCount: 0,
    trend: [], statusBreakdown: {}, perStore: []
  });
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>('');
  const [dateRange, setDateRange] = useState<'today' | '7d' | '30d' | 'custom'>('30d');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  // Drill-down tabs
  const [activeDrillTab, setActiveDrillTab] = useState<'leads' | 'closing' | 'followups' | 'learning'>('leads');
  const [drillData, setDrillData] = useState<any[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  
  // Show per-store table
  const [showPerStore, setShowPerStore] = useState(false);

  // AI Billing state
  const [billingConfig, setBillingConfig] = useState<any>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingFetching, setBillingFetching] = useState(false);
  const [billingActualCosts, setBillingActualCosts] = useState<any>(null);

  useEffect(() => {
    api.get('/stores').then(res => {
      setStores(res.data || []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetchOverview();
    fetchBillingData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStore, dateRange, startDate, endDate]);

  useEffect(() => {
    const socket = socketService.connect();
    const onUpdate = () => fetchOverview();
    socket?.on('dashboardUpdate', onUpdate);
    socket?.on('storeUpdated', onUpdate);
    return () => {
      socket?.off('dashboardUpdate', onUpdate);
      socket?.off('storeUpdated', onUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStore, dateRange, startDate, endDate]);

  const getDateParams = useCallback(() => {
    const now = new Date();
    
    if (dateRange === 'today') {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const endOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      return { startDate: startOfDay.toISOString(), endDate: endOfDay.toISOString() };
    }
    
    if (dateRange === 'custom' && startDate && endDate) {
      // Tambahkan start of day dan end of day agar inklusif penuh
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      return { startDate: start.toISOString(), endDate: end.toISOString() };
    }
    
    const days = dateRange === '7d' ? 7 : 30;
    const start = new Date(now);
    start.setDate(start.getDate() - days);
    start.setHours(0, 0, 0, 0);
    return {
      startDate: start.toISOString(),
      endDate: now.toISOString(),
    };
  }, [dateRange, startDate, endDate]);

  const fetchOverview = useCallback(async () => {
    try {
      const params: any = getDateParams();
      if (selectedStore) params.store_wa_id = selectedStore;
      const res = await api.get('/analytics/overview', { params });
      setStats(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [getDateParams, selectedStore]);

  const fetchBillingData = async () => {
    setBillingLoading(true);
    try {
      const configRes = await api.get('/openai/billing/config').catch(() => null);
      if (configRes) setBillingConfig(configRes.data);
      try {
        const costsRes = await api.get('/openai/billing/actual-costs?days=30');
        setBillingActualCosts(costsRes.data);
      } catch (_) {}
    } catch (e) {
      console.error('Failed to fetch billing data:', e);
    } finally {
      setBillingLoading(false);
    }
  };

  const handleFetchBillingNow = async () => {
    setBillingFetching(true);
    try {
      const [costsRes, configRes] = await Promise.all([
        api.get('/openai/billing/actual-costs?days=30').catch(() => null),
        api.get('/openai/billing/config').catch(() => null),
      ]);
      if (costsRes) setBillingActualCosts(costsRes.data);
      if (configRes) setBillingConfig(configRes.data);
    } catch (e) {
      console.error('Failed to refresh billing:', e);
    } finally {
      setBillingFetching(false);
    }
  };

  const fetchDrillData = useCallback(async () => {
    setDrillLoading(true);
    try {
      const params: any = getDateParams();
      if (selectedStore) params.store_wa_id = selectedStore;
      
      let endpoint = '';
      if (activeDrillTab === 'leads') {
        endpoint = '/analytics/leads';
        params.label = 'baru_masuk';
      } else if (activeDrillTab === 'closing') {
        endpoint = '/analytics/closing';
      } else if (activeDrillTab === 'followups') {
        endpoint = '/analytics/followups';
      } else {
        endpoint = '/analytics/learning';
      }
      
      const res = await api.get(endpoint, { params });
      setDrillData(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      console.error(e);
      setDrillData([]);
    } finally {
      setDrillLoading(false);
    }
  }, [activeDrillTab, selectedStore, getDateParams]);

  useEffect(() => {
    fetchDrillData();
  }, [fetchDrillData]);

  const funnelData = Object.keys(stats.statusBreakdown || {}).map(key => ({
    name: key.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
    count: stats.statusBreakdown[key]
  })).filter((d: any) => d.count > 0).sort((a: any, b: any) => b.count - a.count);

  const hasTrendData = Array.isArray(stats.trend) && stats.trend.some((d: any) => d.leads > 0 || d.closing > 0);
  const hasFunnelData = funnelData.length > 0;

  // Label untuk tampilkan range aktif
  const rangeLabelMap: Record<string, string> = {
    today: 'Hari Ini',
    '7d': '7 Hari',
    '30d': '30 Hari',
    custom: 'Custom',
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <motion.div 
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
      >
        <div>
          <h1 className="text-3xl font-bold text-white dark:text-slate-900">Dashboard Analytics</h1>
          <p className="text-slate-400 dark:text-slate-500 mt-1">Real-time AI performance metrics — <span className="text-blue-400">{rangeLabelMap[dateRange]}</span></p>
        </div>
      </motion.div>

      {/* Filter Bar */}
      <motion.div 
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="flex flex-wrap gap-3 items-center"
      >
        {/* Date Range Tabs */}
        <div className="flex bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-xl p-1 gap-0.5">
          {(['today', '7d', '30d', 'custom'] as const).map(range => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                dateRange === range 
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25' 
                  : 'text-slate-400 dark:text-slate-500 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              {range === 'today' ? '🔴 Hari Ini' : range === '7d' ? '7 Hari' : range === '30d' ? '30 Hari' : '📅 Custom'}
            </button>
          ))}
        </div>

        {/* Custom Date Pickers */}
        {dateRange === 'custom' && (
          <div className="flex gap-2 items-center bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-xl px-3 py-1.5">
            <Calendar className="w-4 h-4 text-slate-400" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-transparent text-sm text-slate-200 dark:text-slate-700 focus:outline-none"
            />
            <span className="text-slate-500 text-xs">s/d</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-transparent text-sm text-slate-200 dark:text-slate-700 focus:outline-none"
            />
          </div>
        )}

        {/* Store Filter */}
        <div className="flex items-center gap-2 bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-xl px-3 py-1.5">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={selectedStore}
            onChange={(e) => setSelectedStore(e.target.value)}
            className="bg-transparent text-sm text-slate-200 dark:text-slate-700 focus:outline-none pr-4"
          >
            <option value="">Semua Store</option>
            {stores.map(s => (
              <option key={s.wa_id} value={s.wa_id}>{s.name || s.wa_id}</option>
            ))}
          </select>
        </div>

        <button
          onClick={fetchOverview}
          className="p-1.5 text-slate-400 hover:text-white transition-colors bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-xl"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>

        {/* Custom range warning */}
        {dateRange === 'custom' && (!startDate || !endDate) && (
          <span className="text-xs text-amber-400 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Pilih tanggal mulai dan akhir
          </span>
        )}
      </motion.div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard title="Total Leads" value={stats.totalLeads || 0} icon={Users} delay={0.1} color="blue" />
        <StatCard title="Closing Rate" value={`${stats.closingRate || 0}%`} icon={TrendingUp} delay={0.15} color="emerald" />
        <StatCard title="AI Reply" value={stats.aiReplyCount || 0} icon={Brain} delay={0.2} color="purple" sub={`${stats.aiHandlingRate || 0}% handled`} />
        <StatCard title="CS Manual" value={stats.csManualCount || 0} icon={MessageSquare} delay={0.25} color="amber" />
        <StatCard title="Closing (Sales)" value={stats.statusBreakdown?.closing || 0} icon={Target} delay={0.3} color="emerald" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 p-6 rounded-2xl backdrop-blur-xl flex flex-col"
        >
          <h3 className="text-lg font-bold text-white dark:text-slate-900 mb-6">
            Trends Leads vs Closing
            <span className="ml-2 text-xs font-normal text-slate-500">({rangeLabelMap[dateRange]})</span>
          </h3>
          <div className="flex-1 min-h-[18rem]">
            {hasTrendData ? (
              <ResponsiveContainer width="100%" height={288}>
                <LineChart data={stats.trend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                  <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => val.slice(5)} />
                  <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                  <Line type="monotone" name="New Leads" dataKey="leads" stroke="#3b82f6" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
                  <Line type="monotone" name="Closing" dataKey="closing" stroke="#10b981" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Belum ada data tren untuk periode ini" />
            )}
          </div>
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 p-6 rounded-2xl backdrop-blur-xl flex flex-col"
        >
          <h3 className="text-lg font-bold text-white dark:text-slate-900 mb-6">Customer Journey / Sales Funnel</h3>
          <div className="flex-1 min-h-[18rem]">
            {hasFunnelData ? (
              <ResponsiveContainer width="100%" height={288}>
                <BarChart data={funnelData} layout="vertical" margin={{ top: 0, right: 10, left: 40, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                  <XAxis type="number" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} hide />
                  <YAxis dataKey="name" type="category" stroke="#e2e8f0" fontSize={11} tickLine={false} axisLine={false} width={110} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: '#1e293b' }} />
                  <Bar dataKey="count" name="Customers" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Belum ada data funnel" />
            )}
          </div>
        </motion.div>
      </div>

      {/* AI Billing Widget */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.65 }}
        className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 p-6 rounded-2xl backdrop-blur-xl"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white dark:text-slate-900 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-400" />
            AI Usage (DeepSeek & OpenAI)
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-400" /> Tracking Aktif</span>
            </span>
            <button
              onClick={handleFetchBillingNow}
              disabled={billingFetching}
              className="p-1.5 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${billingFetching ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {billingLoading ? (
          <div className="flex justify-center py-4">
            <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />
          </div>
        ) : billingConfig?.has_api_key ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {/* Saldo DeepSeek Realtime */}
              <div className={`bg-slate-950/40 dark:bg-slate-50 rounded-xl p-3 border ${billingActualCosts?.deepseek_balance !== null && billingActualCosts?.deepseek_balance <= 2.00 ? 'border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]' : 'border-transparent'}`}>
                <p className="text-xs text-slate-400 dark:text-slate-500 flex items-center justify-between">
                  Saldo DeepSeek
                  {billingActualCosts?.deepseek_balance !== null && billingActualCosts?.deepseek_balance <= 2.00 && (
                    <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                      <AlertTriangle className="w-3 h-3" /> LOW
                    </span>
                  )}
                </p>
                <p className={`text-xl font-bold ${billingActualCosts?.deepseek_balance !== null && billingActualCosts?.deepseek_balance <= 2.00 ? 'text-red-400' : 'text-emerald-400'}`}>
                  ${billingActualCosts?.deepseek_balance !== null && billingActualCosts?.deepseek_balance !== undefined ? billingActualCosts.deepseek_balance.toFixed(2) : '0.00'}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Pemakaian: ${billingActualCosts ? billingActualCosts.total_cost_deepseek?.toFixed(6) : '0.000000'}
                </p>
              </div>
              
              {/* OpenAI Usage (Estimasi) */}
              <div className="bg-slate-950/40 dark:bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-400 dark:text-slate-500">OpenAI Pengeluaran (30hr)</p>
                <p className="text-xl font-bold text-blue-400">
                  ${billingActualCosts ? billingActualCosts.total_cost_openai?.toFixed(6) : '0.000000'}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Total Keseluruhan: ${billingActualCosts ? billingActualCosts.total_cost?.toFixed(6) : '0.00'}
                </p>
              </div>

              <div className="bg-slate-950/40 dark:bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-400 dark:text-slate-500">Total Request</p>
                <p className="text-xl font-bold text-white dark:text-slate-900">
                  {billingActualCosts?.total_requests || 0}
                </p>
                <p className="text-[10px] text-emerald-400 mt-0.5">
                  ≈ Rp {(billingActualCosts?.total_cost_idr || 0).toLocaleString('id-ID')}
                </p>
              </div>

              <div className="bg-slate-950/40 dark:bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-400 dark:text-slate-500">Telegram Alert</p>
                <p className={`text-xl font-bold flex items-center gap-1 ${billingConfig?.telegram_enabled ? 'text-blue-400' : 'text-slate-500'}`}>
                  {billingConfig?.telegram_enabled ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  {billingConfig?.telegram_enabled ? 'Aktif' : 'Nonaktif'}
                </p>
              </div>
            </div>

            {billingActualCosts && billingActualCosts.total_requests > 0 ? (
              <div className="mt-4 pt-4 border-t border-slate-800/50 dark:border-slate-200 space-y-2">
                {billingActualCosts.by_model && Object.keys(billingActualCosts.by_model).length > 0 && (
                  <details className="group">
                    <summary className="text-xs text-slate-400 dark:text-slate-500 cursor-pointer hover:text-slate-200 list-none flex items-center gap-1">
                      <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" />
                      Breakdown per Model
                    </summary>
                    <div className="mt-2 space-y-1">
                      {Object.entries(billingActualCosts.by_model).map(([model, data]: [string, any]) => (
                        <div key={model} className="flex items-center justify-between bg-slate-950/20 dark:bg-slate-50 rounded px-3 py-1.5">
                          <span className="text-xs text-slate-300 dark:text-slate-600 font-mono">{model}</span>
                          <span className="text-xs text-slate-400">
                            {data.requests} req · {data.tokens.toLocaleString()} tokens · <span className="text-blue-400 font-medium">${data.cost.toFixed(6)}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ) : (
              <div className="text-center py-3 text-slate-500">
                <p className="text-xs">Belum ada data. Biaya akan tercatat otomatis saat AI merespon chat.</p>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-6 text-slate-500">
            <AlertTriangle className="w-8 h-8 mb-2 text-amber-400" />
            <p className="text-sm">API Key belum dikonfigurasi</p>
            <p className="text-xs mt-1">Set DEEPSEEK_API_KEY atau OPENAI_API_KEY di .env agar tracking biaya berjalan</p>
          </div>
        )}
      </motion.div>

      {/* Per-Store Breakdown */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
        className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-2xl backdrop-blur-xl overflow-hidden"
      >
        <button
          onClick={() => setShowPerStore(!showPerStore)}
          className="w-full p-4 flex items-center justify-between text-left"
        >
          <h3 className="text-lg font-bold text-white dark:text-slate-900 flex items-center gap-2">
            <StoreIcon className="w-5 h-5 text-blue-400" />
            Performa Per Store
            {stats.perStore?.length > 0 && (
              <span className="text-xs font-normal text-slate-400">({stats.perStore.length} store)</span>
            )}
          </h3>
          <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${showPerStore ? 'rotate-180' : ''}`} />
        </button>
        {showPerStore && (
          <div className="px-4 pb-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 dark:text-slate-500 border-b border-slate-800/50 dark:border-slate-200">
                  <th className="py-2 pr-4 font-medium">Store</th>
                  <th className="py-2 px-2 font-medium text-right">Leads</th>
                  <th className="py-2 px-2 font-medium text-right">Closing</th>
                  <th className="py-2 pl-2 font-medium text-right">Closing Rate</th>
                </tr>
              </thead>
              <tbody>
                {(stats.perStore || []).map((row: any, i: number) => (
                  <tr key={i} className="border-b border-slate-800/30 dark:border-slate-100">
                    <td className="py-2 pr-4 text-white dark:text-slate-900 font-medium">{row.name}</td>
                    <td className="py-2 px-2 text-right text-slate-300 dark:text-slate-600">{row.leads}</td>
                    <td className="py-2 px-2 text-right text-emerald-400 font-semibold">{row.closing}</td>
                    <td className="py-2 pl-2 text-right">
                      <span className={`text-sm font-medium ${row.closingRate >= 10 ? 'text-emerald-400' : row.closingRate >= 5 ? 'text-amber-400' : 'text-slate-400'}`}>
                        {row.closingRate}%
                      </span>
                    </td>
                  </tr>
                ))}
                {(!stats.perStore || stats.perStore.length === 0) && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-slate-500">Belum ada data per store</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      {/* Drill-Down Tabs */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
        className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-2xl backdrop-blur-xl overflow-hidden"
      >
        <div className="flex border-b border-slate-800/50 dark:border-slate-200 overflow-x-auto">
          {(['leads', 'closing', 'followups', 'learning'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveDrillTab(tab)}
              className={`px-5 py-3 text-sm font-medium transition-all border-b-2 shrink-0 ${
                activeDrillTab === tab
                  ? tab === 'closing' ? 'border-emerald-500 text-emerald-400' : 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-200'
              }`}
            >
              {tab === 'leads'
                ? `📋 Leads${activeDrillTab === 'leads' && drillData.length > 0 ? ` (${drillData.length})` : ''}`
                : tab === 'closing'
                ? `🎯 Closing${activeDrillTab === 'closing' && drillData.length > 0 ? ` (${drillData.length})` : ''}`
                : tab === 'followups' ? '📨 Follow Ups'
                : '🧠 Learning'}
            </button>
          ))}
        </div>

        {activeDrillTab === 'leads' && (
          <div className="px-4 pt-3 pb-0">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Leads = kontak yang <strong className="text-blue-400">pertama kali</strong> chat di periode ini ({rangeLabelMap[dateRange]}). Repeat customer tidak dihitung.
            </p>
          </div>
        )}
        {activeDrillTab === 'closing' && (
          <div className="px-4 pt-3 pb-0">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Closing = kontak yang mendapat label <strong className="text-emerald-400">Closing</strong> di periode ini ({rangeLabelMap[dateRange]}). Klik kontak untuk buka chat.
            </p>
          </div>
        )}

        <div className="p-4 max-h-80 overflow-y-auto custom-scrollbar">
          {drillLoading ? (
            <div className="flex justify-center py-8">
              <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
            </div>
          ) : drillData.length > 0 ? (
            <div className="space-y-2">
              {activeDrillTab === 'leads' && drillData.map((lead: any, i: number) => (
                <div key={i} className="flex items-center justify-between bg-slate-950/50 dark:bg-slate-50 rounded-xl p-3 hover:bg-slate-800/60 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-sm shrink-0">
                      {(lead.contact_name || lead.contact_phone || '?').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      {lead.contact_name && <p className="text-sm text-white dark:text-slate-900 font-medium">{lead.contact_name}</p>}
                      <p className="text-xs text-blue-400 font-mono">{lead.contact_phone || lead.contact_id}</p>
                      <p className="text-[11px] text-slate-500">{lead.store_name}</p>
                    </div>
                  </div>
                  <span className="text-xs text-slate-500 shrink-0">{new Date(lead.last_updated).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}</span>
                </div>
              ))}
              {activeDrillTab === 'closing' && drillData.map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between bg-emerald-950/20 dark:bg-emerald-50 border border-emerald-800/20 rounded-xl p-3 hover:bg-emerald-900/20 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-sm shrink-0">
                      {(item.contact_name || item.contact_phone || '?').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      {item.contact_name && <p className="text-sm text-white dark:text-slate-900 font-medium">{item.contact_name}</p>}
                      <p className="text-xs text-emerald-400 font-mono">{item.contact_phone || item.contact_id}</p>
                      <p className="text-[11px] text-slate-500">{item.store_name}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs font-bold text-emerald-400 block">✅ Closing</span>
                    <span className="text-[11px] text-slate-500">{new Date(item.closing_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' } as any)}</span>
                  </div>
                </div>
              ))}
              {activeDrillTab === 'followups' && drillData.map((fu: any, i: number) => (
                <div key={i} className="flex items-center justify-between bg-slate-950/50 dark:bg-slate-50 rounded-xl p-3">
                  <div>
                    <p className="text-sm text-white dark:text-slate-900 font-medium">{fu.name}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      <span className="text-amber-400">Pending: {fu.pending}</span> • Sent: {fu.sent} • Replied: {fu.replied} • Total: {fu.total}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-500">{fu.wa_id}</span>
                    {fu.pending > 0 && (
                      <div className="mt-1">
                        <span className="text-xs bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full">{fu.pending} pending</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {activeDrillTab === 'learning' && drillData.map((item: any, i: number) => (
                <div key={i} className="bg-slate-950/50 dark:bg-slate-50 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm text-white dark:text-slate-900 font-medium">{item.product_type || 'Generic'}</p>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${item.conversation_score >= 7 ? 'text-emerald-400' : item.conversation_score >= 5 ? 'text-amber-400' : 'text-red-400'}`}>
                        Score: {item.conversation_score}/10
                      </span>
                      <span className="text-xs text-slate-500">{new Date(item.analyzed_at).toLocaleDateString('id-ID')}</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Pesan: {item.pesan_sampai_closing} • Alur: {item.alur_lengkap ? '✅' : '❌'} • Data: {item.data_lengkap ? '✅' : '❌'} • Bayar: {item.metode_bayar || '-'}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-slate-500">
              <Calendar className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">
                {activeDrillTab === 'leads'
                  ? dateRange === 'today'
                    ? 'Belum ada leads baru hari ini'
                    : `Belum ada leads di periode ${rangeLabelMap[dateRange]}`
                  : activeDrillTab === 'closing'
                  ? `Belum ada closing di periode ${rangeLabelMap[dateRange]}`
                  : activeDrillTab === 'followups'
                  ? 'Belum ada data follow up'
                  : 'Belum ada data learning'}
              </p>
              {activeDrillTab === 'leads' && dateRange === 'today' && (
                <p className="text-xs mt-1 text-slate-600">Leads masuk ketika ada nomor WA baru yang chat pertama kali</p>
              )}
              {activeDrillTab === 'closing' && (
                <p className="text-xs mt-1 text-slate-600">Closing tercatat saat label "Closing" dipasang ke kontak</p>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

// Local StoreIcon component
const StoreIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l1.5-3.5h15L21 9" />
    <path d="M3 9v10a2 2 0 002 2h14a2 2 0 002-2V9" />
    <path d="M3 9h18" />
    <path d="M9 21V9" />
  </svg>
);

export default Dashboard;
