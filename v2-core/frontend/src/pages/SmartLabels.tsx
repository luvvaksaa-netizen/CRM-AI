import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Edit2, Tag, Palette, AlertTriangle, RefreshCw, X, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { getWaLabels, getColorPalette, createLabel, editLabel, deleteLabel } from '../services/labelApi';
import type { WALabel, ColorPaletteEntry } from '../services/labelApi';
import { socketService } from '../services/socket';

const DEFAULT_PALETTE: ColorPaletteEntry[] = [
  { color: 0, colorIndex: 0, hexColor: '#FF002A' },
  { color: 1, colorIndex: 1, hexColor: '#00D13E' },
  { color: 2, colorIndex: 2, hexColor: '#00A9FF' },
  { color: 3, colorIndex: 3, hexColor: '#FF7A00' },
  { color: 4, colorIndex: 4, hexColor: '#A5A5A5' },
  { color: 5, colorIndex: 5, hexColor: '#7000FF' },
  { color: 6, colorIndex: 6, hexColor: '#FF7A00' },
  { color: 7, colorIndex: 7, hexColor: '#FFD500' },
  { color: 8, colorIndex: 8, hexColor: '#00D1A0' },
  { color: 9, colorIndex: 9, hexColor: '#FF9E9E' },
  { color: 10, colorIndex: 10, hexColor: '#9EFA9E' },
  { color: 11, colorIndex: 11, hexColor: '#FFB3B3' },
  { color: 12, colorIndex: 12, hexColor: '#00CCFF' },
  { color: 13, colorIndex: 13, hexColor: '#FFD1A0' },
  { color: 14, colorIndex: 14, hexColor: '#FF9EFF' },
  { color: 15, colorIndex: 15, hexColor: '#B3E5FF' },
  { color: 16, colorIndex: 16, hexColor: '#FFFFB3' },
  { color: 17, colorIndex: 17, hexColor: '#B3FFCC' },
  { color: 18, colorIndex: 18, hexColor: '#E5CCFF' },
  { color: 19, colorIndex: 19, hexColor: '#FFE5CC' },
];

const IMMUTABLE_LABELS = ['Closing', 'Cancel'];

interface Store {
  id: number;
  wa_id: string;
  name: string;
}

