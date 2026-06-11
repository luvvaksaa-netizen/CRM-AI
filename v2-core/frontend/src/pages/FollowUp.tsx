import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Clock, CheckCircle2, XCircle, Search, AlertTriangle, Send, Settings, BarChart3, RefreshCw, Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { socketService } from '../services/socket';
import { format } from 'date-fns';

interface FollowUpItem {
  id: number;
  contact_id: string;
  contact_name: string;
  stage: number;
  scheduled_at: string;
  status: string;
  last_chat_context: string;
  cancel_reason?: string;
  sent_at?: string;
}
interface FollowUpStats {
  total: number;
  pending: number;
  sent: number;
  replied: number;
  cancelled: number;
}

interface StageStats {
  stageCounts: Record<number, { pending: number; sent: number; replied: number; cancelled: number }>;
  store_wa_id: string;
}

interface PipelineConfig {
  [stage: number]: {
    delay_minutes?: number;
    media_type?: string;
    media_label_hints?: string[];
    ai_instruction?: string;
    scheduled_hour?: number;
    scheduled_next_day?: boolean;
  };
}


const FollowUp = () => {
  const [activeTab, setActiveTab] = useState('pending');
  const [stores, setStores] = useState<any[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>('');
  
  const [followUps, setFollowUps] = useState<FollowUpItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Stats header
  const [stats, setStats] = useState<FollowUpStats>({ total: 0, pending: 0, sent: 0, replied: 0, cancelled: 0 });
  
  // Stage stats
  const [stageStats, setStageStats] = useState<StageStats | null>(null);
  const [showStageStats, setShowStageStats] = useState(false);
  
  // Pipeline config modal
  const [showPipelineModal, setShowPipelineModal] = useState(false);
  const [pipelineConfig, setPipelineConfig] = useState<PipelineConfig>({});
  const [savingPipeline, setSavingPipeline] = useState(false);
  
  // Manual schedule modal
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualContactId, setManualContactId] = useState('');
  const [manualContactName, setManualContactName] = useState('');
  const [manualStage, setManualStage] = useState(1);
  const [manualScheduledAt, setManualScheduledAt] = useState('');
  const [manualContext, setManualContext] = useState('');
  const [scheduling, setScheduling] = useState(false);

  useEffect(() => {
    api.get('/stores').then(res => {
      setStores(res.data);
      if (res.data.length > 0) setSelectedStore(res.data[0].wa_id);
    }).catch(() => toast.error('Gagal mengambil toko'));
  }, []);

  useEffect(() => {
    if (!selectedStore) return;
    fetchFollowUps();
    fetchStats();
    fetchStageStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStore, activeTab]);

  // Real-time socket: refresh on follow-up changes
  useEffect(() => {
    const socket = socketService.connect(); // Always returns valid connected socket
    const onFollowUpUpdated = (data: any) => {
      if (data.storeWaId === selectedStore) fetchFollowUps();
    };
    socket?.on('followUpUpdated', onFollowUpUpdated);
    return () => { socket?.off('followUpUpdated', onFollowUpUpdated); };
  }, [selectedStore]);

  const fetchFollowUps = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/followups/${selectedStore}`, {
        params: { status: activeTab, limit: 100 }
      });
      setFollowUps(res.data.data || []);
    } catch (err) {
      toast.error('Gagal mengambil data follow up');
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await api.get(`/followups/stats/${selectedStore}`);
      if (res.data) {
        setStats({
          total: (res.data.pending || 0) + (res.data.sent || 0) + (res.data.replied || 0) + (res.data.cancelled || 0),
          pending: res.data.pending || 0,
          sent: res.data.sent || 0,
          replied: res.data.replied || 0,
          cancelled: res.data.cancelled || 0,
        });
      }
    } catch {}
  };

  const fetchStageStats = async () => {
    try {
      const res = await api.get(`/followups/stage-stats/${selectedStore}`);
      setStageStats(res.data);
    } catch {}
  };

  const fetchPipelineConfig = async () => {
    try {
      const res = await api.get(`/followups/pipeline/${selectedStore}`);
      setPipelineConfig(res.data.config || {});
    } catch {
      toast.error('Gagal mengambil konfigurasi pipeline');
    }
  };

  const handleSavePipeline = async () => {
    setSavingPipeline(true);
    try {
      await api.put(`/followups/pipeline/${selectedStore}`, { config: pipelineConfig });
      toast.success('Pipeline berhasil disimpan');
      setShowPipelineModal(false);
      fetchStageStats();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menyimpan pipeline');
    } finally {
      setSavingPipeline(false);
    }
  };

  const handleForceSend = async (id: number) => {
    if (!confirm('Kirim follow-up ini sekarang?')) return;
    try {
      await api.post(`/followups/force-send/${id}`);
      toast.success('Follow-up dijadwalkan segera');
      fetchFollowUps();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal force send');
    }
  };

  const handleManualSchedule = async () => {
    if (!manualContactId.trim()) {
      toast.error('Contact ID wajib diisi');
      return;
    }
    setScheduling(true);
    try {
      await api.post('/followups/schedule', {
        store_wa_id: selectedStore,
        contact_id: manualContactId.trim(),
        contact_name: manualContactName.trim() || manualContactId.trim(),
        stage: manualStage,
        scheduled_at: manualScheduledAt || undefined,
        last_chat_context: manualContext.trim(),
      });
      toast.success('Follow-up manual berhasil dijadwalkan');
      setShowManualModal(false);
      resetManualForm();
      fetchFollowUps();
      fetchStats();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menjadwalkan');
    } finally {
      setScheduling(false);
    }
  };

  const resetManualForm = () => {
    setManualContactId('');
    setManualContactName('');
    setManualStage(1);
    setManualScheduledAt('');
    setManualContext('');
  };

  const openPipelineModal = () => {
    fetchPipelineConfig();
    setShowPipelineModal(true);
  };

  const handleCancel = async (id: number) => {
    if (!confirm('Yakin ingin membatalkan follow up ini?')) return;
    try {
      await api.post(`/followups/cancel/${id}`);
      toast.success('Follow up dibatalkan');
      fetchFollowUps();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Gagal membatalkan');
    }
  };

  const emergencyCancelAll = async () => {
    if (!confirm('AWAS! Yakin batalkan SEMUA pending follow up secara darurat?')) return;
    try {
      await api.post(`/followups/emergency-cancel-all`);
      toast.success('Semua pending follow up berhasil dihentikan');
      fetchFollowUps();
    } catch (err: any) {
      toast.error('Gagal menghentikan follow up');
    }
  };

  const filteredData = followUps.filter(f => 
    (f.contact_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (f.contact_id || '').includes(searchQuery)
  );

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
          <h1 className="text-3xl font-bold text-white dark:text-slate-900 flex items-center gap-3">
            <Clock className="w-8 h-8 text-blue-400" />
            Follow Up Engine
          </h1>
          <p className="text-slate-400 dark:text-slate-500 mt-1">Sistem pemancing interaksi otomatis (Auto Follow Up)</p>
        </motion.div>
        
        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3">
          <select 
            value={selectedStore}
            onChange={(e) => setSelectedStore(e.target.value)}
            className="bg-slate-800 dark:bg-slate-100 border border-slate-700 dark:border-slate-300 text-sm text-white dark:text-slate-900 rounded-lg px-3 py-2 outline-none focus:border-blue-500"
          >
            {stores.map(s => (
              <option key={s.wa_id} value={s.wa_id}>{s.name || s.wa_id}</option>
            ))}
          </select>

          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex bg-slate-900 dark:bg-white/80 p-1 rounded-xl border border-slate-800 dark:border-slate-200">
            {['pending', 'sent', 'replied', 'cancelled'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize ${
                  activeTab === tab ? 'bg-blue-600 text-white dark:text-slate-900 shadow-lg' : 'text-slate-400 dark:text-slate-700 hover:text-slate-200'
                }`}
              >
                {tab}
              </button>
            ))}
          </motion.div>
        </div>
      </div>

      {/* Stats Header */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: stats.total, color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
          { label: 'Pending', value: stats.pending, color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
          { label: 'Terkirim', value: stats.sent, color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
          { label: 'Dibalas', value: stats.replied, color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className={`${stat.color} border rounded-xl p-3 text-center`}
          >
            <p className="text-xs opacity-70">{stat.label}</p>
            <p className="text-xl font-bold">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Pipeline & Manual Schedule buttons */}
      <div className="flex gap-2">
        <button
          onClick={openPipelineModal}
          className="px-4 py-2 bg-slate-800 dark:bg-slate-100 border border-slate-700 dark:border-slate-300 rounded-xl text-sm text-slate-300 dark:text-slate-700 hover:bg-slate-700 dark:hover:bg-slate-200 transition-colors flex items-center gap-2"
        >
          <Settings className="w-4 h-4" /> Konfigurasi Pipeline
        </button>
        <button
          onClick={() => setShowStageStats(!showStageStats)}
          className="px-4 py-2 bg-slate-800 dark:bg-slate-100 border border-slate-700 dark:border-slate-300 rounded-xl text-sm text-slate-300 dark:text-slate-700 hover:bg-slate-700 dark:hover:bg-slate-200 transition-colors flex items-center gap-2"
        >
          <BarChart3 className="w-4 h-4" /> Stage Stats
        </button>
        <button
          onClick={() => setShowManualModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Jadwal Manual
        </button>
      </div>

      {/* Stage Stats Panel */}
      {showStageStats && stageStats && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="grid grid-cols-2 md:grid-cols-4 gap-3"
        >
          {[1, 2, 3, 4].map(stage => {
            const s = stageStats.stageCounts[stage] || { pending: 0, sent: 0, replied: 0, cancelled: 0 };
            return (
              <div key={stage} className="bg-slate-950/50 dark:bg-slate-50 border border-slate-800/50 dark:border-slate-200 rounded-xl p-3">
                <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">Stage {stage}</p>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-orange-400">Pending</span><span className="text-slate-300 dark:text-slate-600">{s.pending}</span></div>
                  <div className="flex justify-between"><span className="text-emerald-400">Sent</span><span className="text-slate-300 dark:text-slate-600">{s.sent}</span></div>
                  <div className="flex justify-between"><span className="text-purple-400">Replied</span><span className="text-slate-300 dark:text-slate-600">{s.replied}</span></div>
                  <div className="flex justify-between"><span className="text-red-400">Cancelled</span><span className="text-slate-300 dark:text-slate-600">{s.cancelled}</span></div>
                </div>
              </div>
            );
          })}
        </motion.div>
      )}

      <div className="flex-1 bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-2xl p-6 backdrop-blur-xl relative overflow-hidden flex flex-col">
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full blur-[100px] pointer-events-none" />
        
        <div className="flex gap-4 mb-6 relative z-10">
          <div className="flex-1 relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-400 group-focus-within:text-blue-400 transition-colors" />
            <input 
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search leads..." 
              className="w-full bg-slate-950/50 dark:bg-slate-50 border border-slate-700/50 dark:border-slate-300 rounded-xl py-2.5 pl-9 pr-4 text-sm text-slate-200 dark:text-slate-700 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all"
            />
          </div>
          {activeTab === 'pending' && (
            <button 
              onClick={emergencyCancelAll}
              className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-xl text-red-400 flex items-center gap-2 transition-colors"
            >
              <AlertTriangle className="w-4 h-4" /> Stop All Pending
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar -mx-6 px-6 relative z-10">
          <div className="grid gap-3">
            {loading ? (
              <div className="flex justify-center p-10">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
            ) : filteredData.length > 0 ? (
              filteredData.map((item, i) => (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.05, 0.5) }}
                  key={item.id}
                  className="bg-slate-950/50 dark:bg-slate-50 border border-slate-800 dark:border-slate-200/80 p-4 rounded-xl flex items-center justify-between group hover:bg-slate-800/50 dark:bg-slate-100 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center font-bold text-slate-300 dark:text-slate-600 shrink-0 uppercase">
                      {(item.contact_name || 'U').charAt(0)}
                    </div>
                    <div>
                      <h4 className="font-semibold text-white dark:text-slate-900">{item.contact_name || item.contact_id}</h4>
                      <p className="text-sm text-slate-400 dark:text-slate-500 flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${item.stage === 1 ? 'bg-orange-400' : item.stage === 2 ? 'bg-red-500' : 'bg-purple-500'}`} />
                        Stage {item.stage}: {item.last_chat_context || 'Menunggu balasan'}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-6">
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                      {activeTab === 'pending' ? 'Jadwal: ' : ''} 
                      {format(new Date(item.scheduled_at), 'dd MMM yyyy, HH:mm')}
                    </span>
                    
                    {activeTab === 'pending' && (
                      <div className="flex gap-2">
                        <button 
                          onClick={() => handleForceSend(item.id)}
                          className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 flex items-center justify-center transition-colors"
                          title="Force Send Now"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleCancel(item.id)}
                          className="w-8 h-8 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 flex items-center justify-center transition-colors"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                    {activeTab === 'sent' && (
                      <div className="flex items-center text-emerald-400 gap-1 text-sm font-medium">
                        <CheckCircle2 className="w-4 h-4" /> Sent
                      </div>
                    )}
                    {activeTab === 'cancelled' && (
                      <div className="flex items-center text-red-400 gap-1 text-sm font-medium">
                        <XCircle className="w-4 h-4" /> {item.cancel_reason || 'Cancelled'}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))
            ) : (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-slate-800/50 dark:bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8 text-slate-500 dark:text-slate-400" />
                </div>
                <h3 className="text-lg font-medium text-slate-300 dark:text-slate-600">All Caught Up!</h3>
                <p className="text-slate-500 dark:text-slate-400 mt-1">Tidak ada data {activeTab} saat ini.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pipeline Configuration Modal */}
      {showPipelineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-900 dark:bg-white border border-slate-800 dark:border-slate-200 p-6 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto shadow-2xl"
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-white dark:text-slate-900">Konfigurasi 4-Stage Pipeline</h2>
              <button onClick={() => setShowPipelineModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              {[1, 2, 3, 4].map(stage => {
                const cfg = pipelineConfig[stage] || {};
                return (
                  <div key={stage} className="bg-slate-950/50 dark:bg-slate-50 border border-slate-800/50 dark:border-slate-200 rounded-xl p-4">
                    <h3 className="text-sm font-bold text-white dark:text-slate-900 mb-3">Stage {stage}</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-slate-400 dark:text-slate-500">Delay (menit)</label>
                        <input
                          type="number"
                          value={cfg.delay_minutes || ''}
                          onChange={(e) => setPipelineConfig(prev => ({
                            ...prev,
                            [stage]: { ...cfg, delay_minutes: e.target.value ? parseInt(e.target.value) : undefined }
                          }))}
                          className="w-full bg-slate-800 dark:bg-slate-100 border border-slate-700 dark:border-slate-300 rounded-lg px-3 py-1.5 text-sm text-white dark:text-slate-900 mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 dark:text-slate-500">Tipe Media</label>
                        <select
                          value={cfg.media_type || 'image'}
                          onChange={(e) => setPipelineConfig(prev => ({
                            ...prev,
                            [stage]: { ...cfg, media_type: e.target.value }
                          }))}
                          className="w-full bg-slate-800 dark:bg-slate-100 border border-slate-700 dark:border-slate-300 rounded-lg px-3 py-1.5 text-sm text-white dark:text-slate-900 mt-1"
                        >
                          <option value="image">Image</option>
                          <option value="video">Video</option>
                          <option value="mixed">Mixed</option>
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs text-slate-400 dark:text-slate-500">AI Instruction</label>
                        <input
                          type="text"
                          value={cfg.ai_instruction || ''}
                          onChange={(e) => setPipelineConfig(prev => ({
                            ...prev,
                            [stage]: { ...cfg, ai_instruction: e.target.value }
                          }))}
                          className="w-full bg-slate-800 dark:bg-slate-100 border border-slate-700 dark:border-slate-300 rounded-lg px-3 py-1.5 text-sm text-white dark:text-slate-900 mt-1"
                          placeholder="Instruksi AI untuk stage ini..."
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowPipelineModal(false)} className="px-4 py-2 text-slate-300 dark:text-slate-600">Batal</button>
              <button
                onClick={handleSavePipeline}
                disabled={savingPipeline}
                className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-xl disabled:opacity-50 flex items-center gap-2"
              >
                {savingPipeline ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Simpan Pipeline
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Manual Schedule Modal */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-900 dark:bg-white border border-slate-800 dark:border-slate-200 p-6 rounded-2xl w-full max-w-md shadow-2xl"
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-white dark:text-slate-900">Jadwal Follow Up Manual</h2>
              <button onClick={() => { setShowManualModal(false); resetManualForm(); }} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-slate-400 dark:text-slate-500">Contact ID *</label>
                <input type="text" value={manualContactId} onChange={(e) => setManualContactId(e.target.value)}
                  className="w-full bg-slate-950 dark:bg-slate-50 border border-slate-700 dark:border-slate-300 rounded-xl px-4 py-2 text-white dark:text-slate-900 mt-1"
                  placeholder="62812xxxxxx@c.us" />
              </div>
              <div>
                <label className="text-sm text-slate-400 dark:text-slate-500">Nama Kontak</label>
                <input type="text" value={manualContactName} onChange={(e) => setManualContactName(e.target.value)}
                  className="w-full bg-slate-950 dark:bg-slate-50 border border-slate-700 dark:border-slate-300 rounded-xl px-4 py-2 text-white dark:text-slate-900 mt-1"
                  placeholder="Nama Pelanggan" />
              </div>
              <div>
                <label className="text-sm text-slate-400 dark:text-slate-500">Stage (1-4)</label>
                <select value={manualStage} onChange={(e) => setManualStage(parseInt(e.target.value))}
                  className="w-full bg-slate-950 dark:bg-slate-50 border border-slate-700 dark:border-slate-300 rounded-xl px-4 py-2 text-white dark:text-slate-900 mt-1">
                  {[1, 2, 3, 4].map(s => <option key={s} value={s}>Stage {s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-400 dark:text-slate-500">Jadwal Kirim (opsional)</label>
                <input type="datetime-local" value={manualScheduledAt} onChange={(e) => setManualScheduledAt(e.target.value)}
                  className="w-full bg-slate-950 dark:bg-slate-50 border border-slate-700 dark:border-slate-300 rounded-xl px-4 py-2 text-white dark:text-slate-900 mt-1" />
              </div>
              <div>
                <label className="text-sm text-slate-400 dark:text-slate-500">Konteks Chat Terakhir</label>
                <textarea value={manualContext} onChange={(e) => setManualContext(e.target.value)}
                  className="w-full bg-slate-950 dark:bg-slate-50 border border-slate-700 dark:border-slate-300 rounded-xl px-4 py-2 text-white dark:text-slate-900 mt-1 h-20 resize-none"
                  placeholder="Konteks percakapan terakhir..." />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => { setShowManualModal(false); resetManualForm(); }} className="px-4 py-2 text-slate-300 dark:text-slate-600">Batal</button>
              <button onClick={handleManualSchedule} disabled={scheduling}
                className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-xl disabled:opacity-50 flex items-center gap-2">
                {scheduling ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Jadwalkan
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>

  );
}

export default FollowUp;
