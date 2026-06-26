import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Brain,
  Sparkles,
  TrendingUp,
  Lightbulb,
  Eye,
  EyeOff,
  Target,
  Layers,
  Plus,
  Trash2,
  BarChart3,
} from "lucide-react";
import toast from "react-hot-toast";
import api from "../services/api";
import { format } from "date-fns";

interface LearningOverview {
  totalPatterns: number;
  activePatterns: number;
  totalAnalytics: number;
  qualifiedAnalytics: number;
  topPatterns: Array<{
    id: number;
    teknik: string;
    contoh_kalimat: string;
    confidence: number;
    frequency: number;
    product_type: string;
    dampak: string;
  }>;
  recentAnalytics: Array<{
    id: number;
    product_type: string;
    conversation_score: number;
    patterns_extracted: number;
    analyzed_at: string;
  }>;
  agentStats: Array<{
    id: number;
    name: string;
    patternCount: number;
  }>;
}

interface Pattern {
  id: number;
  teknik: string;
  contoh_kalimat: string;
  konteks: string;
  dampak: string;
  frequency: number;
  confidence: number;
  product_type: string;
  source_type: string;
  is_active: boolean;
  last_seen_at: string;
}

interface LearningAnalytic {
  id: number;
  store_wa_id: string;
  contact_id: string;
  contact_display: string; // nomor WA terformat atau LID-xxx
  contact_name: string | null; // nama asli jika tersimpan
  agent_id: number;
  product_type: string;
  conversation_score: number;
  closing_probability: number | null; // 0-100
  pesan_sampai_closing: number;
  metode_bayar: string;
  alur_lengkap: boolean;
  data_lengkap: boolean;
  ada_komplain: boolean;
  patterns_extracted: number;
  source_type: string;
  analyzed_at: string;
}

interface PromptEvolution {
  id: number;
  agent_id: number;
  agent_name: string;
  prompt_before: string;
  prompt_after: string;
  summary_changes: string;
  patterns_used: number;
  tokens_used: number;
  created_at: string;
}