export default function SmartLabels() {
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>('');
  const [labels, setLabels] = useState<WALabel[]>([]);
  const [palette, setPalette] = useState<ColorPaletteEntry[]>(DEFAULT_PALETTE);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editingLabel, setEditingLabel] = useState<WALabel | null>(null);
  const [deletingLabel, setDeletingLabel] = useState<WALabel | null>(null);
  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get('/stores').then(res => {
      const list = res.data?.stores || res.data || [];
      setStores(Array.isArray(list) ? list : []);
      if (list.length > 0 && !selectedStore) {
        setSelectedStore(list[0].wa_id);
      }
    }).catch(() => {});
  }, []);

  const fetchLabels = useCallback(async () => {
    if (!selectedStore) return;
    setLoading(true);
    try {
      const [labelList, paletteList] = await Promise.all([
        getWaLabels(selectedStore),
        getColorPalette(selectedStore).catch(() => []),
      ]);
      setLabels(labelList);
      if (paletteList.length > 0) setPalette(paletteList);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Gagal memuat label');
    } finally {
      setLoading(false);
    }
  }, [selectedStore]);

  useEffect(() => { fetchLabels(); }, [fetchLabels]);

  useEffect(() => {
    const socket = socketService.connect(); // Always returns valid connected socket
    if (!socket) return;
    const refresh = () => fetchLabels();
    socket.on('waLabelCreated', refresh);
    socket.on('waLabelUpdated', refresh);
    socket.on('waLabelDeleted', refresh);
    return () => {
      socket.off('waLabelCreated', refresh);
      socket.off('waLabelUpdated', refresh);
      socket.off('waLabelDeleted', refresh);
    };
  }, [fetchLabels]);

  const handleCreate = async () => {
    if (!formName.trim()) return;
    setSubmitting(true);
    try {
      await createLabel(selectedStore, formName.trim(), formColor);
      toast.success('Label dibuat di WhatsApp');
      setShowCreate(false);
      setFormName('');
      setFormColor(0);
      fetchLabels();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Gagal membuat label');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async () => {
    if (!editingLabel || !formName.trim()) return;
    setSubmitting(true);
    try {
      await editLabel(selectedStore, editingLabel.id, { name: formName.trim(), color: formColor });
      toast.success('Label diperbarui');
      setEditingLabel(null);
      fetchLabels();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Gagal mengedit label');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingLabel) return;
    setSubmitting(true);
    try {
      await deleteLabel(selectedStore, deletingLabel.id);
      toast.success('Label dihapus');
      setDeletingLabel(null);
      fetchLabels();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Gagal menghapus label');
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (label: WALabel) => {
    setEditingLabel(label);
    setFormName(label.name);
    setFormColor(label.colorIndex ?? label.color ?? 0);
    setShowCreate(false);
    setDeletingLabel(null);
  };

  const openDelete = (label: WALabel) => {
    setDeletingLabel(label);
    setShowCreate(false);
    setEditingLabel(null);
  };

  const openCreate = () => {
    setShowCreate(true);
    setEditingLabel(null);
    setDeletingLabel(null);
    setFormName('');
    setFormColor(0);
  };

  const getHexColor = (label: WALabel): string => {
    if (label.hexColor) return label.hexColor;
    const idx = label.colorIndex ?? label.color ?? 0;
    const entry = palette.find(p => p.colorIndex === idx || p.color === idx);
    return entry?.hexColor || DEFAULT_PALETTE[idx % 20]?.hexColor || '#A5A5A5';
  };

  const isImmutable = (name: string) => IMMUTABLE_LABELS.includes(name);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white dark:text-slate-900 flex items-center gap-2">
            <Tag className="w-6 h-6 text-blue-400" />
            Smart Labels
          </h1>
          <p className="text-slate-400 dark:text-slate-500 mt-1">
            Kelola label WhatsApp Business. Buat, edit, hapus. Perubahan langsung sync ke WA.
          </p>
        </div>
        <button
          onClick={openCreate}
          disabled={!selectedStore}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-4 h-4" />
          Buat Label Baru
        </button>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-400 dark:text-slate-500">WA Device:</label>
        <select
          value={selectedStore}
          onChange={e => setSelectedStore(e.target.value)}
          className="bg-slate-800 dark:bg-white border border-slate-700 dark:border-slate-200 rounded-xl px-4 py-2 text-white dark:text-slate-900 text-sm"
        >
          {stores.map(s => (
            <option key={s.wa_id} value={s.wa_id}>{s.name} ({s.wa_id})</option>
          ))}
        </select>
        <button onClick={fetchLabels} disabled={loading} className="p-2 text-slate-400 hover:text-white dark:hover:text-slate-700 transition-colors">
          <RefreshCw className={loading ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : labels.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <Tag className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>Belum ada label di akun WA ini.</p>
          <p className="text-sm mt-1">Klik Buat Label Baru untuk menambahkan.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {labels.map(label => {
            const hex = getHexColor(label);
            const immutable = isImmutable(label.name);
            return (
              <motion.div
                key={label.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-slate-800/50 dark:bg-white border border-slate-700/50 dark:border-slate-200 rounded-xl p-4 hover:border-slate-600 dark:hover:border-slate-300 transition-all group"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-5 h-5 rounded-full shrink-0 ring-2 ring-slate-900/30" style={{ backgroundColor: hex }} />
                  <span className="font-medium text-white dark:text-slate-900 truncate flex-1">{label.name}</span>
                  {immutable && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded-full font-medium shrink-0">FUNNEL</span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">{label.count || 0} kontak</span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(label)} className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors" title={immutable ? 'Hanya warna yang bisa diubah' : 'Edit label'}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => openDelete(label)}
                      disabled={immutable}
                      className={immutable ? 'p-1.5 text-slate-600 cursor-not-allowed rounded-lg' : 'p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors'}
                      title={immutable ? 'Label funnel tidak bisa dihapus dari web' : 'Hapus label'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {(showCreate || editingLabel) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => { setShowCreate(false); setEditingLabel(null); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 dark:bg-white border border-slate-700 dark:border-slate-200 rounded-2xl p-6 w-full max-w-md shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-white dark:text-slate-900 flex items-center gap-2">
                  <Palette className="w-5 h-5 text-blue-400" />
                  {editingLabel ? 'Edit Label' : 'Buat Label Baru'}
                </h2>
                <button onClick={() => { setShowCreate(false); setEditingLabel(null); }} className="p-1.5 text-slate-500 hover:text-white dark:hover:text-slate-700 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="mb-4">
                <label className="block text-sm text-slate-400 dark:text-slate-500 mb-2">Nama Label</label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="Masukkan nama label..."
                  className="w-full bg-slate-800 dark:bg-slate-50 border border-slate-700 dark:border-slate-200 rounded-xl px-4 py-2.5 text-white dark:text-slate-900 placeholder-slate-600 dark:placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-colors"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && (editingLabel ? handleEdit() : handleCreate())}
                />
                {editingLabel && isImmutable(editingLabel.name) && (
                  <div className="flex items-center gap-2 mt-2 text-amber-400 text-xs">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Label funnel. Hanya warna yang bisa diubah.
                  </div>
                )}
              </div>
              <div className="mb-6">
                <label className="block text-sm text-slate-400 dark:text-slate-500 mb-3">Warna</label>
                <div className="grid grid-cols-10 gap-2">
                  {palette.map(p => {
                    const idx = p.colorIndex ?? p.color;
                    const hex = p.hexColor || DEFAULT_PALETTE[idx % 20]?.hexColor;
                    const selected = formColor === idx;
                    return (
                      <button
                        key={idx}
                        onClick={() => setFormColor(idx)}
                        className={'w-8 h-8 rounded-full transition-all hover:scale-110 ' + (selected ? 'ring-2 ring-white dark:ring-slate-900 ring-offset-2 ring-offset-slate-900 dark:ring-offset-white scale-110' : '')}
                        style={{ backgroundColor: hex }}
                        title={'Color ' + idx}
                      />
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full border border-slate-600" style={{ backgroundColor: getHexColor({ id: '', name: '', color: formColor, colorIndex: formColor, hexColor: null, count: 0 }) }} />
                  <span className="text-xs text-slate-500">Preview</span>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setShowCreate(false); setEditingLabel(null); }} className="flex-1 px-4 py-2.5 bg-slate-800 dark:bg-slate-100 text-slate-400 dark:text-slate-600 rounded-xl hover:bg-slate-700 dark:hover:bg-slate-200 transition-colors">
                  Batal
                </button>
                <button
                  onClick={editingLabel ? handleEdit : handleCreate}
                  disabled={!formName.trim() || submitting}
                  className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {submitting ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
                  {editingLabel ? 'Simpan' : 'Buat Label'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
<AnimatePresence>
        {deletingLabel && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setDeletingLabel(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 dark:bg-white border border-slate-700 dark:border-slate-200 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="text-center mb-6">
                <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
                  <AlertTriangle className="w-7 h-7 text-red-400" />
                </div>
                <h2 className="text-lg font-bold text-white dark:text-slate-900 mb-2">Hapus Label?</h2>
                <p className="text-sm text-slate-400 dark:text-slate-500">
                  Label <span className="text-white dark:text-slate-900 font-medium">{deletingLabel.name}</span> akan dihapus dari WhatsApp Business.
                  {deletingLabel.count > 0 && (
                    <span className="block mt-1 text-red-400">Label ini digunakan oleh {deletingLabel.count} kontak.</span>
                  )}
                </p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setDeletingLabel(null)} className="flex-1 px-4 py-2.5 bg-slate-800 dark:bg-slate-100 text-slate-400 dark:text-slate-600 rounded-xl hover:bg-slate-700 dark:hover:bg-slate-200 transition-colors">
                  Batal
                </button>
                <button
                  onClick={handleDelete}
                  disabled={submitting}
                  className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Hapus
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
