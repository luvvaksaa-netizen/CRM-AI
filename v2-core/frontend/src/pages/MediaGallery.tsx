import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Image as ImageIcon,
  UploadCloud,
  Trash2,
  Tag,
  Search,
  Video,
  Bot,
  X,
  Edit3,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Brain,
  Send,
  Layers,
  Info,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { socketService } from '../services/socket';

interface Agent {
  id: number;
  name: string;
  bot_name: string;
}

interface MediaItem {
  id: number;
  filename: string;
  original_name: string;
  type: 'image' | 'video';
  label: string;
  description: string;
  trigger_words: string;
  purpose: 'both' | 'knowledge_only' | 'send_only';
  agent_id: number | null;
  ai_analysis: string;
  video_transcript: string;
  analysis_status: 'pending' | 'processing' | 'done' | 'failed';
  BotAgent?: { id: number; name: string; bot_name: string } | null;
}

const PURPOSE_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  both: { label: 'Keduanya', icon: <Layers className="w-3.5 h-3.5" />, color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  knowledge_only: { label: 'Knowledge', icon: <Brain className="w-3.5 h-3.5" />, color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  send_only: { label: 'Kirim Saja', icon: <Send className="w-3.5 h-3.5" />, color: 'bg-green-500/20 text-green-300 border-green-500/30' },
};

const STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  pending: { label: 'Pending', icon: <Clock className="w-3 h-3" />, color: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
  processing: { label: 'Processing', icon: <Loader2 className="w-3 h-3 animate-spin" />, color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
  done: { label: 'Done', icon: <CheckCircle2 className="w-3 h-3" />, color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  failed: { label: 'Failed', icon: <AlertTriangle className="w-3 h-3" />, color: 'bg-red-500/20 text-red-300 border-red-500/30' },
};

const MediaGallery = () => {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<number | ''>('');

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadLabel, setUploadLabel] = useState('');
  const [uploadDesc, setUploadDesc] = useState('');
  const [uploadTriggerWords, setUploadTriggerWords] = useState('');
  const [uploadPurpose, setUploadPurpose] = useState<'both' | 'knowledge_only' | 'send_only'>('both');
  const [uploadAgentId, setUploadAgentId] = useState<number | ''>('');
  const [dragOver, setDragOver] = useState(false);

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingItem, setEditingItem] = useState<MediaItem | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editTriggerWords, setEditTriggerWords] = useState('');
  const [editPurpose, setEditPurpose] = useState<'both' | 'knowledge_only' | 'send_only'>('both');
  const [editAgentId, setEditAgentId] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<MediaItem | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const fetchAgents = async () => {
    try {
      const res = await api.get('/agents');
      setAgents(res.data);
    } catch {}
  };

  const fetchMedia = useCallback(async () => {
    try {
      const params: any = {};
      if (selectedAgentId) params.agent_id = selectedAgentId;
      const res = await api.get('/media', { params });
      setMedia(res.data);
    } catch {
      toast.error('Gagal mengambil data media');
    } finally {
      setLoading(false);
    }
  }, [selectedAgentId]);

  useEffect(() => {
    fetchAgents();
    fetchMedia();
  }, []);

  useEffect(() => {
    fetchMedia();
  }, [fetchMedia]);

  // Real-time socket: refresh on media changes
  useEffect(() => {
    const socket = socketService.connect(); // Always returns valid connected socket
    const onMediaUpdated = () => fetchMedia();
    const onAnalysisReady = () => fetchMedia();
    socket?.on('mediaUpdated', onMediaUpdated);
    socket?.on('mediaAnalysisReady', onAnalysisReady);
    return () => {
      socket?.off('mediaUpdated', onMediaUpdated);
      socket?.off('mediaAnalysisReady', onAnalysisReady);
    };
  }, [fetchMedia]);

  // --- Upload handlers ---
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      if (file.size > 50 * 1024 * 1024) {
        toast.error('File terlalu besar. Maksimal 50MB.');
        return;
      }
      setUploadFile(file);
      if (!uploadLabel) setUploadLabel(file.name.replace(/\.[^/.]+$/, ''));
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 50 * 1024 * 1024) {
        toast.error('File terlalu besar. Maksimal 50MB.');
        return;
      }
      setUploadFile(file);
      if (!uploadLabel) setUploadLabel(file.name.replace(/\.[^/.]+$/, ''));
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) {
      toast.error('Pilih file terlebih dahulu');
      return;
    }
    if (!uploadLabel.trim()) {
      toast.error('Label wajib diisi');
      return;
    }

    const formData = new FormData();
    formData.append('file', uploadFile);
    formData.append('label', uploadLabel.trim());
    formData.append('description', uploadDesc.trim());
    formData.append('trigger_words', uploadTriggerWords.trim());
    formData.append('purpose', uploadPurpose);
    if (uploadAgentId) formData.append('agent_id', String(uploadAgentId));

    setUploading(true);
    setUploadProgress(0);

    // Simulate progress
    const progressInterval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 90) return prev;
        return prev + Math.random() * 20;
      });
    }, 300);

    try {
      const res = await api.post('/media/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      clearInterval(progressInterval);
      setUploadProgress(100);
      toast.success('Media berhasil diunggah!');

      // Update local state with the new asset
      if (res.data?.asset) {
        setMedia(prev => [res.data.asset, ...prev]);
      }

      // Reset and close
      resetUploadForm();
      setShowUploadModal(false);
    } catch (err: any) {
      clearInterval(progressInterval);
      toast.error(err.response?.data?.message || 'Gagal mengunggah file');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const resetUploadForm = () => {
    setUploadFile(null);
    setUploadLabel('');
    setUploadDesc('');
    setUploadTriggerWords('');
    setUploadPurpose('both');
    setUploadAgentId('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // --- Edit handlers ---
  const openEditModal = (item: MediaItem) => {
    setEditingItem(item);
    setEditLabel(item.label || '');
    setEditDesc(item.description || '');
    setEditTriggerWords(item.trigger_words || '');
    setEditPurpose(item.purpose || 'both');
    setEditAgentId(item.agent_id || '');
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!editingItem) return;
    if (!editLabel.trim()) {
      toast.error('Label tidak boleh kosong');
      return;
    }

    setSaving(true);
    try {
      const res = await api.put(`/media/${editingItem.id}`, {
        label: editLabel.trim(),
        description: editDesc.trim(),
        trigger_words: editTriggerWords.trim(),
        purpose: editPurpose,
        agent_id: editAgentId || null,
      });

      if (res.data?.asset) {
        setMedia(prev => prev.map(m => m.id === editingItem.id ? res.data.asset : m));
      }

      toast.success('Metadata diperbarui');
      setShowEditModal(false);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Gagal menyimpan perubahan');
    } finally {
      setSaving(false);
    }
  };

  // --- Delete handlers ---
  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/media/${deleteTarget.id}`);
      setMedia(prev => prev.filter(m => m.id !== deleteTarget.id));
      toast.success('Media dihapus');
    } catch {
      toast.error('Gagal menghapus media');
    } finally {
      setDeleteTarget(null);
    }
  };

  // --- Filter ---
  const filteredMedia = media.filter(m =>
    (m.label || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (m.trigger_words || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (m.description || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getUploadUrl = (filename: string) => `http://localhost:3002/uploads/${filename}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
          <h1 className="text-3xl font-bold text-white dark:text-slate-900 flex items-center gap-3">
            <ImageIcon className="w-8 h-8 text-blue-400" />
            Media Gallery
          </h1>
          <p className="text-slate-400 dark:text-slate-500 mt-1">Kelola aset gambar dan video untuk memori AI (Computer Vision)</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
          <button
            onClick={() => setShowUploadModal(true)}
            className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl font-medium shadow-lg shadow-blue-500/20 flex items-center gap-2 transition-all active:scale-95"
          >
            <UploadCloud className="w-5 h-5" />
            Upload Media
          </button>
        </motion.div>
      </div>

      {/* Filter bar */}
      <div className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-2xl p-4 backdrop-blur-xl">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Cari nama, deskripsi, atau trigger words..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950/50 dark:bg-slate-50 border border-slate-700/50 dark:border-slate-300 rounded-xl py-2 pl-9 pr-4 text-sm text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500 transition-all"
            />
          </div>
          <select
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value ? Number(e.target.value) : '')}
            className="bg-slate-950/50 dark:bg-slate-50 border border-slate-700/50 dark:border-slate-300 rounded-xl px-4 py-2 text-sm text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500"
          >
            <option value="">Semua Agent</option>
            {agents.map(agent => (
              <option key={agent.id} value={agent.id}>{agent.name} ({agent.bot_name})</option>
            ))}
          </select>
        </div>
      </div>

      {/* Media Grid */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filteredMedia.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredMedia.map((item, i) => (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.05 }}
              key={item.id}
              onClick={() => openEditModal(item)}
              className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-2xl overflow-hidden group hover:border-blue-500/50 dark:hover:border-blue-400 cursor-pointer transition-all backdrop-blur-xl"
            >
              {/* Preview */}
              <div className="h-44 bg-slate-950 dark:bg-white relative overflow-hidden flex items-center justify-center">
                {item.type === 'video' ? (
                  <div className="text-slate-500 flex flex-col items-center gap-2">
                    <Video className="w-10 h-10 opacity-50" />
                    <span className="text-xs font-medium truncate max-w-[150px]">{item.original_name}</span>
                  </div>
                ) : (
                  <img
                    src={getUploadUrl(item.filename)}
                    alt={item.label}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" fill="%231e293b"><rect width="400" height="300"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23475569" font-size="14">Image</text></svg>';
                    }}
                  />
                )}

                {/* Analysis status badge (top-left) */}
                <div className={`absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${STATUS_CONFIG[item.analysis_status]?.color || STATUS_CONFIG.pending.color}`}>
                  {STATUS_CONFIG[item.analysis_status]?.icon || STATUS_CONFIG.pending.icon}
                  {STATUS_CONFIG[item.analysis_status]?.label || 'Pending'}
                </div>

                {/* Hover action buttons */}
                <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); openEditModal(item); }}
                    className="w-8 h-8 bg-blue-500/90 text-white rounded-lg flex items-center justify-center hover:bg-blue-600 shadow-lg"
                    title="Edit metadata"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(item); }}
                    className="w-8 h-8 bg-red-500/90 text-white rounded-lg flex items-center justify-center hover:bg-red-600 shadow-lg"
                    title="Hapus"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Info */}
              <div className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-white dark:text-slate-900 truncate text-sm">{item.label}</h3>
                  {/* Purpose badge */}
                  <span className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${PURPOSE_LABELS[item.purpose]?.color || PURPOSE_LABELS.both.color}`}>
                    {PURPOSE_LABELS[item.purpose]?.icon || PURPOSE_LABELS.both.icon}
                    {PURPOSE_LABELS[item.purpose]?.label || 'Keduanya'}
                  </span>
                </div>

                {item.description && (
                  <p className="text-xs text-slate-400 dark:text-slate-500 line-clamp-2">{item.description}</p>
                )}

                <div className="flex items-center gap-3 text-xs">
                  {item.BotAgent ? (
                    <div className="flex items-center gap-1 text-blue-400">
                      <Bot className="w-3 h-3" />
                      <span className="truncate">{item.BotAgent.name}</span>
                    </div>
                  ) : item.agent_id ? (
                    <div className="flex items-center gap-1 text-slate-500">
                      <Bot className="w-3 h-3" />
                      <span>Agent #{item.agent_id}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-slate-600">
                      <Bot className="w-3 h-3" />
                      <span>No agent</span>
                    </div>
                  )}

                  {item.trigger_words && (
                    <div className="flex items-center gap-1 text-yellow-400">
                      <Tag className="w-3 h-3" />
                      <span className="truncate">{item.trigger_words}</span>
                    </div>
                  )}
                </div>

                {/* AI Analysis preview */}
                {item.ai_analysis && (
                  <div className="flex items-start gap-1.5 text-[11px] text-slate-500 bg-slate-950/50 dark:bg-slate-50 rounded-lg p-2 border border-slate-800/30 dark:border-slate-200">
                    <Brain className="w-3 h-3 shrink-0 mt-0.5 text-purple-400" />
                    <span className="line-clamp-2">{item.ai_analysis}</span>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="text-center py-20 text-slate-500">
          <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-20" />
          <p className="text-lg">Tidak ada media ditemukan</p>
          <p className="text-sm mt-1">Upload media untuk memulai</p>
        </div>
      )}

      {/* ====== UPLOAD MODAL ====== */}
      <AnimatePresence>
        {showUploadModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => { if (!uploading) { resetUploadForm(); setShowUploadModal(false); } }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-slate-900 dark:bg-white border border-slate-800 dark:border-slate-200 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto z-10"
            >
              {/* Modal header */}
              <div className="flex items-center justify-between p-5 border-b border-slate-800/50 dark:border-slate-200">
                <h2 className="text-lg font-bold text-white dark:text-slate-900 flex items-center gap-2">
                  <UploadCloud className="w-5 h-5 text-blue-400" />
                  Upload Media
                </h2>
                <button
                  onClick={() => { if (!uploading) { resetUploadForm(); setShowUploadModal(false); } }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white dark:hover:text-slate-700 hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                {/* Drop zone */}
                <div
                  ref={dropZoneRef}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                    dragOver
                      ? 'border-blue-400 bg-blue-500/10'
                      : 'border-slate-700 dark:border-slate-300 hover:border-slate-500 dark:hover:border-slate-400 bg-slate-950/30 dark:bg-slate-50'
                  }`}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    className="hidden"
                    accept="image/*,video/mp4,video/webm,video/quicktime"
                  />
                  {uploadFile ? (
                    <div className="space-y-2">
                      {uploadFile.type.startsWith('image/') ? (
                        <img
                          src={URL.createObjectURL(uploadFile)}
                          alt="Preview"
                          className="max-h-32 mx-auto rounded-lg object-contain"
                        />
                      ) : (
                        <Video className="w-12 h-12 mx-auto text-blue-400" />
                      )}
                      <p className="text-sm font-medium text-blue-400">{uploadFile.name}</p>
                      <p className="text-xs text-slate-500">{(uploadFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                    </div>
                  ) : (
                    <>
                      <UploadCloud className="w-10 h-10 mx-auto text-slate-600 mb-3" />
                      <p className="text-sm font-medium text-slate-300 dark:text-slate-600">Klik atau seret file ke sini</p>
                      <p className="text-xs text-slate-500 mt-1">JPG, PNG, GIF, WebP, MP4 — Maks 50MB</p>
                    </>
                  )}
                </div>

                {/* Label */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 dark:text-slate-700 mb-1">
                    Label / Tag <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={uploadLabel}
                    onChange={(e) => setUploadLabel(e.target.value)}
                    placeholder="Contoh: Katalog Kaos Polos"
                    className="w-full bg-slate-950/50 dark:bg-slate-50 border border-slate-700/50 dark:border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500"
                  />
                </div>

                {/* Purpose selector */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 dark:text-slate-700 mb-2">
                    Tujuan Media
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['both', 'knowledge_only', 'send_only'] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setUploadPurpose(p)}
                        className={`flex flex-col items-center gap-1 p-3 rounded-xl border text-xs transition-all ${
                          uploadPurpose === p
                            ? 'border-blue-500 bg-blue-500/10 text-blue-300'
                            : 'border-slate-700/50 dark:border-slate-300 text-slate-400 dark:text-slate-500 hover:border-slate-500'
                        }`}
                      >
                        {PURPOSE_LABELS[p].icon}
                        <span className="font-medium">{PURPOSE_LABELS[p].label}</span>
                        <span className="text-[10px] opacity-70 text-center leading-tight">
                          {p === 'both' && 'AI pelajari & bisa dikirim'}
                          {p === 'knowledge_only' && 'AI pelajari saja'}
                          {p === 'send_only' && 'Hanya dikirim ke customer'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 dark:text-slate-700 mb-1">
                    Deskripsi <span className="text-slate-500">(opsional)</span>
                  </label>
                  <textarea
                    value={uploadDesc}
                    onChange={(e) => setUploadDesc(e.target.value)}
                    rows={2}
                    placeholder="Tambahan info untuk AI..."
                    className="w-full bg-slate-950/50 dark:bg-slate-50 border border-slate-700/50 dark:border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500 resize-none"
                  />
                </div>

                {/* Trigger words */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 dark:text-slate-700 mb-1">
                    Trigger Words <span className="text-slate-500">(opsional)</span>
                  </label>
                  <input
                    type="text"
                    value={uploadTriggerWords}
                    onChange={(e) => setUploadTriggerWords(e.target.value)}
                    placeholder="Contoh: kaos, baju, ukuran"
                    className="w-full bg-slate-950/50 dark:bg-slate-50 border border-slate-700/50 dark:border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500"
                  />
                </div>

                {/* Agent selector */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 dark:text-slate-700 mb-1">
                    Agent <span className="text-slate-500">(opsional)</span>
                  </label>
                  <select
                    value={uploadAgentId}
                    onChange={(e) => setUploadAgentId(e.target.value ? Number(e.target.value) : '')}
                    className="w-full bg-slate-950/50 dark:bg-slate-50 border border-slate-700/50 dark:border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Tanpa Agent</option>
                    {agents.map(agent => (
                      <option key={agent.id} value={agent.id}>{agent.name} ({agent.bot_name})</option>
                    ))}
                  </select>
                </div>

                {/* AI info hint */}
                <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-500/5 border border-blue-500/20 text-xs text-blue-300">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Gambar akan dianalisis otomatis oleh Vision AI. Video akan dianalisis oleh Whisper + Vision AI.</span>
                </div>

                {/* Upload progress */}
                {uploading && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-slate-400">
                      <span>Mengunggah...</span>
                      <span>{Math.round(uploadProgress)}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-800 dark:bg-slate-200 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-blue-500 rounded-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${uploadProgress}%` }}
                        transition={{ duration: 0.2 }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Modal footer */}
              <div className="flex justify-end gap-3 p-5 border-t border-slate-800/50 dark:border-slate-200">
                <button
                  onClick={() => { resetUploadForm(); setShowUploadModal(false); }}
                  disabled={uploading}
                  className="px-4 py-2 rounded-xl text-sm text-slate-400 hover:text-white dark:hover:text-slate-700 hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  onClick={handleUpload}
                  disabled={uploading || !uploadFile}
                  className="px-5 py-2 rounded-xl text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white flex items-center gap-2 transition-all active:scale-95"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Mengunggah...
                    </>
                  ) : (
                    <>
                      <UploadCloud className="w-4 h-4" />
                      Upload
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ====== EDIT MODAL ====== */}
      <AnimatePresence>
        {showEditModal && editingItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowEditModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-slate-900 dark:bg-white border border-slate-800 dark:border-slate-200 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto z-10"
            >
              {/* Modal header */}
              <div className="flex items-center justify-between p-5 border-b border-slate-800/50 dark:border-slate-200">
                <h2 className="text-lg font-bold text-white dark:text-slate-900 flex items-center gap-2">
                  <Edit3 className="w-5 h-5 text-blue-400" />
                  Edit Metadata
                </h2>
                <button
                  onClick={() => setShowEditModal(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white dark:hover:text-slate-700 hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                {/* Preview */}
                <div className="h-32 bg-slate-950 dark:bg-slate-100 rounded-xl overflow-hidden flex items-center justify-center">
                  {editingItem.type === 'video' ? (
                    <div className="text-slate-500 flex flex-col items-center gap-1">
                      <Video className="w-8 h-8 opacity-50" />
                      <span className="text-xs">{editingItem.original_name}</span>
                    </div>
                  ) : (
                    <img
                      src={getUploadUrl(editingItem.filename)}
                      alt={editingItem.label}
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" fill="%231e293b"><rect width="400" height="300"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23475569" font-size="14">Image</text></svg>';
                      }}
                    />
                  )}
                </div>

                {/* Label */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 dark:text-slate-700 mb-1">
                    Label / Tag <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    className="w-full bg-slate-950/50 dark:bg-slate-50 border border-slate-700/50 dark:border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500"
                  />
                </div>

                {/* Purpose selector */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 dark:text-slate-700 mb-2">
                    Tujuan Media
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['both', 'knowledge_only', 'send_only'] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setEditPurpose(p)}
                        className={`flex flex-col items-center gap-1 p-3 rounded-xl border text-xs transition-all ${
                          editPurpose === p
                            ? 'border-blue-500 bg-blue-500/10 text-blue-300'
                            : 'border-slate-700/50 dark:border-slate-300 text-slate-400 dark:text-slate-500 hover:border-slate-500'
                        }`}
                      >
                        {PURPOSE_LABELS[p].icon}
                        <span className="font-medium">{PURPOSE_LABELS[p].label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 dark:text-slate-700 mb-1">
                    Deskripsi
                  </label>
                  <textarea
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    rows={2}
                    className="w-full bg-slate-950/50 dark:bg-slate-50 border border-slate-700/50 dark:border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500 resize-none"
                  />
                </div>

                {/* Trigger words */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 dark:text-slate-700 mb-1">
                    Trigger Words
                  </label>
                  <input
                    type="text"
                    value={editTriggerWords}
                    onChange={(e) => setEditTriggerWords(e.target.value)}
                    placeholder="Contoh: kaos, baju, ukuran"
                    className="w-full bg-slate-950/50 dark:bg-slate-50 border border-slate-700/50 dark:border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500"
                  />
                </div>

                {/* Agent selector */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 dark:text-slate-700 mb-1">
                    Agent
                  </label>
                  <select
                    value={editAgentId}
                    onChange={(e) => setEditAgentId(e.target.value ? Number(e.target.value) : '')}
                    className="w-full bg-slate-950/50 dark:bg-slate-50 border border-slate-700/50 dark:border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-200 dark:text-slate-700 focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Tanpa Agent</option>
                    {agents.map(agent => (
                      <option key={agent.id} value={agent.id}>{agent.name} ({agent.bot_name})</option>
                    ))}
                  </select>
                </div>

                {/* AI Analysis info */}
                {editingItem.ai_analysis && (
                  <div className="p-3 rounded-xl bg-purple-500/5 border border-purple-500/20">
                    <p className="text-xs font-medium text-purple-300 mb-1 flex items-center gap-1">
                      <Brain className="w-3.5 h-3.5" /> AI Analysis
                    </p>
                    <p className="text-xs text-slate-400">{editingItem.ai_analysis}</p>
                  </div>
                )}
                {editingItem.video_transcript && (
                  <div className="p-3 rounded-xl bg-cyan-500/5 border border-cyan-500/20">
                    <p className="text-xs font-medium text-cyan-300 mb-1 flex items-center gap-1">
                      <FileText className="w-3.5 h-3.5" /> Video Transcript
                    </p>
                    <p className="text-xs text-slate-400 line-clamp-3">{editingItem.video_transcript}</p>
                  </div>
                )}
              </div>

              {/* Modal footer */}
              <div className="flex justify-between items-center p-5 border-t border-slate-800/50 dark:border-slate-200">
                <button
                  onClick={() => { setShowEditModal(false); setDeleteTarget(editingItem); }}
                  className="px-3 py-2 rounded-xl text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 flex items-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Hapus
                </button>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowEditModal(false)}
                    className="px-4 py-2 rounded-xl text-sm text-slate-400 hover:text-white dark:hover:text-slate-700 hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors"
                  >
                    Batal
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={saving}
                    className="px-5 py-2 rounded-xl text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white flex items-center gap-2 transition-all active:scale-95"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Menyimpan...
                      </>
                    ) : (
                      'Simpan'
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ====== DELETE CONFIRMATION MODAL ====== */}
      <AnimatePresence>
        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setDeleteTarget(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative bg-slate-900 dark:bg-white border border-slate-800 dark:border-slate-200 rounded-2xl shadow-2xl w-full max-w-sm z-10 p-6"
            >
              <div className="text-center">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6 text-red-400" />
                </div>
                <h3 className="text-lg font-bold text-white dark:text-slate-900 mb-1">Hapus Media?</h3>
                <p className="text-sm text-slate-400 dark:text-slate-500">
                  "{deleteTarget.label}" akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.
                </p>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="flex-1 px-4 py-2 rounded-xl text-sm text-slate-400 hover:text-white dark:hover:text-slate-700 hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors"
                >
                  Batal
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 px-4 py-2 rounded-xl text-sm font-medium bg-red-600 hover:bg-red-500 text-white transition-all active:scale-95"
                >
                  Hapus
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MediaGallery;