const LearningCenter = () => {
  const [tab, setTab] = useState<
    "overview" | "patterns" | "analytics" | "evolutions"
  >("overview");
  const [overview, setOverview] = useState<LearningOverview | null>(null);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [analytics, setAnalytics] = useState<LearningAnalytic[]>([]);
  const [anaPage, setAnaPage] = useState(1);
  const [anaTotalPages, setAnaTotalPages] = useState(1);
  const [evolutions, setEvolutions] = useState<PromptEvolution[]>([]);
  const [evoDate, setEvoDate] = useState("");
  const [filterAgentId, setFilterAgentId] = useState("");
  const [filterProductType, setFilterProductType] = useState("");
  const [agents, setAgents] = useState<Array<{ id: number; name: string }>>([]);
  // Seed modal
  const [showSeedModal, setShowSeedModal] = useState(false);
  const [seedForm, setSeedForm] = useState({
    teknik: "",
    contoh_kalimat: "",
    konteks: "",
    dampak: "",
    product_type: "generic",
    agent_id: "",
    confidence: 0.7,
  });
  const [seeding, setSeeding] = useState(false);

  // Fetch agents sekali saat mount — digunakan di semua tab
  useEffect(() => {
    fetchAgents();
  }, []);

  useEffect(() => {
    if (tab === "overview") fetchOverview();
    else if (tab === "patterns") fetchPatterns();
    else if (tab === "analytics") fetchAnalytics();
    else if (tab === "evolutions") fetchEvolutions();
  }, [tab, page, anaPage, evoDate, filterAgentId]);

  useEffect(() => {
    if (tab === "patterns") fetchPatterns();
  }, [page, filterAgentId, filterProductType]);

  const fetchOverview = async () => {
    setLoading(true);
    try {
      const res = await api.get("/learning/overview");
      setOverview(res.data);
    } catch {
      toast.error("Gagal mengambil data learning");
    } finally {
      setLoading(false);
    }
  };

  const fetchPatterns = async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 20 };
      if (filterAgentId) params.agent_id = filterAgentId;
      if (filterProductType && filterProductType !== "semua")
        params.product_type = filterProductType;
      const res = await api.get("/learning/patterns", { params });
      setPatterns(res.data.data);
      setTotalPages(res.data.totalPages);
    } catch {
      toast.error("Gagal mengambil pola");
    } finally {
      setLoading(false);
    }
  };

  const togglePattern = async (id: number) => {
    try {
      await api.put(`/learning/patterns/${id}/toggle`);
      toast.success("Status pola diubah");
      fetchPatterns();
    } catch {
      toast.error("Gagal mengubah status");
    }
  };

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const params: any = { page: anaPage, limit: 20 };
      if (filterAgentId) params.agent_id = filterAgentId;
      const res = await api.get("/learning/analytics", { params });
      setAnalytics(res.data.data || []);
      setAnaTotalPages(res.data.totalPages || 1);
    } catch {
      toast.error("Gagal mengambil data analytics");
    } finally {
      setLoading(false);
    }
  };

  const fetchAgents = async () => {
    try {
      const res = await api.get("/agents");
      // Normalisasi: gunakan name || bot_name agar dropdown tidak kosong
      const normalized = (res.data || []).map((a: any) => ({
        id: a.id,
        name: a.name || a.bot_name || `Agent #${a.id}`,
      }));
      setAgents(normalized);
    } catch (err: any) {
      console.error("[LearningCenter] fetchAgents error:", err.message);
      // Optional: show error toast jika agent list kosong
      if (agents.length === 0) {
        toast.error(
          "Daftar agent tidak bisa dimuat. Refresh halaman untuk coba lagi.",
        );
      }
    }
  };

  const fetchEvolutions = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (filterAgentId) params.agent_id = filterAgentId;
      if (evoDate) params.date = evoDate;
      const res = await api.get("/learning/evolutions", { params });
      const evolutions = res.data.data || [];

      if (evolutions.length === 0) {
        // Show helpful message, bukan blank
        toast.success(
          "Belum ada evolusi prompt untuk agent ini. Tunggu ada beberapa closing baru untuk trigger evolusi.",
        );
      }

      setEvolutions(evolutions);
    } catch (err: any) {
      console.error("[LearningCenter] fetchEvolutions error:", err.message);
      toast.error("Gagal load data evolusi. Coba refresh halaman.");
    } finally {
      setLoading(false);
    }
  };

  const handleSeed = async () => {
    if (!seedForm.teknik.trim() || !seedForm.contoh_kalimat.trim()) {
      toast.error("Teknik dan contoh kalimat wajib diisi");
      return;
    }
    setSeeding(true);
    try {
      await api.post("/learning/seed", {
        teknik: seedForm.teknik,
        contoh_kalimat: seedForm.contoh_kalimat,
        konteks: seedForm.konteks,
        dampak: seedForm.dampak,
        product_type: seedForm.product_type,
        agent_id: seedForm.agent_id || null,
        confidence: seedForm.confidence,
      });
      toast.success("Pattern berhasil ditambahkan!");
      setShowSeedModal(false);
      setSeedForm({
        teknik: "",
        contoh_kalimat: "",
        konteks: "",
        dampak: "",
        product_type: "generic",
        agent_id: "",
        confidence: 0.7,
      });
      fetchOverview();
    } catch (e: any) {
      toast.error(e.response?.data?.error || "Gagal menambahkan pattern");
    } finally {
      setSeeding(false);
    }
  };

  const handleDeletePattern = async (id: number) => {
    if (!confirm("Yakin ingin menghapus pattern ini?")) return;
    try {
      await api.delete(`/learning/patterns/${id}`);
      toast.success("Pattern dihapus");
      fetchPatterns();
      fetchOverview();
    } catch {
      toast.error("Gagal menghapus pattern");
    }
  };

  const getProductLabel = (type: string) => {
    const map: Record<string, string> = {
      dtf: "DTF (Label Baju)",
      uv: "UV (Stiker Keras)",
      generic: "Generic",
    };
    return map[type] || type;
  };

  const getConfidenceColor = (conf: number) => {
    if (conf >= 0.8) return "text-emerald-400";
    if (conf >= 0.6) return "text-yellow-400";
    return "text-slate-400 dark:text-slate-500";
  };

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-3xl font-bold text-white dark:text-slate-900 flex items-center gap-3">
            <Brain className="w-8 h-8 text-purple-400" />
            Learning Center
          </h1>
          <p className="text-slate-400 dark:text-slate-500 mt-1">
            Bot otomatis belajar dari setiap closing. Lihat pola dan insight di
            sini.
          </p>
        </div>
      </motion.div>

      {/* Tabs */}
      <div className="flex bg-slate-900 dark:bg-white/80 p-1 rounded-xl border border-slate-800 dark:border-slate-200 w-fit">
        {[
          { key: "overview", label: "Overview", icon: Sparkles },
          { key: "patterns", label: "Semua Pola", icon: Layers },
          { key: "analytics", label: "Analytics", icon: BarChart3 },
          { key: "evolutions", label: "Evolusi Prompt", icon: TrendingUp },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key as any);
              setPage(1);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
              tab === t.key
                ? "bg-purple-600 text-white dark:text-slate-900 shadow-lg"
                : "text-slate-400 dark:text-slate-700 hover:text-slate-200"
            }`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* Seed Button + Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setShowSeedModal(true)}
          className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-xl text-white font-medium flex items-center gap-2 hover:shadow-lg hover:shadow-emerald-500/20 transition-all text-sm"
        >
          <Plus className="w-4 h-4" /> Seed Pattern
        </button>
        {tab === "patterns" && (
          <>
            <select
              value={filterAgentId}
              onChange={(e) => {
                setFilterAgentId(e.target.value);
                setPage(1);
              }}
              className="bg-slate-900/60 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-300 dark:text-slate-600"
            >
              <option value="">Semua Agent</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <select
              value={filterProductType}
              onChange={(e) => {
                setFilterProductType(e.target.value);
                setPage(1);
              }}
              className="bg-slate-900/60 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-300 dark:text-slate-600"
            >
              <option value="semua">Semua Produk</option>
              <option value="dtf">DTF</option>
              <option value="uv">UV</option>
              <option value="generic">Generic</option>
            </select>
          </>
        )}
        {tab === "analytics" && (
          <select
            value={filterAgentId}
            onChange={(e) => {
              setFilterAgentId(e.target.value);
              setAnaPage(1);
              fetchAnalytics();
            }}
            className="bg-slate-900/60 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-300 dark:text-slate-600"
          >
            <option value="">Semua Agent</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
        {tab === "evolutions" && (
          <>
            <select
              value={filterAgentId}
              onChange={(e) => {
                setFilterAgentId(e.target.value);
                fetchEvolutions();
              }}
              className="bg-slate-900/60 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-300 dark:text-slate-600"
            >
              <option value="">Semua Agent</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={evoDate}
              onChange={(e) => setEvoDate(e.target.value)}
              className="bg-slate-900/60 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-300 dark:text-slate-600"
            />
          </>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Overview Tab */}
          {tab === "overview" && overview && (
            <div className="space-y-6">
              {/* Stats cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  {
                    label: "Total Pola",
                    value: overview.totalPatterns,
                    icon: Layers,
                    color: "text-blue-400",
                  },
                  {
                    label: "Pola Aktif",
                    value: overview.activePatterns,
                    icon: Eye,
                    color: "text-emerald-400",
                  },
                  {
                    label: "Total Analisis",
                    value: overview.totalAnalytics,
                    icon: Target,
                    color: "text-yellow-400",
                  },
                  {
                    label: "Qualified",
                    value: overview.qualifiedAnalytics,
                    icon: TrendingUp,
                    color: "text-purple-400",
                  },
                ].map((card, i) => (
                  <motion.div
                    key={card.label}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 p-5 rounded-2xl backdrop-blur-xl"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-slate-400 dark:text-slate-500">
                          {card.label}
                        </p>
                        <p className={`text-2xl font-bold mt-1 ${card.color}`}>
                          {card.value}
                        </p>
                      </div>
                      <card.icon
                        className={`w-8 h-8 ${card.color} opacity-50`}
                      />
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Top Patterns */}
              {overview.topPatterns.length > 0 && (
                <div className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-2xl p-6 backdrop-blur-xl">
                  <h3 className="text-lg font-bold text-white dark:text-slate-900 mb-4 flex items-center gap-2">
                    <Lightbulb className="w-5 h-5 text-yellow-400" /> Top Pola
                    Sukses
                  </h3>
                  <div className="space-y-3">
                    {overview.topPatterns.map((pattern) => (
                      <div
                        key={pattern.id}
                        className="bg-slate-950/50 dark:bg-slate-50 border border-slate-800 dark:border-slate-200/80 rounded-xl p-4 hover:bg-slate-800 dark:bg-slate-100/40 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-bold text-white dark:text-slate-900 capitalize">
                                {pattern.teknik.replace(/_/g, " ")}
                              </h4>
                              <span className="text-xs px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-400">
                                {getProductLabel(pattern.product_type)}
                              </span>
                            </div>
                            <p className="text-sm text-slate-400 dark:text-slate-500 line-clamp-2">
                              {pattern.contoh_kalimat}
                            </p>
                            {pattern.dampak && (
                              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                💡 {pattern.dampak}
                              </p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <div
                              className={`text-lg font-bold ${getConfidenceColor(pattern.confidence)}`}
                            >
                              {(pattern.confidence * 100).toFixed(0)}%
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {pattern.frequency}x digunakan
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Agent Stats */}
              {overview.agentStats.length > 0 && (
                <div className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-2xl p-6 backdrop-blur-xl">
                  <h3 className="text-lg font-bold text-white dark:text-slate-900 mb-4 flex items-center gap-2">
                    <Brain className="w-5 h-5 text-blue-400" /> Per Agent
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {overview.agentStats.map((agent) => (
                      <div
                        key={agent.id}
                        className="bg-slate-950/50 dark:bg-slate-50 border border-slate-800 dark:border-slate-200 rounded-xl p-4 text-center"
                      >
                        <p className="text-sm text-slate-400 dark:text-slate-500">
                          {agent.name}
                        </p>
                        <p className="text-2xl font-bold text-white dark:text-slate-900 mt-1">
                          {agent.patternCount}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          pola tersimpan
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* All Patterns Tab */}
          {tab === "patterns" && (
            <div className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-2xl backdrop-blur-xl overflow-hidden">
              {patterns.length > 0 ? (
                <>
                  <div className="divide-y divide-slate-800">
                    {patterns.map((pattern) => (
                      <div
                        key={pattern.id}
                        className="p-5 hover:bg-slate-800 dark:bg-slate-100/30 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-2 flex-wrap">
                              <h3 className="font-bold text-white dark:text-slate-900 capitalize">
                                {pattern.teknik.replace(/_/g, " ")}
                              </h3>
                              <span
                                className={`px-2 py-0.5 rounded-md text-xs border ${
                                  pattern.is_active
                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                    : "bg-red-500/10 text-red-400 border-red-500/20"
                                }`}
                              >
                                {pattern.is_active ? "Active" : "Inactive"}
                              </span>
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                {getProductLabel(pattern.product_type)}
                              </span>
                              <span className="text-xs text-slate-600">
                                {pattern.source_type}
                              </span>
                            </div>
                            <p className="text-sm text-slate-400 dark:text-slate-500">
                              {expandedId === pattern.id
                                ? pattern.contoh_kalimat
                                : pattern.contoh_kalimat?.slice(0, 120) +
                                  (pattern.contoh_kalimat?.length > 120
                                    ? "..."
                                    : "")}
                            </p>
                            {expandedId === pattern.id && (
                              <div className="mt-3 space-y-2 text-sm bg-slate-950/50 dark:bg-slate-50 rounded-xl p-4">
                                <div>
                                  <span className="text-slate-500 dark:text-slate-400 font-medium">
                                    Konteks:
                                  </span>
                                  <p className="text-slate-300 dark:text-slate-600 mt-1">
                                    {pattern.konteks}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-slate-500 dark:text-slate-400 font-medium">
                                    Dampak:
                                  </span>
                                  <p className="text-slate-300 dark:text-slate-600 mt-1">
                                    {pattern.dampak}
                                  </p>
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  Terakhir terlihat:{" "}
                                  {format(
                                    new Date(pattern.last_seen_at),
                                    "dd MMM yyyy, HH:mm",
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="text-right shrink-0 space-y-2">
                            <span
                              className={`text-sm font-bold ${getConfidenceColor(pattern.confidence)}`}
                            >
                              {(pattern.confidence * 100).toFixed(0)}%
                            </span>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {pattern.frequency}x
                            </div>
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() =>
                                  setExpandedId(
                                    expandedId === pattern.id
                                      ? null
                                      : pattern.id,
                                  )
                                }
                                className="px-2 py-1 text-xs bg-slate-800 dark:bg-slate-100 rounded-lg text-slate-400 dark:text-slate-500 hover:text-white dark:text-slate-900"
                              >
                                {expandedId === pattern.id ? "<" : ">"}
                              </button>
                              <button
                                onClick={() => togglePattern(pattern.id)}
                                className={`px-2 py-1 text-xs rounded-lg ${
                                  pattern.is_active
                                    ? "bg-red-500/10 text-red-400 hover:bg-red-500/20"
                                    : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                                }`}
                              >
                                {pattern.is_active ? (
                                  <EyeOff className="w-3 h-3" />
                                ) : (
                                  <Eye className="w-3 h-3" />
                                )}
                              </button>
                              <button
                                onClick={() => handleDeletePattern(pattern.id)}
                                className="px-2 py-1 text-xs rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {totalPages > 1 && (
                    <div className="flex justify-center gap-2 p-4 border-t border-slate-800 dark:border-slate-200">
                      <button
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="px-4 py-2 bg-slate-800 dark:bg-slate-100 rounded-xl text-sm text-slate-300 dark:text-slate-600 disabled:opacity-30"
                      >
                        ← Prev
                      </button>
                      <span className="px-4 py-2 text-sm text-slate-400 dark:text-slate-500">
                        Page {page} / {totalPages}
                      </span>
                      <button
                        onClick={() =>
                          setPage((p) => Math.min(totalPages, p + 1))
                        }
                        disabled={page === totalPages}
                        className="px-4 py-2 bg-slate-800 dark:bg-slate-100 rounded-xl text-sm text-slate-300 dark:text-slate-600 disabled:opacity-30"
                      >
                        Next →
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-slate-800/50 dark:bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Brain className="w-8 h-8 text-slate-500 dark:text-slate-400" />
                  </div>
                  <h3 className="text-lg font-medium text-slate-300 dark:text-slate-600">
                    Belum ada pola pembelajaran
                  </h3>
                  <p className="text-slate-500 dark:text-slate-400 mt-1">
                    Pola akan muncul otomatis setelah AI mendeteksi dan
                    menganalisis closing.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Analytics Tab */}
          {tab === "analytics" && (
            <div className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-2xl backdrop-blur-xl overflow-hidden">
              {analytics.length > 0 ? (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-800 dark:border-slate-200 bg-slate-950/40 dark:bg-slate-50">
                          <th className="text-left py-3 px-4 text-slate-400 dark:text-slate-500 font-medium">
                            Tanggal
                          </th>
                          <th className="text-left py-3 px-4 text-slate-400 dark:text-slate-500 font-medium">
                            Kontak
                          </th>
                          <th className="text-left py-3 px-4 text-slate-400 dark:text-slate-500 font-medium">
                            Produk
                          </th>
                          <th className="text-center py-3 px-4 text-slate-400 dark:text-slate-500 font-medium">
                            Score
                          </th>
                          <th className="text-center py-3 px-4 text-slate-400 dark:text-slate-500 font-medium">
                            Prob.
                          </th>
                          <th className="text-center py-3 px-4 text-slate-400 dark:text-slate-500 font-medium">
                            Pesan
                          </th>
                          <th className="text-center py-3 px-4 text-slate-400 dark:text-slate-500 font-medium">
                            Pola
                          </th>
                          <th className="text-center py-3 px-4 text-slate-400 dark:text-slate-500 font-medium">
                            Lengkap
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {analytics.map((item) => (
                          <tr
                            key={item.id}
                            className="hover:bg-slate-800/30 dark:hover:bg-slate-50 transition-colors"
                          >
                            <td className="py-3 px-4 text-slate-400 dark:text-slate-500 text-xs whitespace-nowrap">
                              {format(
                                new Date(item.analyzed_at),
                                "dd MMM, HH:mm",
                              )}
                            </td>
                            <td className="py-3 px-4 max-w-[140px]">
                              <div className="flex flex-col">
                                {item.contact_name && (
                                  <span className="text-xs font-medium text-slate-200 dark:text-slate-700 truncate">
                                    {item.contact_name}
                                  </span>
                                )}
                                <span className="text-[11px] font-mono text-blue-400 truncate">
                                  {item.contact_display ||
                                    item.contact_id ||
                                    "—"}
                                </span>
                                {item.store_wa_id && (
                                  <span className="text-[10px] text-slate-600 dark:text-slate-400 truncate">
                                    {item.store_wa_id}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <span className="text-xs px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-400">
                                {getProductLabel(item.product_type)}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-center">
                              <span
                                className={`text-sm font-bold ${
                                  item.conversation_score >= 7
                                    ? "text-emerald-400"
                                    : item.conversation_score >= 5
                                      ? "text-yellow-400"
                                      : "text-red-400"
                                }`}
                              >
                                {Number(item.conversation_score)?.toFixed(1)}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-center">
                              {item.closing_probability != null ? (
                                <span
                                  className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                    item.closing_probability >= 70
                                      ? "bg-emerald-500/20 text-emerald-400"
                                      : item.closing_probability >= 40
                                        ? "bg-yellow-500/20 text-yellow-400"
                                        : "bg-slate-700 text-slate-400"
                                  }`}
                                >
                                  {item.closing_probability}%
                                </span>
                              ) : (
                                <span className="text-slate-600 text-xs">
                                  —
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-center text-slate-300 dark:text-slate-600 text-xs font-medium">
                              {item.pesan_sampai_closing > 0 ? (
                                item.pesan_sampai_closing
                              ) : (
                                <span className="text-slate-600">—</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-center">
                              {item.patterns_extracted > 0 ? (
                                <span className="text-xs font-bold text-blue-400">
                                  {item.patterns_extracted}
                                </span>
                              ) : (
                                <span className="text-slate-600 text-xs">
                                  0
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-center">
                              {item.alur_lengkap && item.data_lengkap ? (
                                <span className="text-emerald-400 text-sm">
                                  ✅
                                </span>
                              ) : (
                                <span className="text-slate-600 text-xs">
                                  —
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {anaTotalPages > 1 && (
                    <div className="flex justify-center gap-2 p-4 border-t border-slate-800 dark:border-slate-200">
                      <button
                        onClick={() => setAnaPage((p) => Math.max(1, p - 1))}
                        disabled={anaPage === 1}
                        className="px-4 py-2 bg-slate-800 dark:bg-slate-100 rounded-xl text-sm text-slate-300 dark:text-slate-600 disabled:opacity-30"
                      >
                        ← Prev
                      </button>
                      <span className="px-4 py-2 text-sm text-slate-400 dark:text-slate-500">
                        Page {anaPage} / {anaTotalPages}
                      </span>
                      <button
                        onClick={() =>
                          setAnaPage((p) => Math.min(anaTotalPages, p + 1))
                        }
                        disabled={anaPage === anaTotalPages}
                        className="px-4 py-2 bg-slate-800 dark:bg-slate-100 rounded-xl text-sm text-slate-300 dark:text-slate-600 disabled:opacity-30"
                      >
                        Next →
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-12">
                  <BarChart3 className="w-12 h-12 mx-auto mb-3 text-slate-500 dark:text-slate-400 opacity-30" />
                  <p className="text-slate-400 dark:text-slate-500">
                    Belum ada data analytics
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Data muncul otomatis setelah AI menganalisis percakapan
                    (idle 5 menit).
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Evolutions Tab */}
          {tab === "evolutions" && (
            <div className="bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 rounded-2xl p-6 backdrop-blur-xl">
              <div className="mb-6">
                <h3 className="text-lg font-bold text-white dark:text-slate-900 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-emerald-400" />
                  Evolusi Prompt Bot (Auto Self-Improving)
                </h3>
                <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
                  Riwayat revisi prompt bot yang dilakukan AI secara otomatis
                  setiap 3 analisis. Setiap revisi memperringkas dan
                  mempermatang instruksi bot.
                </p>
              </div>

              {loading ? (
                <div className="text-center py-16">
                  <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-blue-500/20 flex items-center justify-center animate-spin">
                    <div className="w-8 h-8 rounded-full border-2 border-slate-600 border-t-blue-400" />
                  </div>
                  <p className="text-slate-300 dark:text-slate-600 font-medium">
                    Memuat evolusi prompt...
                  </p>
                </div>
              ) : evolutions.length > 0 ? (
                <div className="space-y-5">
                  {evolutions.map((evo) => (
                    <div
                      key={evo.id}
                      className="bg-slate-950/50 dark:bg-slate-50 border border-slate-800 dark:border-slate-200 rounded-2xl overflow-hidden"
                    >
                      {/* Header */}
                      <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-slate-800 dark:border-slate-200 bg-slate-900/60">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold text-white dark:text-slate-900 bg-blue-600 px-2 py-0.5 rounded-full">
                            {evo.agent_name}
                          </span>
                          <span className="text-xs text-slate-500">
                            {format(
                              new Date(evo.created_at),
                              "dd MMM yyyy, HH:mm",
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                          <span>{evo.patterns_used} pola</span>
                          <span>•</span>
                          <span>{evo.tokens_used} token</span>
                        </div>
                      </div>
                      {/* Summary */}
                      {evo.summary_changes && (
                        <div className="px-5 py-3 bg-blue-500/5 border-b border-blue-500/10">
                          <p className="text-xs text-blue-300 dark:text-blue-600">
                            <strong>Ringkasan Perubahan:</strong>{" "}
                            {evo.summary_changes}
                          </p>
                        </div>
                      )}
                      {/* Before / After Diff */}
                      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-800 dark:divide-slate-200">
                        <div className="p-4">
                          <h4 className="text-[11px] font-bold uppercase text-red-400 mb-2 flex items-center gap-1">
                            ← Sebelum
                          </h4>
                          <pre className="text-[11px] text-slate-400 dark:text-slate-500 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto custom-scrollbar">
                            {evo.prompt_before || "(Kosong — revisi pertama)"}
                          </pre>
                        </div>
                        <div className="p-4">
                          <h4 className="text-[11px] font-bold uppercase text-emerald-400 mb-2 flex items-center gap-1">
                            → Sesudah
                          </h4>
                          <pre className="text-[11px] text-slate-200 dark:text-slate-700 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto custom-scrollbar">
                            {evo.prompt_after}
                          </pre>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-16">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-800/50 flex items-center justify-center">
                    <TrendingUp className="w-8 h-8 text-slate-600" />
                  </div>
                  <p className="text-slate-300 dark:text-slate-600 font-medium">
                    📊 Belum ada evolusi prompt
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 max-w-sm mx-auto">
                    Sistem akan generate setelah cukup closing data. Prompt bot
                    akan otomatis direvisi setelah 3 siklus analisis percakapan
                    berhasil. Semakin banyak chat, semakin cepat bot berkembang.
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Seed Modal */}
      {showSeedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowSeedModal(false)}
          />
          <div className="relative bg-slate-900 dark:bg-white border border-slate-800 dark:border-slate-200 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto z-10 p-6">
            <h2 className="text-lg font-bold text-white dark:text-slate-900 mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-emerald-400" />
              Seed Learning Pattern
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-300 dark:text-slate-600 mb-1">
                  Teknik *
                </label>
                <input
                  type="text"
                  value={seedForm.teknik}
                  onChange={(e) =>
                    setSeedForm({ ...seedForm, teknik: e.target.value })
                  }
                  placeholder="Contoh: urgency_scarcity"
                  className="w-full bg-slate-950 dark:bg-slate-50 border border-slate-700 dark:border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-200 dark:text-slate-700"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 dark:text-slate-600 mb-1">
                  Contoh Kalimat *
                </label>
                <textarea
                  value={seedForm.contoh_kalimat}
                  onChange={(e) =>
                    setSeedForm({ ...seedForm, contoh_kalimat: e.target.value })
                  }
                  rows={3}
                  placeholder="Kalimat contoh closing..."
                  className="w-full bg-slate-950 dark:bg-slate-50 border border-slate-700 dark:border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-200 dark:text-slate-700 resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 dark:text-slate-600 mb-1">
                  Konteks
                </label>
                <input
                  type="text"
                  value={seedForm.konteks}
                  onChange={(e) =>
                    setSeedForm({ ...seedForm, konteks: e.target.value })
                  }
                  placeholder="Kapan pattern ini digunakan"
                  className="w-full bg-slate-950 dark:bg-slate-50 border border-slate-700 dark:border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-200 dark:text-slate-700"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 dark:text-slate-600 mb-1">
                  Dampak
                </label>
                <input
                  type="text"
                  value={seedForm.dampak}
                  onChange={(e) =>
                    setSeedForm({ ...seedForm, dampak: e.target.value })
                  }
                  placeholder="Efek dari pattern ini"
                  className="w-full bg-slate-950 dark:bg-slate-50 border border-slate-700 dark:border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-200 dark:text-slate-700"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-300 dark:text-slate-600 mb-1">
                    Product Type
                  </label>
                  <select
                    value={seedForm.product_type}
                    onChange={(e) =>
                      setSeedForm({ ...seedForm, product_type: e.target.value })
                    }
                    className="w-full bg-slate-950 dark:bg-slate-50 border border-slate-700 dark:border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-200 dark:text-slate-700"
                  >
                    <option value="generic">Generic</option>
                    <option value="dtf">DTF</option>
                    <option value="uv">UV</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 dark:text-slate-600 mb-1">
                    Agent
                  </label>
                  <select
                    value={seedForm.agent_id}
                    onChange={(e) =>
                      setSeedForm({ ...seedForm, agent_id: e.target.value })
                    }
                    className="w-full bg-slate-950 dark:bg-slate-50 border border-slate-700 dark:border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-200 dark:text-slate-700"
                  >
                    <option value="">Tanpa Agent</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 dark:text-slate-600 mb-1">
                  Confidence (0-1)
                </label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.1"
                  value={seedForm.confidence}
                  onChange={(e) =>
                    setSeedForm({
                      ...seedForm,
                      confidence: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-slate-950 dark:bg-slate-50 border border-slate-700 dark:border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-200 dark:text-slate-700"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={handleSeed}
                disabled={seeding}
                className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl font-medium transition-colors"
              >
                {seeding ? "Menyimpan..." : "Simpan Pattern"}
              </button>
              <button
                onClick={() => setShowSeedModal(false)}
                className="px-4 py-2.5 bg-slate-800 dark:bg-slate-100 hover:bg-slate-700 text-slate-300 dark:text-slate-600 rounded-xl font-medium transition-colors"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LearningCenter;
