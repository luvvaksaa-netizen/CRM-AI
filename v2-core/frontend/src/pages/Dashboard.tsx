import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Users, TrendingUp, Target, BarChart3, MessageSquare, Brain, Calendar, ChevronDown, RefreshCw, DollarSign, AlertTriangle, CheckCircle2, XCircle, CreditCard, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';
import api from '../services/api';
import { socketService } from '../services/socket';

const StatCard = ({ title, value, icon: Icon, sub, delay }: any) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.5 }}
    className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 p-4 rounded-2xl backdrop-blur-xl hover:bg-slate-900/60 transition-all group relative overflow-hidden"
  >
    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl group-hover:bg-blue-500/10 transition-colors" />
    <div className="flex justify-between items-start relative z-10">
      <div>
        <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mb-1">{title}</p>
        <h3 className="text-2xl font-bold text-white dark:text-slate-900">{value}</h3>
        {sub && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{sub}</p>}
      </div>
      <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400 group-hover:scale-110 transition-transform">
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
  const [dateRange, setDateRange] = useState<'7d' | '30d' | 'custom'>('30d');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  // Drill-down tabs
  const [activeDrillTab, setActiveDrillTab] = useState<'leads' | 'followups' | 'learning'>('leads');
  const [drillData, setDrillData] = useState<any[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  
  // Show per-store table
  const [showPerStore, setShowPerStore] = useState(false);

  // OpenAI Billing state
  const [billingConfig, setBillingConfig] = useState<any>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingFetching, setBillingFetching] = useState(false);
  const [billingActualCosts, setBillingActualCosts] = useState<any>(null);

  // Xendit state
  const [xenditData, setXenditData] = useState<any>(null);
  const [xenditBalance, setXenditBalance] = useState<any>(null);
  const [xenditLoading, setXenditLoading] = useState(false);
  const [xenditConfig, setXenditConfig] = useState<any>(null);

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
    socketService.on('dashboardUpdate', () => fetchOverview());
    socketService.on('storeUpdated', () => fetchOverview());
    const socket = socketService.connect(); // Always returns valid connected socket
    socket?.on('storeUpdated', () => fetchOverview());
    return () => {
      socket?.off('dashboardUpdate');
      socket?.off('storeUpdated');
    };
    fetchBillingData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStore, dateRange, startDate, endDate]);

  const getDateParams = () => {
    if (dateRange === 'custom' && startDate && endDate) {
      return { startDate, endDate };
    }
    const now = new Date();
    const days = dateRange === '7d' ? 7 : 30;
    const start = new Date(now);
    start.setDate(start.getDate() - days);
    return {
      startDate: start.toISOString(),
      endDate: now.toISOString(),
    };
  };

  const fetchOverview = async () => {
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
  };

  const fetchBillingData = async () => {
    setBillingLoading(true);
    try {
      const configRes = await api.get('/openai/billing/config').catch(() => null);
      if (configRes) setBillingConfig(configRes.data);

      // Fetch actual tracked costs (v2-core specific)
      try {
        const costsRes = await api.get('/openai/billing/actual-costs?days=7');
        setBillingActualCosts(costsRes.data);
      } catch (_) {}

      // Also fetch Xendit dashboard data
      try {
        const [xenditStatsRes, xenditBalanceRes, xenditConfigRes] = await Promise.all([
          api.get('/xendit/transactions/stats?days=30').catch(() => null),
          api.get('/xendit/balance').catch(() => null),
          api.get('/xendit/config').catch(() => null),
        ]);
        if (xenditStatsRes) setXenditData(xenditStatsRes.data);
        if (xenditBalanceRes) setXenditBalance(xenditBalanceRes.data);
        if (xenditConfigRes) setXenditConfig(xenditConfigRes.data);
      } catch {}
    } catch (e) {
      console.error('Failed to fetch billing data:', e);
    } finally {
      setBillingLoading(false);
      setXenditLoading(false);
    }
  };

  const handleFetchBillingNow = async () => {
    setBillingFetching(true);
    try {
      const [costsRes, configRes] = await Promise.all([
        api.get('/openai/billing/actual-costs?days=7').catch(() => null),
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

  const fetchDrillData = async () => {
    setDrillLoading(true);
    try {
      const params: any = getDateParams();
      if (selectedStore) params.store_wa_id = selectedStore;
      
      let endpoint = '';
      if (activeDrillTab === 'leads') endpoint = '/analytics/leads';
      else if (activeDrillTab === 'followups') endpoint = '/analytics/followups';
      else endpoint = '/analytics/learning';
      
      const res = await api.get(endpoint, { params });
      setDrillData(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      console.error(e);
      setDrillData([]);
    } finally {
      setDrillLoading(false);
    }
  };

  useEffect(() => {
    fetchDrillData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDrillTab, selectedStore, dateRange, startDate, endDate]);

  const funnelData = Object.keys(stats.statusBreakdown || {}).map(key => ({
    name: key.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
    count: stats.statusBreakdown[key]
  })).sort((a: any, b: any) => b.count - a.count);

  const hasTrendData = Array.isArray(stats.trend) && stats.trend.length > 0;
  const hasFunnelData = funnelData.length > 0;

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
          <p className="text-slate-400 dark:text-slate-500 mt-1">Real-time AI performance metrics.</p>
        </div>
      </motion.div>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        {/* Date Range */}
        <div className="flex bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-xl p-1">
          {(['7d', '30d', 'custom'] as const).map(range => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                dateRange === range ? 'bg-blue-600 text-white' : 'text-slate-400 dark:text-slate-500 hover:text-slate-200'
              }`}
            >
              {range === '7d' ? '7 Hari' : range === '30d' ? '30 Hari' : 'Custom'}
            </button>
          ))}
        </div>

        {dateRange === 'custom' && (
          <div className="flex gap-2 items-center">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-xl px-3 py-1.5 text-sm text-slate-200 dark:text-slate-700"
            />
            <span className="text-slate-500">s/d</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-xl px-3 py-1.5 text-sm text-slate-200 dark:text-slate-700"
            />
          </div>
        )}

        {/* Store Filter */}
        <select
          value={selectedStore}
          onChange={(e) => setSelectedStore(e.target.value)}
          className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-xl px-3 py-1.5 text-sm text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500"
        >
          <option value="">Semua Store</option>
          {stores.map(s => (
            <option key={s.wa_id} value={s.wa_id}>{s.name || s.wa_id}</option>
          ))}
        </select>

        <button
          onClick={fetchOverview}
          className="p-1.5 text-slate-400 hover:text-white transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard title="Total Leads" value={stats.totalLeads || 0} icon={Users} delay={0.1} />
        <StatCard title="Closing Rate" value={`${stats.closingRate || 0}%`} icon={TrendingUp} delay={0.15} />
        <StatCard title="AI Reply" value={stats.aiReplyCount || 0} icon={Brain} delay={0.2} sub={`${stats.aiHandlingRate || 0}% handled`} />
        <StatCard title="CS Manual" value={stats.csManualCount || 0} icon={MessageSquare} delay={0.25} />
        <StatCard title="Closing (Sales)" value={stats.statusBreakdown?.closing || 0} icon={Target} delay={0.3} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 p-6 rounded-2xl backdrop-blur-xl flex flex-col"
        >
          <h3 className="text-lg font-bold text-white dark:text-slate-900 mb-6">Trends (30 Hari Terakhir)</h3>
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
              <EmptyChart message="Belum ada data tren" />
            )}
          </div>
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 p-6 rounded-2xl backdrop-blur-xl flex flex-col"
        >
          <h3 className="text-lg font-bold text-white dark:text-slate-900 mb-6">Customer Journey / Funnel</h3>
          <div className="flex-1 min-h-[18rem]">
            {hasFunnelData ? (
              <ResponsiveContainer width="100%" height={288}>
                <BarChart data={funnelData} layout="vertical" margin={{ top: 0, right: 10, left: 40, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                  <XAxis type="number" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} hide />
                  <YAxis dataKey="name" type="category" stroke="#e2e8f0" fontSize={11} tickLine={false} axisLine={false} width={100} />
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

      {/* OpenAI Billing Widget */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.65 }}
        className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 p-6 rounded-2xl backdrop-blur-xl"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white dark:text-slate-900 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-400" />
            OpenAI Usage
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
              <div className="bg-slate-950/40 dark:bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-400 dark:text-slate-500">Total Biaya (7hr)</p>
                <p className="text-xl font-bold text-blue-400">
                  ${billingActualCosts ? billingActualCosts.total_cost.toFixed(6) : '0.000000'}
                </p>
                <p className="text-[10px] text-emerald-400 mt-0.5">
                  ≈ Rp {(billingActualCosts?.total_cost_idr || 0).toLocaleString('id-ID')}
                </p>
              </div>
              <div className="bg-slate-950/40 dark:bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-400 dark:text-slate-500">Total Request</p>
                <p className="text-xl font-bold text-white dark:text-slate-900">
                  {billingActualCosts?.total_requests || 0}
                </p>
              </div>
              <div className="bg-slate-950/40 dark:bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-400 dark:text-slate-500">Threshold</p>
                <p className={`text-xl font-bold ${billingConfig?.daily_threshold ? 'text-amber-400' : 'text-slate-500'}`}>
                  ${(billingConfig?.daily_threshold || 0).toFixed(2)}
                </p>
              </div>
              <div className="bg-slate-950/40 dark:bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-400 dark:text-slate-500">Telegram</p>
                <p className={`text-xl font-bold flex items-center gap-1 ${billingConfig?.telegram_enabled ? 'text-blue-400' : 'text-slate-500'}`}>
                  {billingConfig?.telegram_enabled ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  {billingConfig?.telegram_enabled ? 'Aktif' : 'Nonaktif'}
                </p>
              </div>
            </div>

            {/* Actual Costs Breakdown (v2-core specific) */}
            <div className="mt-4 pt-4 border-t border-slate-800/50 dark:border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-white dark:text-slate-900 flex items-center gap-1.5">
                  <BarChart3 className="w-4 h-4 text-blue-400" />
                  Breakdown per Model & Fungsi
                </h4>
                <span className="text-[10px] text-slate-500 bg-slate-800/50 dark:bg-slate-100 px-2 py-0.5 rounded-full">
                  Hanya request v2-core
                </span>
              </div>

              {billingActualCosts && billingActualCosts.total_requests > 0 ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                    <div className="bg-slate-950/30 dark:bg-slate-50 rounded-lg p-2.5">
                      <p className="text-[10px] text-slate-400 dark:text-slate-500">Total Biaya</p>
                      <p className="text-base font-bold text-blue-400">
                        ${billingActualCosts.total_cost.toFixed(6)}
                      </p>
                    </div>
                    <div className="bg-slate-950/30 dark:bg-slate-50 rounded-lg p-2.5">
                      <p className="text-[10px] text-slate-400 dark:text-slate-500">Total Request</p>
                      <p className="text-base font-bold text-white dark:text-slate-900">
                        {billingActualCosts.total_requests}
                      </p>
                    </div>
                    <div className="bg-slate-950/30 dark:bg-slate-50 rounded-lg p-2.5">
                      <p className="text-[10px] text-slate-400 dark:text-slate-500">Total Token</p>
                      <p className="text-base font-bold text-white dark:text-slate-900">
                        {(billingActualCosts.total_tokens || 0).toLocaleString()}
                      </p>
                    </div>
                    <div className="bg-slate-950/30 dark:bg-slate-50 rounded-lg p-2.5">
                      <p className="text-[10px] text-slate-400 dark:text-slate-500">Rata-rata/Request</p>
                      <p className="text-base font-bold text-white dark:text-slate-900">
                        ${(billingActualCosts.total_cost / billingActualCosts.total_requests).toFixed(8)}
                      </p>
                    </div>
                  </div>

                  {/* By Model Breakdown */}
                  {billingActualCosts.by_model && Object.keys(billingActualCosts.by_model).length > 0 && (
                    <details className="group mb-2">
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

                  {/* By Function Breakdown */}
                  {billingActualCosts.by_function && Object.keys(billingActualCosts.by_function).length > 0 && (
                    <details className="group">
                      <summary className="text-xs text-slate-400 dark:text-slate-500 cursor-pointer hover:text-slate-200 list-none flex items-center gap-1">
                        <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" />
                        Breakdown per Fungsi
                      </summary>
                      <div className="mt-2 space-y-1">
                        {Object.entries(billingActualCosts.by_function).map(([func, data]: [string, any]) => (
                          <div key={func} className="flex items-center justify-between bg-slate-950/20 dark:bg-slate-50 rounded px-3 py-1.5">
                            <span className="text-xs text-slate-300 dark:text-slate-600">{func}</span>
                            <span className="text-xs text-slate-400">
                              {data.requests} req · {data.tokens.toLocaleString()} tokens · <span className="text-blue-400 font-medium">${data.cost.toFixed(6)}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {/* Note */}
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-3 italic">
                    * Biaya di atas adalah estimasi berdasarkan token usage tiap request v2-core.
                    Harga USD/IDR dari open.er-api.com (update setiap 1 jam).
                    Tidak termasuk request dari project OpenAI lain di organization yang sama.
                  </p>
                </>
              ) : (
                <div className="text-center py-3 text-slate-500">
                  <p className="text-xs">Belum ada data. Biaya akan tercatat otomatis saat AI merespon chat.</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-6 text-slate-500">
            <AlertTriangle className="w-8 h-8 mb-2 text-amber-400" />
            <p className="text-sm">OpenAI API Key belum dikonfigurasi</p>
            <p className="text-xs mt-1">Set OPENAI_API_KEY di .env agar tracking biaya berjalan</p>
          </div>
        )}
      </motion.div>

      {/* Xendit Payment Widget */}
      {xenditConfig?.has_api_key && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.67 }}
          className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 p-6 rounded-2xl backdrop-blur-xl"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-white dark:text-slate-900 flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-blue-400" />
              Xendit Payments
            </h3>
            <span className="text-xs text-slate-500">
              {xenditConfig?.telegram_enabled
                ? <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-blue-400" /> Notif Aktif</span>
                : <span className="flex items-center gap-1"><XCircle className="w-3 h-3 text-slate-500" /> Notif Nonaktif</span>
              }
            </span>
          </div>

          {xenditLoading ? (
            <div className="flex justify-center py-4">
              <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />
            </div>
          ) : (
            <>
              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="bg-slate-950/40 dark:bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-400 dark:text-slate-500">Saldo Xendit</p>
                  <p className="text-xl font-bold text-emerald-400">
                    {xenditBalance ? `Rp ${Number(xenditBalance.balance).toLocaleString('id-ID')}` : '—'}
                  </p>
                </div>
                <div className="bg-slate-950/40 dark:bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-400 dark:text-slate-500">Total Transaksi (30 hari)</p>
                  <p className="text-xl font-bold text-white dark:text-slate-900">
                    {xenditData?.summary?.total_transactions || 0}
                  </p>
                </div>
                <div className="bg-slate-950/40 dark:bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-400 dark:text-slate-500">Berhasil Dibayar</p>
                  <p className="text-xl font-bold text-green-400">
                    {xenditData?.summary?.total_paid || 0}
                  </p>
                </div>
                <div className="bg-slate-950/40 dark:bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-400 dark:text-slate-500">Success Rate</p>
                  <p className={`text-xl font-bold flex items-center gap-1 ${(xenditData?.summary?.success_rate || 0) >= 50 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {xenditData?.summary?.success_rate || 0}%
                    {(xenditData?.summary?.success_rate || 0) >= 50
                      ? <ArrowUpRight className="w-4 h-4" />
                      : <ArrowDownRight className="w-4 h-4" />
                    }
                  </p>
                </div>
              </div>

              {/* Mini chart */}
              {xenditData?.daily && xenditData.daily.length > 0 && (
                <div className="h-32">
                  <ResponsiveContainer width="100%" height={128}>
                    <BarChart data={xenditData.daily} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                      <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(val) => val.slice(5)} />
                      <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} width={50} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="paid" name="Paid" fill="#10b981" radius={[2, 2, 0, 0]} barSize={16} />
                      <Bar dataKey="count" name="Total" fill="#3b82f6" radius={[2, 2, 0, 0]} barSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {xenditData?.summary && (
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800/50 dark:border-slate-200">
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    💰 Total diterima: <span className="text-emerald-400 font-bold">Rp {Number(xenditData.summary.total_amount || 0).toLocaleString('id-ID')}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    ⏳ Pending: {xenditData.summary.total_pending || 0} • ❌ Expired: {xenditData.summary.total_expired || 0}
                  </p>
                </div>
              )}
            </>
          )}
        </motion.div>
      )}

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
                    <td className="py-2 px-2 text-right text-emerald-400">{row.closing}</td>
                    <td className="py-2 pl-2 text-right text-slate-300 dark:text-slate-600">{row.closingRate}%</td>
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
        <div className="flex border-b border-slate-800/50 dark:border-slate-200">
          {(['leads', 'followups', 'learning'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveDrillTab(tab)}
              className={`px-6 py-3 text-sm font-medium transition-all border-b-2 ${
                activeDrillTab === tab
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-200'
              }`}
            >
              {tab === 'leads' ? '📋 Leads' : tab === 'followups' ? '📨 Follow Ups' : '🧠 Learning'}
            </button>
          ))}
        </div>
        <div className="p-4 max-h-64 overflow-y-auto custom-scrollbar">
          {drillLoading ? (
            <div className="flex justify-center py-8">
              <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
            </div>
          ) : drillData.length > 0 ? (
            <div className="space-y-2">
              {activeDrillTab === 'leads' && drillData.map((lead: any, i: number) => (
                <div key={i} className="flex items-center justify-between bg-slate-950/50 dark:bg-slate-50 rounded-lg p-3">
                  <div>
                    <p className="text-sm text-white dark:text-slate-900 font-medium">{lead.contact_name || lead.contact_id}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">{lead.store_name} • {lead.contact_phone || lead.contact_id}</p>
                  </div>
                  <span className="text-xs text-slate-500">{new Date(lead.last_updated).toLocaleDateString('id-ID')}</span>
                </div>
              ))}
              {activeDrillTab === 'followups' && drillData.map((fu: any, i: number) => (
                <div key={i} className="flex items-center justify-between bg-slate-950/50 dark:bg-slate-50 rounded-lg p-3">
                  <div>
                    <p className="text-sm text-white dark:text-slate-900 font-medium">{fu.name}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      Pending: {fu.pending} • Sent: {fu.sent} • Replied: {fu.replied} • Total: {fu.total}
                    </p>
                  </div>
                  <span className="text-xs text-slate-500">Store: {fu.wa_id}</span>
                </div>
              ))}
              {activeDrillTab === 'learning' && drillData.map((item: any, i: number) => (
                <div key={i} className="bg-slate-950/50 dark:bg-slate-50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm text-white dark:text-slate-900 font-medium">{item.product_type || 'Generic'} • Score: {item.conversation_score}</p>
                    <span className="text-xs text-slate-500">{new Date(item.analyzed_at).toLocaleDateString('id-ID')}</span>
                  </div>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Pesan: {item.pesan_sampai_closing} • Alur Lengkap: {item.alur_lengkap ? '✅' : '❌'} • Data Lengkap: {item.data_lengkap ? '✅' : '❌'}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-slate-500">
              <Calendar className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Belum ada data untuk {activeDrillTab === 'leads' ? 'leads' : activeDrillTab === 'followups' ? 'follow up' : 'learning'}</p>
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
