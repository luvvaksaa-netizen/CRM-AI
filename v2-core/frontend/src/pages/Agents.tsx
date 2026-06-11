import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Plus, Edit2, Trash2, Save, X, Sparkles, Search, Cpu, Image as ImageIcon, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';

interface Agent {
  id: number;
  name: string;
  bot_name: string;
  system_prompt: string;
  product_knowledge: string;
  auto_labels: string;
  mediaCount?: number;
}

const INITIAL_FORM: Partial<Agent> = {
  name: '',
  bot_name: 'CS Bot',
  system_prompt: 'Kamu adalah customer service yang ramah, membantu, dan profesional.',
  product_knowledge: '',
  auto_labels: ''
};

const Agents = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<Agent>>(INITIAL_FORM);
  const [showCreate, setShowCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchAgents(); }, []);

  const fetchAgents = async () => {
    setLoading(true);
    try {
      const res = await api.get('/agents');
      const agentsData = res.data;
      // Fetch media count per agent
      try {
        const agentsWithMedia = await Promise.all(
          agentsData.map(async (agent: Agent) => {
            try {
              const mediaRes = await api.get(`/agents/${agent.id}/media`);
              return { ...agent, mediaCount: mediaRes.data.count || 0 };
            } catch {
              return { ...agent, mediaCount: 0 };
            }
          })
        );
        setAgents(agentsWithMedia);
      } catch {
        setAgents(agentsData);
      }
    } catch { toast.error('Gagal mengambil data agen'); }
    finally { setLoading(false); }
  };

  const handleCreate = async () => {
    if (!form.name?.trim()) return toast.error('Nama agen wajib diisi');
    setSaving(true);
    try {
      await api.post('/agents', form);
      toast.success('Agen berhasil dibuat');
      setShowCreate(false);
      setForm(INITIAL_FORM);
      fetchAgents();
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Gagal membuat agen');
    } finally { setSaving(false); }
  };

  const handleUpdate = async (id: number) => {
    setSaving(true);
    try {
      await api.put(`/agents/${id}`, form);
      toast.success('Agen berhasil diupdate');
      setEditingId(null);
      fetchAgents();
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Gagal update agen');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Yakin hapus agen "${name}"? Semua store yang terkait akan kehilangan assignee.`)) return;
    try {
      await api.delete(`/agents/${id}`);
      toast.success('Agen berhasil dihapus');
      fetchAgents();
    } catch (e: any) {
      toast.error('Gagal menghapus agen');
    }
  };

  const startEdit = (agent: Agent) => {
    setEditingId(agent.id);
    setForm({ ...agent });
    setShowCreate(false);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(INITIAL_FORM);
  };

  const filteredAgents = agents.filter(a =>
    (a.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (a.bot_name || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const FormFields = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-300 dark:text-slate-600 mb-1">Nama Agen</label>
        <input
          type="text"
          value={form.name || ''}
          onChange={e => setForm({ ...form, name: e.target.value })}
          placeholder="Contoh: Agen DTF Store"
          className="w-full bg-slate-800 dark:bg-slate-100 border border-slate-700 dark:border-slate-300 rounded-xl px-4 py-2.5 text-white dark:text-slate-900 text-sm focus:outline-none focus:border-blue-500 transition-colors"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-300 dark:text-slate-600 mb-1">Nama Bot</label>
        <input
          type="text"
          value={form.bot_name || ''}
          onChange={e => setForm({ ...form, bot_name: e.target.value })}
          placeholder="CS Bot"
          className="w-full bg-slate-800 dark:bg-slate-100 border border-slate-700 dark:border-slate-300 rounded-xl px-4 py-2.5 text-white dark:text-slate-900 text-sm focus:outline-none focus:border-blue-500 transition-colors"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-300 dark:text-slate-600 mb-1">System Prompt</label>
        <textarea
          value={form.system_prompt || ''}
          onChange={e => setForm({ ...form, system_prompt: e.target.value })}
          rows={4}
          placeholder="Instruksi dasar untuk AI..."
          className="w-full bg-slate-800 dark:bg-slate-100 border border-slate-700 dark:border-slate-300 rounded-xl px-4 py-2.5 text-white dark:text-slate-900 text-sm focus:outline-none focus:border-blue-500 transition-colors resize-none"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-300 dark:text-slate-600 mb-1">Product Knowledge</label>
        <textarea
          value={form.product_knowledge || ''}
          onChange={e => setForm({ ...form, product_knowledge: e.target.value })}
          rows={4}
          placeholder="Informasi produk yang diketahui AI..."
          className="w-full bg-slate-800 dark:bg-slate-100 border border-slate-700 dark:border-slate-300 rounded-xl px-4 py-2.5 text-white dark:text-slate-900 text-sm focus:outline-none focus:border-blue-500 transition-colors resize-none"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-300 dark:text-slate-600 mb-1">Auto Labels</label>
        <input
          type="text"
          value={form.auto_labels || ''}
          onChange={e => setForm({ ...form, auto_labels: e.target.value })}
          placeholder="Label otomatis (comma-separated)"
          className="w-full bg-slate-800 dark:bg-slate-100 border border-slate-700 dark:border-slate-300 rounded-xl px-4 py-2.5 text-white dark:text-slate-900 text-sm focus:outline-none focus:border-blue-500 transition-colors"
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white dark:text-slate-900 flex items-center gap-3">
            <Cpu className="w-8 h-8 text-purple-400" />
            AI Agents
          </h1>
          <p className="text-slate-400 dark:text-slate-500 mt-1">Kelola agen AI, personality, dan product knowledge per store.</p>
        </div>
        <button
          onClick={() => { setShowCreate(!showCreate); setEditingId(null); setForm(INITIAL_FORM); }}
          className="px-4 py-2.5 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl text-white dark:text-slate-900 font-medium flex items-center gap-2 hover:shadow-lg hover:shadow-purple-500/20 transition-all"
        >
          <Plus className="w-4 h-4" /> Buat Agen
        </button>
      </motion.div>

      <AnimatePresence>
        {(showCreate || editingId) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-slate-900/60 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-2xl p-6 backdrop-blur-xl">
              <h2 className="text-lg font-bold text-white dark:text-slate-900 mb-4">
                {editingId ? 'Edit Agen' : 'Buat Agen Baru'}
              </h2>
              <FormFields />
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => editingId ? handleUpdate(editingId) : handleCreate()}
                  disabled={saving}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-xl text-white dark:text-slate-900 font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
                >
                  {saving ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  {editingId ? 'Update' : 'Simpan'}
                </button>
                <button
                  onClick={cancelEdit}
                  className="px-6 py-2.5 bg-slate-800 dark:bg-slate-100 hover:bg-slate-700 rounded-xl text-slate-300 dark:text-slate-600 font-medium flex items-center gap-2 transition-colors"
                >
                  <X className="w-4 h-4" /> Batal
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-2xl p-6 backdrop-blur-xl">
        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Cari agen..."
              className="w-full bg-slate-950/50 dark:bg-slate-50 border border-slate-700/50 dark:border-slate-300 rounded-xl py-2.5 pl-9 pr-4 text-sm text-slate-200 dark:text-slate-700 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all"
            />
          </div>
          <span className="text-sm text-slate-400 dark:text-slate-500">{filteredAgents.length} agen</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredAgents.length > 0 ? (
          <div className="grid gap-4">
            {filteredAgents.map((agent, i) => (
              <motion.div
                key={agent.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-slate-950/50 border border-slate-800 dark:border-slate-200/80 rounded-xl p-5 hover:bg-slate-800/50 dark:bg-slate-100 transition-colors group"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
                        <Bot className="w-5 h-5 text-white dark:text-slate-900" />
                      </div>
                      <div>
                        <h3 className="font-bold text-white dark:text-slate-900">{agent.name || 'Tanpa Nama'}</h3>
                        <p className="text-sm text-slate-400 dark:text-slate-500">Bot: {agent.bot_name}</p>
                      </div>
                    </div>
                    {agent.system_prompt && (
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 line-clamp-2">{agent.system_prompt}</p>
                    )}
                    {agent.product_knowledge && (
                      <div className="mt-2 flex items-center gap-1 text-xs text-purple-400">
                        <Sparkles className="w-3 h-3" />
                        <span>Product knowledge tersedia</span>
                      </div>
                    )}
                    {agent.mediaCount !== undefined && (
                      <div className="mt-2 flex items-center gap-2">
                        <a
                          href={`/media?agent_id=${agent.id}`}
                          onClick={(e) => { e.stopPropagation(); }}
                          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          <ImageIcon className="w-3 h-3" />
                          <span>{agent.mediaCount} media</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity ml-4">
                    <button
                      onClick={() => startEdit(agent)}
                      className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 flex items-center justify-center transition-colors"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(agent.id, agent.name)}
                      className="w-8 h-8 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 flex items-center justify-center transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-slate-800/50 dark:bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Bot className="w-8 h-8 text-slate-500 dark:text-slate-400" />
            </div>
            <h3 className="text-lg font-medium text-slate-300 dark:text-slate-600">Belum ada agen</h3>
            <p className="text-slate-500 dark:text-slate-400 mt-1">Buat agen AI pertama Anda untuk mulai otomatisasi.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Agents;
