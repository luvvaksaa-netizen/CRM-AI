import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Store as StoreIcon, Smartphone, Trash2, Plus, RefreshCw, QrCode, Bot, CheckCircle, ArrowRight, ArrowLeft, Loader2, LogOut, Wifi, WifiOff, AlertTriangle } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { socketService } from '../services/socket';

interface Agent {
  id: number;
  name: string;
  bot_name: string;
}

interface Store {
  id: number;
  wa_id: string;
  name: string;
  is_bot_active: boolean;
  BotAgent?: { id: number; name: string; bot_name?: string };
}

type AddStep = 'scan' | 'identity' | 'confirm';

const Stores = () => {
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [qrCodes, setQrCodes] = useState<Record<string, string>>({});
  const [clientStatuses, setClientStatuses] = useState<Record<string, string>>({});
  const [sessionHealth, setSessionHealth] = useState<Record<string, any>>({});
  
  const [agents, setAgents] = useState<Agent[]>([]);
  const [editingStoreId, setEditingStoreId] = useState<number | null>(null);
  const [editAgentId, setEditAgentId] = useState<number | ''>('');

  // === Multi-step QR Scan flow ===
  const [addStep, setAddStep] = useState<AddStep>('scan');
  const [tempSessionId, setTempSessionId] = useState<string | null>(null);
  const [scanQr, setScanQr] = useState<string | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scannedWaId, setScannedWaId] = useState('');
  const [scannedName, setScannedName] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);

  // Ref untuk menghindari stale closure di socket handlers
  const tempSessionRef = useRef<string | null>(null);

  const fetchAgents = async () => {
    try {
      const res = await api.get('/agents');
      setAgents(res.data);
    } catch {}
  };

  const fetchStores = async () => {
    try {
      const res = await api.get('/stores');
      setStores(res.data);
    } catch (err) {
      toast.error('Gagal mengambil data toko');
    } finally {
      setLoading(false);
    }
  };

  // Cleanup temp client
  const cancelTempClient = async (sessionId: string) => {
    if (!sessionId) return;
    try {
      await api.post('/stores/cancel-qr', { temp_session_id: sessionId });
    } catch {}
  };

  // Update ref saat tempSessionId berubah
  useEffect(() => {
    tempSessionRef.current = tempSessionId;
  }, [tempSessionId]);

  // Reset add modal state
  const resetAddModal = () => {
    setShowAddModal(false);
    setAddStep('scan');
    setTempSessionId(null);
    setScanQr(null);
    setScanLoading(false);
    setScannedWaId('');
    setScannedName('');
    setSelectedAgentId('');
    setSubmitting(false);
  };

  // Handle modal close with cleanup
  const handleCloseModal = () => {
    if (tempSessionId) {
      cancelTempClient(tempSessionId);
    }
    resetAddModal();
  };

  // Start QR scan — call backend to create temp client
  const handleStartScan = async () => {
    setScanLoading(true);
    try {
      const res = await api.post('/stores/prepare-qr');
      const sessionId = res.data.tempSessionId;
      setTempSessionId(sessionId);
      // QR will arrive via socket event — keep loading until QR received
      // scanLoading will be set to false in the socket 'qr' handler
    } catch (err: any) {
      setScanLoading(false);
      toast.error(err.response?.data?.message || 'Gagal membuat QR scan');
    }
  };

  const fetchWAStatus = async () => {
    try {
      const res = await api.get('/stores/status');
      const data = res.data;
      if (data?.statuses) {
        setClientStatuses(data.statuses);
        setSessionHealth(data.health || {});
      } else {
        setClientStatuses(data);
      }
    } catch {}
  };

  useEffect(() => {
    fetchStores();
    fetchAgents();
    fetchWAStatus();

    // Register ALL socket handlers BEFORE connecting (prevents missed QR events)
    socketService.on('qr', (data: any) => {
      // Temp QR handler: gunakan ref untuk menghindari stale closure
      if (data.isTemp && data.storeId === tempSessionRef.current) {
        setScanQr(data.qr);
        setScanLoading(false); // T3: QR diterima → loading selesai
      }
      // Update regular store QR display
      if (!data.isTemp) {
        setQrCodes(prev => ({ ...prev, [data.storeId]: data.qr }));
        setClientStatuses(prev => ({ ...prev, [data.storeId]: 'needs_scan' }));
      }
    });

    socketService.on('temp_scan_ready', (data: any) => {
      // Gunakan ref untuk mengecek session ID
      if (data.tempSessionId === tempSessionRef.current) {
        setScannedWaId(data.wa_id);
        setScannedName(data.name);
        setAddStep('identity');
        toast.success('QR berhasil discan! Identitas terdeteksi.');
      }
    });

    socketService.on('ready', (data: any) => {
      setClientStatuses(prev => ({ ...prev, [data.storeId]: 'ready' }));
      toast.success(`WhatsApp ${data.storeId} terhubung!`);
      fetchStores();
    });

    socketService.on('disconnected', (data: any) => {
      setClientStatuses(prev => ({ ...prev, [data.storeId]: 'disconnected' }));
      toast.error(`WhatsApp ${data.storeId} terputus!`);
    });

    socketService.on('statusUpdate', (data: any) => {
      setClientStatuses(prev => ({ ...prev, [data.storeId]: data.status }));
    });

    socketService.on('storeUpdated', () => {
      fetchStores();
    });

    // Now connect — all handlers are already registered
    socketService.connect();

    const statusPoll = setInterval(fetchWAStatus, 30_000);

    return () => {
      clearInterval(statusPoll);
      socketService.off('qr');
      socketService.off('temp_scan_ready');
      socketService.off('ready');
      socketService.off('disconnected');
      socketService.off('statusUpdate');
      socketService.off('storeUpdated');
    };
  }, []); // Only run once on mount — use refs for dynamic values

  // Submit — create store with temp session promotion
  const handleSubmitStore = async () => {
    if (!scannedWaId.trim()) {
      return toast.error('WhatsApp ID tidak terdeteksi');
    }
    if (!tempSessionId) {
      return toast.error('Session ID tidak ditemukan');
    }

    setSubmitting(true);
    try {
      await api.post('/stores', { 
        wa_id: scannedWaId, 
        name: scannedName || scannedWaId, 
        agent_id: selectedAgentId || null,
        temp_session_id: tempSessionId
      });
      toast.success('Perangkat berhasil ditambahkan!');
      resetAddModal();
      fetchStores();
    } catch (err: any) {
      setSubmitting(false);
      toast.error(err.response?.data?.message || 'Gagal menambah perangkat');
    }
  };

  const handleUpdateAgent = async (storeId: number) => {
    try {
      await api.put(`/stores/${storeId}`, { agent_id: editAgentId || null });
      toast.success('Agent berhasil diupdate');
      setEditingStoreId(null);
      fetchStores();
    } catch (err: any) {
      toast.error('Gagal update agent');
    }
  };

  const handleDeleteStore = async (id: number, wa_id: string) => {
    if (!confirm(`Yakin ingin menghapus toko ${wa_id}?`)) return;
    try {
      await api.delete(`/stores/${id}`);
      toast.success('Toko berhasil dihapus');
      fetchStores();
    } catch (err: any) {
      toast.error('Gagal menghapus toko');
    }
  };

  const handleLogoutStore = async (id: number, wa_id: string) => {
    if (!confirm(`Logout dari WhatsApp ${wa_id}? Store tidak akan dihapus, hanya koneksi yang diputus.`)) return;
    try {
      await api.post(`/stores/${id}/logout`);
      toast.success('Logout berhasil. Scan ulang untuk menghubungkan kembali.');
      fetchStores();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Gagal logout');
    }
  };

  const handleReconnectStore = async (id: number, _wa_id: string) => {
    try {
      await api.post(`/stores/${id}/reconnect`);
      toast.success('Reconnect berhasil. Menunggu koneksi...');
      fetchStores();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Gagal reconnect');
    }
  };

  const handleToggleBotActive = async (storeId: number, currentValue: boolean) => {
    try {
      await api.put(`/stores/${storeId}`, { is_bot_active: !currentValue });
      toast.success(`Bot ${!currentValue ? 'diaktifkan' : 'dinonaktifkan'}`);
      fetchStores();
    } catch (err: any) {
      toast.error('Gagal toggle bot');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white dark:text-slate-900 mb-1 flex items-center gap-2">
            <StoreIcon className="w-6 h-6 text-blue-500" /> WhatsApp Devices
          </h1>
          <p className="text-slate-400 dark:text-slate-500">Hubungkan dan kelola perangkat WhatsApp Anda</p>
        </div>
        <button 
          onClick={() => setShowAddModal(true)}
          className="bg-blue-600 hover:bg-blue-500 text-white dark:text-slate-900 px-4 py-2 rounded-xl flex items-center gap-2 transition-colors shadow-lg shadow-blue-600/20"
        >
          <Plus className="w-4 h-4" /> Tambah Perangkat
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          <div className="col-span-full flex justify-center py-10">
            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : stores.map(store => {
          // Status koneksi real-time dari socket. Fallback: 'unknown' bukan 'active'
// agar tidak menampilkan "Terhubung" sebelum WA benar-benar siap
const status = clientStatuses[store.wa_id] || 'unknown';
          const health = sessionHealth[store.wa_id];
          const qr = qrCodes[store.wa_id];
          const isHealthyReady = status === 'ready' || status === 'active';
          const isDegraded = status === 'degraded';
          const isReconnecting = status === 'reconnecting';

          return (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              key={store.id} 
              className="bg-slate-900/50 dark:bg-white border border-slate-800 dark:border-slate-200 backdrop-blur-xl p-6 rounded-2xl relative overflow-hidden"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border ${isHealthyReady ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : isDegraded ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : isReconnecting ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' : 'bg-slate-800 dark:bg-slate-100 text-slate-400 dark:text-slate-500 border-slate-700 dark:border-slate-300'}`}>
                    <Smartphone className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white dark:text-slate-900">{store.name || store.wa_id}</h3>
                    <p className="text-sm text-slate-400 dark:text-slate-500">{store.wa_id}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {(isHealthyReady || isDegraded) && (
                    <button 
                      onClick={() => handleLogoutStore(store.id, store.wa_id)}
                      className="text-slate-500 dark:text-slate-400 hover:text-orange-400 transition-colors p-2"
                      title="Logout WA"
                    >
                      <LogOut className="w-4 h-4" />
                    </button>
                  )}
                  {(status === 'disconnected' || isDegraded || isReconnecting) && (
                    <button 
                      onClick={() => handleReconnectStore(store.id, store.wa_id)}
                      className="text-slate-500 dark:text-slate-400 hover:text-blue-400 transition-colors p-2"
                      title={isDegraded ? 'Reconnect — sesi bermasalah' : 'Reconnect WA'}
                    >
                      <Wifi className="w-4 h-4" />
                    </button>
                  )}
                  <button 
                    onClick={() => handleDeleteStore(store.id, store.wa_id)}
                    className="text-slate-500 dark:text-slate-400 hover:text-red-400 transition-colors p-2"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Agent Assignment */}
              <div className="mb-4 px-1">
                {editingStoreId === store.id ? (
                  <div className="flex items-center gap-2">
                    <select
                      value={editAgentId}
                      onChange={(e) => setEditAgentId(e.target.value ? Number(e.target.value) : '')}
                      className="flex-1 bg-slate-800 dark:bg-slate-100 border border-slate-700 dark:border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500"
                    >
                      <option value="">-- Pilih Agent --</option>
                      {agents.map(agent => (
                        <option key={agent.id} value={agent.id}>{agent.name}</option>
                      ))}
                    </select>
                    <button onClick={() => handleUpdateAgent(store.id)} className="p-1.5 text-emerald-400 hover:text-emerald-300 transition-colors" title="Simpan">
                      <CheckCircle className="w-4 h-4" />
                    </button>
                    <button onClick={() => setEditingStoreId(null)} className="p-1.5 text-slate-400 hover:text-slate-300 transition-colors" title="Batal">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={() => { setEditingStoreId(store.id); setEditAgentId(store.BotAgent?.id || ''); }}
                    className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500 hover:text-blue-400 transition-colors"
                  >
                    <Bot className="w-3.5 h-3.5" />
                    {store.BotAgent?.name ? (
                      <span>Agent: <span className="text-slate-300 dark:text-slate-600 font-medium">{store.BotAgent.name}</span></span>
                    ) : (
                      <span>Assign AI Agent...</span>
                    )}
                  </button>
                )}
              </div>

              {/* Bot Active Toggle */}
              <div className="mt-3 mb-1 flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <Bot className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-xs text-slate-400 dark:text-slate-500">Bot Aktif</span>
                </div>
                <button
                  onClick={() => handleToggleBotActive(store.id, store.is_bot_active)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    store.is_bot_active ? 'bg-emerald-500' : 'bg-slate-600'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    store.is_bot_active ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              <div className="bg-slate-950/50 dark:bg-slate-50 rounded-xl p-4 flex flex-col items-center justify-center min-h-[200px] border border-slate-800/50 dark:border-slate-200">
                {status === 'initializing' ? (
                  <div className="flex flex-col items-center text-slate-400 dark:text-slate-500">
                    <RefreshCw className="w-8 h-8 animate-spin mb-3 text-blue-500" />
                    <p className="text-sm">Menyiapkan Client...</p>
                  </div>
                ) : status === 'needs_scan' && qr ? (
                  <div className="flex flex-col items-center bg-white p-3 rounded-xl shadow-xl">
                    <QRCodeSVG value={qr} size={150} level="M" />
                    <p className="text-xs text-center mt-3 text-slate-600 font-medium bg-slate-100 py-1 px-3 rounded-full w-full">Scan QR Code ini</p>
                  </div>
                ) : status === 'disconnected' ? (
                  <div className="flex flex-col items-center text-orange-400">
                    <div className="w-16 h-16 bg-orange-500/20 rounded-full flex items-center justify-center mb-3">
                      <WifiOff className="w-8 h-8" />
                    </div>
                    <p className="font-medium">Perangkat Terputus</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Klik ikon WiFi untuk reconnect</p>
                  </div>
                ) : status === 'authenticating' ? (
                  <div className="flex flex-col items-center text-blue-400">
                    <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mb-3">
                      <RefreshCw className="w-8 h-8 animate-spin" />
                    </div>
                    <p className="font-medium">Terautentikasi</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Sedang menghubungkan ke server...</p>
                  </div>
                ) : isDegraded ? (
                  <div className="flex flex-col items-center text-amber-400">
                    <div className="w-16 h-16 bg-amber-500/20 rounded-full flex items-center justify-center mb-3">
                      <AlertTriangle className="w-8 h-8" />
                    </div>
                    <p className="font-medium">Sesi Bermasalah</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 text-center px-2">
                      {health?.lastFailureReason || 'Pesan mungkin tidak tersinkron. Klik WiFi untuk reconnect.'}
                    </p>
                  </div>
                ) : isReconnecting ? (
                  <div className="flex flex-col items-center text-blue-400">
                    <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mb-3">
                      <RefreshCw className="w-8 h-8 animate-spin" />
                    </div>
                    <p className="font-medium">Reconnecting...</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Auto-recovery sedang berjalan</p>
                  </div>
                ) : status === 'ready' || status === 'active' ? (
                  <div className="flex flex-col items-center text-emerald-400">
                    <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mb-3">
                      <StoreIcon className="w-8 h-8" />
                    </div>
                    <p className="font-medium">Perangkat Terhubung</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Bot: {store.BotAgent?.name || 'Tidak ada AI'}</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-slate-500 dark:text-slate-400">
                    <QrCode className="w-12 h-12 mb-3 opacity-50" />
                    <p className="text-sm text-center">Status: {status}<br/>Tunggu sejenak...</p>
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* ======== MULTI-STEP ADD DEVICE MODAL (QR Scan Flow) ======== */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 dark:bg-white border border-slate-800 dark:border-slate-200 p-6 rounded-2xl w-full max-w-md shadow-2xl"
            >
              {/* Step Indicator */}
              <div className="flex items-center gap-2 mb-6">
                {(['scan', 'identity', 'confirm'] as AddStep[]).map((step, i) => (
                  <React.Fragment key={step}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                      addStep === step 
                        ? 'bg-blue-600 text-white' 
                        : i < ['scan', 'identity', 'confirm'].indexOf(addStep)
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-slate-800 dark:bg-slate-200 text-slate-500'
                    }`}>
                      {i < ['scan', 'identity', 'confirm'].indexOf(addStep) ? (
                        <CheckCircle className="w-4 h-4" />
                      ) : (
                        i + 1
                      )}
                    </div>
                    {i < 2 && <div className={`flex-1 h-0.5 rounded ${i < ['scan', 'identity', 'confirm'].indexOf(addStep) ? 'bg-emerald-500' : 'bg-slate-700 dark:bg-slate-300'}`} />}
                  </React.Fragment>
                ))}
              </div>

              {/* Step 1: Scan QR */}
              {addStep === 'scan' && (
                <div className="space-y-4">
                  <h2 className="text-xl font-bold text-white dark:text-slate-900">Scan QR WhatsApp</h2>
                  <p className="text-sm text-slate-400 dark:text-slate-500">
                    Buka WhatsApp di HP Anda, lalu scan QR code di bawah ini untuk mendeteksi identitas perangkat.
                  </p>

                  <div className="bg-white rounded-xl p-4 flex flex-col items-center min-h-[260px] justify-center border border-slate-200">
                    {scanLoading ? (
                      <div className="flex flex-col items-center gap-3 text-slate-500">
                        <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
                        <p className="text-sm">Membuat QR code...</p>
                      </div>
                    ) : scanQr ? (
                      <div className="flex flex-col items-center gap-3">
                        <QRCodeSVG value={scanQr} size={200} level="M" />
                        <p className="text-xs text-slate-500 font-medium bg-slate-100 py-1.5 px-4 rounded-full">
                          Scan dengan WhatsApp di HP Anda
                        </p>
                      </div>
                    ) : (
                      <button
                        onClick={handleStartScan}
                        disabled={scanLoading}
                        className="flex flex-col items-center gap-3 py-6 px-8 rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition-colors shadow-lg shadow-blue-600/20"
                      >
                        <QrCode className="w-12 h-12" />
                        <span className="font-semibold">Mulai Scan</span>
                        <span className="text-xs text-blue-200">Klik untuk menampilkan QR code</span>
                      </button>
                    )}
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <button 
                      type="button" 
                      onClick={handleCloseModal}
                      className="px-4 py-2 text-slate-300 dark:text-slate-600 hover:text-white dark:text-slate-900 transition-colors"
                    >
                      Batal
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Identity Confirmation (auto-filled from scan) */}
              {addStep === 'identity' && (
                <div className="space-y-4">
                  <h2 className="text-xl font-bold text-white dark:text-slate-900 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-emerald-400" /> Identitas Terdeteksi
                  </h2>
                  <p className="text-sm text-slate-400 dark:text-slate-500">
                    WhatsApp berhasil discan. Pilih AI Agent untuk perangkat ini.
                  </p>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 dark:text-slate-600 mb-1">Nomor WhatsApp</label>
                      <input 
                        type="text" 
                        value={scannedWaId}
                        readOnly
                        className="w-full bg-slate-950 border border-emerald-500/30 rounded-xl px-4 py-2 text-emerald-400 font-mono focus:outline-none cursor-default"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 dark:text-slate-600 mb-1">Nama WhatsApp</label>
                      <input 
                        type="text" 
                        value={scannedName}
                        onChange={(e) => setScannedName(e.target.value)}
                        placeholder="Nama perangkat"
                        className="w-full bg-slate-950 border border-slate-700 dark:border-slate-300 rounded-xl px-4 py-2 text-white dark:text-slate-900 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 dark:text-slate-600 mb-1">
                        AI Agent <span className="text-xs text-slate-500">(opsional)</span>
                      </label>
                      <select
                        value={selectedAgentId}
                        onChange={(e) => setSelectedAgentId(e.target.value ? Number(e.target.value) : '')}
                        className="w-full bg-slate-950 border border-slate-700 dark:border-slate-300 rounded-xl px-4 py-2 text-white dark:text-slate-900 focus:outline-none focus:border-blue-500"
                      >
                        <option value="">-- Pilih Agent --</option>
                        {agents.map(agent => (
                          <option key={agent.id} value={agent.id}>{agent.name} ({agent.bot_name})</option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Agent ini akan menangani chat dari perangkat ini</p>
                    </div>
                  </div>

                  <div className="flex justify-between pt-2">
                    <button 
                      type="button" 
                      onClick={() => setAddStep('scan')}
                      className="px-4 py-2 text-slate-300 dark:text-slate-600 hover:text-white dark:text-slate-900 transition-colors flex items-center gap-1"
                    >
                      <ArrowLeft className="w-4 h-4" /> Kembali
                    </button>
                    <button 
                      type="button"
                      onClick={() => setAddStep('confirm')}
                      className="bg-blue-600 hover:bg-blue-500 text-white dark:text-slate-900 px-6 py-2 rounded-xl shadow-lg shadow-blue-500/20 transition-all flex items-center gap-1"
                    >
                      Lanjutkan <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: Confirm & Submit */}
              {addStep === 'confirm' && (
                <div className="space-y-4">
                  <h2 className="text-xl font-bold text-white dark:text-slate-900">Konfirmasi Perangkat</h2>
                  <p className="text-sm text-slate-400 dark:text-slate-500">
                    Periksa kembali data perangkat sebelum disimpan.
                  </p>

                  <div className="bg-slate-950/50 dark:bg-slate-50 rounded-xl p-4 space-y-3 border border-slate-800/50 dark:border-slate-200">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400 dark:text-slate-500">Nomor WA</span>
                      <span className="text-emerald-400 font-mono font-medium">{scannedWaId}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400 dark:text-slate-500">Nama</span>
                      <span className="text-white dark:text-slate-900 font-medium">{scannedName || scannedWaId}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400 dark:text-slate-500">AI Agent</span>
                      <span className="text-white dark:text-slate-900 font-medium">
                        {selectedAgentId ? agents.find(a => a.id === selectedAgentId)?.name || '—' : 'Tidak ada'}
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-between pt-2">
                    <button 
                      type="button" 
                      onClick={() => setAddStep('identity')}
                      className="px-4 py-2 text-slate-300 dark:text-slate-600 hover:text-white dark:text-slate-900 transition-colors flex items-center gap-1"
                    >
                      <ArrowLeft className="w-4 h-4" /> Kembali
                    </button>
                    <button 
                      type="button"
                      onClick={handleSubmitStore}
                      disabled={submitting}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 rounded-xl shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" /> Menyimpan...
                        </>
                      ) : (
                        <>
                          <CheckCircle className="w-4 h-4" /> Simpan Perangkat
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Stores;
