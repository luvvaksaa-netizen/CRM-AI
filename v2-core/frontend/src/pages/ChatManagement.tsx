import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { encodeWAId } from "../utils/urlEncoding";
import {
  MessageSquare,
  Phone,
  Search,
  MoreVertical,
  Bot,
  User,
  Check,
  CheckCheck,
  RefreshCw,
  Image as ImageIcon,
  Video,
  X,
  Reply,
  Paperclip,
  ArrowLeft,
  Pause,
  Play,
  Tag,
  Copy,
  Trash2,
  FileText,
  RotateCw,
  Smile,
  Share2,
} from "lucide-react";
import toast from "react-hot-toast";
import api from "../services/api";
import { socketService } from "../services/socket";
import { format, isToday, isYesterday } from "date-fns";
import { useChatStore } from "../stores/chatStore";
import { useReconnectWarning } from "../hooks/useReconnectWarning";
import { ReconnectWarning } from "../components/ReconnectWarning";
import { Virtuoso } from "react-virtuoso";

// ─── Types ───

interface ChatContact {
  contact_id: string;
  sender_name: string;
  contact_display_name: string;
  contact_phone?: string;
  last_message: string;
  last_seen: string;
  unread_count: number;
  is_bot_paused: boolean;
  paused_until: string | null;
  labels?: string[];
}

interface ChatMessage {
  id: number | string;
  wa_message_id?: string;
  body: string;
  is_from_me: boolean;
  is_read: boolean;
  timestamp: string;
  sender_name: string;
  quoted_message_id?: string;
  quoted_body?: string;
  quoted_from_me?: boolean;
  quoted_sender_name?: string;
  is_revoked?: boolean;
}

interface MediaAsset {
  id: number;
  filename: string;
  original_name: string;
  type: "image" | "video";
  label: string;
  description?: string;
}

interface ReplyTarget {
  wa_message_id: string;
  body: string;
  is_from_me: boolean;
  sender_name: string;
}

type ChatFilter = "all" | "unread" | "label";

interface WaLabel {
  id: string;
  name: string;
  color?: number | null;
  hexColor?: string | null;
}

// ─── Helpers ───

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3002/api";
const UPLOAD_BASE = API_BASE.replace(/\/api\/?$/, "");

const formatTime = (dateStr: string) => {
  const d = new Date(dateStr);
  if (isToday(d)) return format(d, "hh:mm a");
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MMM dd");
};

const formatPhoneDisplay = (contactId: string) => {
  if (contactId.endsWith("@c.us")) return "+" + contactId.replace("@c.us", "");
  if (contactId.endsWith("@lid")) {
    // Ambil angka dari LID jika bisa — tampilkan sebagai ID pendek saja
    const lidNum = contactId.replace("@lid", "").replace(/\D/g, "");
    return lidNum ? `LID-${lidNum.slice(-6)}` : "Nomor belum diketahui";
  }
  return contactId;
};

const formatPreview = (msg: string) => {
  if (!msg) return "Media/Voice";
  if (/\[VIDEO:/i.test(msg)) return "🎥 Video";
  if (/\[MEDIA:/i.test(msg)) return "📷 Photo";
  return msg;
};

const parseMessageBody = (body: string) => {
  const mediaMatch = body.match(/\[(MEDIA|VIDEO):(\/uploads\/[^\]]+)\]/i);
  if (mediaMatch) {
    const isVideo = mediaMatch[1].toUpperCase() === "VIDEO";
    const path = mediaMatch[2];
    const caption = body.replace(mediaMatch[0], "").trim();
    return {
      type: isVideo ? ("video" as const) : ("image" as const),
      url: `${UPLOAD_BASE}${path}`,
      caption,
    };
  }
  return { type: "text" as const, text: body };
};

// ─── Sub-components ───

const MessageBody = ({ body }: { body: string }) => {
  const parsed = parseMessageBody(body);
  if (parsed.type === "text") {
    return (
      <span className="whitespace-pre-wrap">
        {parsed.text || "(Media/Lampiran)"}
      </span>
    );
  }
  return (
    <div className="space-y-2">
      {parsed.type === "image" ? (
        <img
          src={parsed.url}
          alt="Media"
          className="max-w-full rounded-lg max-h-64 object-cover"
          loading="lazy"
        />
      ) : (
        <video
          src={parsed.url}
          controls
          className="max-w-full rounded-lg max-h-64"
        />
      )}
      {parsed.caption && (
        <p className="text-sm whitespace-pre-wrap">{parsed.caption}</p>
      )}
    </div>
  );
};

const QuotedBlock = ({ msg }: { msg: ChatMessage }) => {
  if (!msg.quoted_body && !msg.quoted_message_id) return null;
  return (
    <div className="mb-1.5 px-2 py-1.5 rounded-lg border-l-2 border-blue-400 bg-black/20 text-xs opacity-80">
      <span className="font-semibold block">
        {msg.quoted_sender_name || (msg.quoted_from_me ? "Anda" : "Customer")}
      </span>
      <span className="line-clamp-2">
        {formatPreview(msg.quoted_body || "")}
      </span>
    </div>
  );
};

// ─── Main Component ───

const ChatManagement = () => {
  const {
    activeContact,
    setActiveContact,
    messages,
    setMessages,
    loadingContacts,
    setLoadingContacts,
    loadingMessages,
    setLoadingMessages,
    hasMoreMessages,
    setHasMoreMessages,
    setTypingContact,
    lastReconnectTime,
  } = useChatStore();

  // Initialize reconnect warning listener
  useReconnectWarning();

  const [stores, setStores] = useState<any[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [chatFilter, setChatFilter] = useState<ChatFilter>("all");
  const [selectedLabel, setSelectedLabel] = useState<string>("");
  const [labelCounts, setLabelCounts] = useState<Record<string, number>>({});
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [togglingBot, setTogglingBot] = useState(false);
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [showContactMenu, setShowContactMenu] = useState(false);
  const [showLabelModal, setShowLabelModal] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [waLabelsList, setWaLabelsList] = useState<WaLabel[]>([]);
  const [editingLabels, setEditingLabels] = useState<string[]>([]);
  const [showLabelManager, setShowLabelManager] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState(0);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editingLabelName, setEditingLabelName] = useState("");
  const [editingLabelColor, setEditingLabelColor] = useState(0);
  const [originalLabels, setOriginalLabels] = useState<string[]>([]);
  const [contactSummary, setContactSummary] = useState<string>("");
  const [resolvedPhone, setResolvedPhone] = useState<string | null>(null);
  const [loadingLabels, setLoadingLabels] = useState(false);
  const [savingLabels, setSavingLabels] = useState(false);
  const [requestingPhone, setRequestingPhone] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [syncingWaHistory, setSyncingWaHistory] = useState(false);
  const [globalSyncProgress, setGlobalSyncProgress] = useState<{
    status: string;
    message: string;
    current?: number;
    total?: number;
  } | null>(null);
  const [firstItemIndex, setFirstItemIndex] = useState(10000);
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(
    null,
  );
  const [showForwardPicker, setShowForwardPicker] = useState(false);
  const [forwardMsgId, setForwardMsgId] = useState<string | null>(null);
  const [forwardTarget, setForwardTarget] = useState<string>("");

  const [contactsPage, setContactsPage] = useState(1);
  const [hasMoreContacts, setHasMoreContacts] = useState(true);
  const [loadingMoreContacts, setLoadingMoreContacts] = useState(false);

  const fetchContactsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const fetchContactsRef = useRef<
    (pageToLoad?: number, searchQueryParam?: string, silent?: boolean) => void
  >(() => {});

  const menuRef = useRef<HTMLDivElement>(null);
  const skipAutoScrollRef = useRef(false);
  // Refs untuk Virtuoso startReached — agar tidak stale closure
  const hasMoreMessagesRef = useRef(false);
  const loadingOlderRef = useRef(false);
  // Sync state → refs agar Virtuoso bisa baca nilai terbaru tanpa stale closure
  hasMoreMessagesRef.current = hasMoreMessages;
  loadingOlderRef.current = loadingOlder;

  const getDisplayName = (
    c: ChatContact | ChatMessage,
    fallbackId?: string,
  ) => {
    if ("contact_display_name" in c) {
      const raw = c as ChatContact;
      const name = (raw.contact_display_name || raw.sender_name || "").trim();
      // Jika nama adalah placeholder generik, tampilkan nomor HP asli
      const isPlaceholder =
        !name ||
        /^Kontak WA (#\d+|Privat)?$/.test(name) ||
        name === "Kontak WhatsApp";
      if (isPlaceholder) {
        if (raw.contact_phone) return `+${raw.contact_phone}`;
        if (raw.contact_id?.endsWith("@c.us"))
          return `+${raw.contact_id.replace("@c.us", "")}`;
      }
      return name || raw.contact_id;
    }
    return c.sender_name || fallbackId || "Unknown";
  };

  const fetchContacts = useCallback(
    async (pageToLoad = 1, searchQueryParam = "", silent = false) => {
      const store = useChatStore.getState().selectedStore;
      if (!store) return;
      if (!silent && pageToLoad === 1) setLoadingContacts(true);
      if (pageToLoad > 1) setLoadingMoreContacts(true);

      try {
        const res = await api.get(`/chat/${store}/contacts`, {
          params: { page: pageToLoad, limit: 50, search: searchQueryParam },
        });
        const newContacts = res.data;

        if (pageToLoad === 1) {
          useChatStore.getState().setContacts(newContacts);
        } else {
          const current = useChatStore.getState().contacts;
          const existingIds = new Set(current.map((c) => c.contact_id));
          const uniqueNew = newContacts.filter(
            (c: any) => !existingIds.has(c.contact_id),
          );
          useChatStore.getState().setContacts([...current, ...uniqueNew]);
        }

        setHasMoreContacts(newContacts.length === 50);
        setContactsPage(pageToLoad);
      } catch {
        if (!silent && pageToLoad === 1)
          toast.error("Gagal mengambil daftar kontak");
      } finally {
        if (!silent && pageToLoad === 1) setLoadingContacts(false);
        if (pageToLoad > 1) setLoadingMoreContacts(false);
      }
    },
    [setLoadingContacts],
  );

  fetchContactsRef.current = fetchContacts;

  const debouncedFetchContacts = useCallback((searchQueryParam = "") => {
    if (fetchContactsDebounceRef.current)
      clearTimeout(fetchContactsDebounceRef.current);
    fetchContactsDebounceRef.current = setTimeout(() => {
      fetchContactsRef.current(1, searchQueryParam, true);
    }, 500);
  }, []);

  const fetchLabelCounts = useCallback(async () => {
    const store = useChatStore.getState().selectedStore;
    if (!store) return;
    try {
      const res = await api.get("/smart-labels/counts", {
        params: { store_wa_id: store },
      });
      setLabelCounts(res.data.labelCounts || {});
    } catch {
      setLabelCounts({});
    }
  }, []);

  const fetchMessages = useCallback(
    async (contactId: string, before?: string) => {
      const store = useChatStore.getState().selectedStore;
      if (!store) return;
      if (!before) {
        setLoadingMessages(true);
      }
      try {
        const res = await api.get(`/chat/${store}`, {
          params: {
            contactId,
            limit: 50,
            paginated: "true",
            ...(before ? { before } : {}),
          },
        });
        const { messages: newMessages, pagination } = res.data;
        if (before) {
          // Muat pesan lebih lama — prepend ke atas
          const currentMessages = useChatStore.getState().messages;
          const seen = new Set(currentMessages.map((m) => m.id));
          const trulyNew = newMessages.filter((m: any) => !seen.has(m.id));
          if (trulyNew.length > 0) {
            setFirstItemIndex((prev) => prev - trulyNew.length);
            useChatStore
              .getState()
              .setMessages([...trulyNew, ...currentMessages]);
          }
          // Update hasMore hanya saat load lebih lama (bukan overwrite dengan load terbaru)
          setHasMoreMessages(pagination?.hasMore ?? false);
        } else {
          // Initial load — reset state
          setFirstItemIndex(10000);
          useChatStore.getState().setMessages(newMessages);
          setHasMoreMessages(pagination?.hasMore ?? false);
        }
      } catch {
        if (!before) toast.error("Gagal mengambil riwayat pesan");
      } finally {
        if (!before) setLoadingMessages(false);
      }
    },
    [setLoadingMessages, setHasMoreMessages],
  );

  const loadOlderMessages = useCallback(async () => {
    if (
      !activeContact ||
      !useChatStore.getState().selectedStore ||
      loadingOlderRef.current ||
      !hasMoreMessagesRef.current
    )
      return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    skipAutoScrollRef.current = true;
    try {
      const currentMessages = useChatStore.getState().messages;
      const oldestTimestamp =
        currentMessages.length > 0 ? currentMessages[0].timestamp : undefined;
      if (!oldestTimestamp) return;
      await fetchMessages(activeContact.contact_id, oldestTimestamp);
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [activeContact, fetchMessages]);

  const fetchMediaAssets = useCallback(async () => {
    const store = stores.find(
      (s) => s.wa_id === useChatStore.getState().selectedStore,
    );
    if (!store?.agent_id) {
      setMediaAssets([]);
      return;
    }
    setLoadingMedia(true);
    try {
      const res = await api.get("/media", {
        params: { agent_id: store.agent_id },
      });
      setMediaAssets(res.data);
    } catch {
      toast.error("Gagal mengambil media katalog");
    } finally {
      setLoadingMedia(false);
    }
  }, [stores]);

  useEffect(() => {
    api
      .get("/stores")
      .then((res) => {
        setStores(res.data);
        const chatTargetRaw = sessionStorage.getItem("chatTarget");
        if (chatTargetRaw) {
          try {
            const target = JSON.parse(chatTargetRaw);
            sessionStorage.removeItem("chatTarget");
            if (
              target.storeWaId &&
              res.data.some((s: any) => s.wa_id === target.storeWaId)
            ) {
              useChatStore.getState().setSelectedStore(target.storeWaId);
              sessionStorage.setItem("chatTargetContact", target.contactId);
              return;
            }
          } catch {}
        }
        if (res.data.length > 0)
          useChatStore.getState().setSelectedStore(res.data[0].wa_id);
      })
      .catch(() => toast.error("Gagal mengambil data toko"));
  }, []);

  useEffect(() => {
    const selectedStore = useChatStore.getState().selectedStore;
    if (!selectedStore) return;
    setActiveContact(null);
    setMessages([]);
    fetchContacts();
    fetchLabelCounts();

    const deepLinkContactId = sessionStorage.getItem("chatTargetContact");
    if (deepLinkContactId) {
      sessionStorage.removeItem("chatTargetContact");
      setTimeout(() => {
        useChatStore.getState().setContacts((prev) => {
          const found = prev.find(
            (c: any) => c.contact_id === deepLinkContactId,
          );
          if (found) {
            setActiveContact(found);
            setShowMobileChat(true);
            setResolvedPhone(null);
            const encodedStore = encodeWAId(selectedStore);
            const encodedContact = encodeURIComponent(found.contact_id);
            api
              .post(`/smart-labels/${encodedStore}/${encodedContact}/sync`)
              .catch(() => {});
          }
          return prev;
        });
      }, 500);
    }

    const socket = socketService.connect();
    socket?.emit("joinStore", selectedStore);

    const onNewMessage = (data: any) => {
      // 🔧 Baca selectedStore TERBARU dari Zustand (bukan closure stale)
      const currentStore = useChatStore.getState().selectedStore;
      if (data.storeId !== currentStore) return;
      debouncedFetchContacts();
      const currentContact = useChatStore.getState().activeContact;
      if (
        currentContact &&
        data.msg?.contact_id === currentContact.contact_id
      ) {
        useChatStore.getState().addMessage(data.msg);

        // Safety sync: refetch silently after a short delay to ensure UI consistency
        setTimeout(() => {
          const active = useChatStore.getState().activeContact;
          if (active && active.contact_id === data.msg.contact_id) {
            api
              .get(`/chat/${currentStore}`, {
                params: {
                  contactId: active.contact_id,
                  limit: 50,
                  paginated: "true",
                },
              })
              .then((res) => {
                useChatStore.getState().mergeMessages(res.data.messages);
              })
              .catch(() => {});
          }
        }, 800);

        if (!data.msg.is_from_me) {
          api
            .post(`/chat/${currentStore}/${currentContact.contact_id}/read`)
            .catch(() => {});
        }
      }
    };

    const onChatRead = (data: any) => {
      if (data.storeId === useChatStore.getState().selectedStore) {
        useChatStore.getState().updateContactUnread(data.contactId, 0);
      }
    };

    const onLabelsUpdated = (data: any) => {
      if (data.storeId !== useChatStore.getState().selectedStore) return;
      useChatStore.getState().updateContactLabels(data.contactId, data.labels);
      if (
        useChatStore.getState().activeContact?.contact_id === data.contactId
      ) {
        setEditingLabels(data.labels);
      }
      debouncedFetchContacts();
      fetchLabelCounts();
    };

    const onChatCleared = (data: any) => {
      if (data.storeId !== useChatStore.getState().selectedStore) return;
      debouncedFetchContacts();
      if (
        useChatStore.getState().activeContact?.contact_id === data.contactId
      ) {
        useChatStore.getState().setMessages([]);
        useChatStore.getState().setActiveContact(null);
        setShowMobileChat(false);
      }
    };

    const onIdentityUpdated = (data: any) => {
      if (data.storeId !== useChatStore.getState().selectedStore) return;
      if (data.identity?.contact_phone)
        setResolvedPhone(data.identity.contact_phone);
      debouncedFetchContacts();
    };

    socket?.on("newMessage", onNewMessage);
    socket?.on("chatRead", onChatRead);
    socket?.on("labelsUpdated", onLabelsUpdated);
    socket?.on("chatCleared", onChatCleared);
    socket?.on("contactIdentityUpdated", onIdentityUpdated);

    const onTypingStatus = (data: any) => {
      if (data.storeId !== useChatStore.getState().selectedStore) return;
      if (data.isTyping) {
        setTypingContact(data.contactId);
        setTimeout(() => {
          if (useChatStore.getState().typingContact === data.contactId) {
            setTypingContact(null);
          }
        }, 5000);
      } else {
        if (useChatStore.getState().typingContact === data.contactId) {
          setTypingContact(null);
        }
      }
    };

    const onMessageRevoked = (data: any) => {
      if (data.storeId !== useChatStore.getState().selectedStore) return;
      useChatStore
        .getState()
        .setMessages((prev) =>
          prev.map((m) =>
            m.wa_message_id === data.waMessageId
              ? { ...m, body: "⛔ Pesan ini telah dihapus", is_revoked: true }
              : m,
          ),
        );
    };

    socket?.on("typingStatus", onTypingStatus);
    socket?.on("messageRevoked", onMessageRevoked);

    const onSyncProgress = (data: any) => {
      if (data.storeId !== useChatStore.getState().selectedStore) return;
      setGlobalSyncProgress(data);
      if (data.status === "completed" || data.status === "error") {
        setTimeout(() => setGlobalSyncProgress(null), 5000);
        fetchContacts();
      }
    };
    socket?.on("sync_progress", onSyncProgress);

    // 🔧 Re-emit joinStore on reconnect
    socket?.on("connect", () => {
      socket?.emit("joinStore", useChatStore.getState().selectedStore);
    });

    return () => {
      socket?.off("newMessage", onNewMessage);
      socket?.off("chatRead", onChatRead);
      socket?.off("labelsUpdated", onLabelsUpdated);
      socket?.off("chatCleared", onChatCleared);
      socket?.off("contactIdentityUpdated", onIdentityUpdated);
      socket?.off("typingStatus", onTypingStatus);
      socket?.off("messageRevoked", onMessageRevoked);
      socket?.off("sync_progress", onSyncProgress);
      socket?.emit("leaveStore", useChatStore.getState().selectedStore);
    };
  }, [
    fetchContacts,
    fetchLabelCounts,
    setTypingContact,
    setActiveContact,
    setMessages,
  ]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowContactMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!showReactionPicker) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-reaction-picker]")) {
        setShowReactionPicker(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showReactionPicker]);

  useEffect(() => {
    debouncedFetchContacts(searchQuery);
  }, [searchQuery, debouncedFetchContacts]);

  const loadMoreContactsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          hasMoreContacts &&
          !loadingMoreContacts &&
          !loadingContacts
        ) {
          fetchContacts(contactsPage + 1, searchQuery);
        }
      },
      { rootMargin: "100px", threshold: 0 },
    );

    const currentRef = loadMoreContactsRef.current;
    if (currentRef) observer.observe(currentRef);

    return () => {
      if (currentRef) observer.unobserve(currentRef);
    };
  }, [
    hasMoreContacts,
    loadingMoreContacts,
    loadingContacts,
    contactsPage,
    searchQuery,
    fetchContacts,
  ]);

  useEffect(() => {
    const selectedStore = useChatStore.getState().selectedStore;
    if (!selectedStore || !activeContact) return;
    setReplyTo(null);
    fetchMessages(activeContact.contact_id);

    if (activeContact.unread_count > 0) {
      api
        .post(`/chat/${selectedStore}/${activeContact.contact_id}/read`)
        .then(() => {
          useChatStore
            .getState()
            .updateContactUnread(activeContact.contact_id, 0);
        })
        .catch(() => {});
    }
  }, [activeContact?.contact_id, fetchMessages]);

  const updateContactPauseState = (
    contactId: string,
    paused: boolean,
    pausedUntil: string | null = null,
  ) => {
    useChatStore
      .getState()
      .setContacts((prev) =>
        prev.map((c) =>
          c.contact_id === contactId
            ? { ...c, is_bot_paused: paused, paused_until: pausedUntil }
            : c,
        ),
      );
    setActiveContact((prev) =>
      prev?.contact_id === contactId
        ? { ...prev, is_bot_paused: paused, paused_until: pausedUntil }
        : prev,
    );
  };

  const handleToggleBot = async () => {
    const selectedStore = useChatStore.getState().selectedStore;
    if (!activeContact || !selectedStore) return;
    setTogglingBot(true);
    try {
      if (activeContact.is_bot_paused) {
        await api.post(
          `/chat/${selectedStore}/${activeContact.contact_id}/unpause`,
        );
        updateContactPauseState(activeContact.contact_id, false, null);
        toast.success("AI diaktifkan kembali untuk kontak ini");
      } else {
        await api.post(
          `/chat/${selectedStore}/${activeContact.contact_id}/pause`,
          { durationMinutes: 30 },
        );
        const until = new Date(Date.now() + 30 * 60000).toISOString();
        updateContactPauseState(activeContact.contact_id, true, until);
        toast.success("AI dipause 30 menit untuk kontak ini");
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Gagal mengubah status bot");
    } finally {
      setTogglingBot(false);
    }
  };

  const handleSend = async () => {
    const selectedStore = useChatStore.getState().selectedStore;
    if (!inputText.trim() || !activeContact || !selectedStore) return;
    const text = inputText.trim();
    setInputText("");
    setSending(true);

    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: ChatMessage = {
      id: tempId,
      body: text,
      is_from_me: true,
      is_read: false,
      timestamp: new Date().toISOString(),
      sender_name: "CS Manual",
      ...(replyTo
        ? {
            quoted_message_id: replyTo.wa_message_id,
            quoted_body: replyTo.body,
            quoted_from_me: replyTo.is_from_me,
            quoted_sender_name: replyTo.sender_name,
          }
        : {}),
    };
    useChatStore.getState().addMessage(optimisticMsg);
    const prevReplyTo = replyTo;
    setReplyTo(null);

    try {
      const payload: Record<string, unknown> = {
        contactId: activeContact.contact_id,
        message: text,
      };
      if (prevReplyTo) {
        payload.quotedMessageId = prevReplyTo.wa_message_id;
        payload.quotedBody = prevReplyTo.body;
        payload.quotedFromMe = prevReplyTo.is_from_me;
        payload.quotedSenderName = prevReplyTo.sender_name;
      }
      await api.post(`/chat/${selectedStore}/send`, payload);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      updateContactPauseState(
        activeContact.contact_id,
        true,
        new Date(Date.now() + 30 * 60000).toISOString(),
      );
      await fetchMessages(activeContact.contact_id);
      await fetchContacts();
      toast.success("Pesan terkirim & AI dipause 30 menit");
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId
            ? { ...m, body: `❌ Gagal: ${m.body}`, sender_name: "Gagal" }
            : m,
        ),
      );
      toast.error(err.response?.data?.message || "Gagal mengirim pesan");
    } finally {
      setSending(false);
    }
  };

  const handleSendMedia = async (asset: MediaAsset) => {
    const selectedStore = useChatStore.getState().selectedStore;
    if (!activeContact || !selectedStore) return;
    setSending(true);
    try {
      await api.post(`/chat/${selectedStore}/send-media`, {
        contactId: activeContact.contact_id,
        mediaId: asset.id,
      });
      setShowMediaPicker(false);
      updateContactPauseState(
        activeContact.contact_id,
        true,
        new Date(Date.now() + 30 * 60000).toISOString(),
      );
      await fetchMessages(activeContact.contact_id);
      await fetchContacts();
      toast.success(`Media "${asset.label}" terkirim`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Gagal mengirim media");
    } finally {
      setSending(false);
    }
  };

  const handleSelectContact = (contact: ChatContact) => {
    const selectedStore = useChatStore.getState().selectedStore;
    setActiveContact(contact);
    setShowMobileChat(true);
    setResolvedPhone(null);
    setShowContactMenu(false);
    const encodedStore = encodeWAId(selectedStore);
    const encodedContact = encodeURIComponent(contact.contact_id);
    api
      .post(`/smart-labels/${encodedStore}/${encodedContact}/sync`)
      .then((res) => {
        const labels = res.data?.labels;
        if (labels) {
          useChatStore
            .getState()
            .setContacts((prev) =>
              prev.map((c) =>
                c.contact_id === contact.contact_id ? { ...c, labels } : c,
              ),
            );
          setActiveContact((prev) =>
            prev?.contact_id === contact.contact_id
              ? { ...prev, labels }
              : prev,
          );
          fetchLabelCounts();
        }
      })
      .catch(() => {});
  };

  const handleRequestPhone = async () => {
    const selectedStore = useChatStore.getState().selectedStore;
    if (!activeContact || !selectedStore) return;
    setRequestingPhone(true);
    try {
      const res = await api.post(
        `/chat/${selectedStore}/${encodeURIComponent(activeContact.contact_id)}/request-phone`,
      );
      if (res.data.phone) {
        setResolvedPhone(res.data.phone);
        toast.success(`Nomor: +${res.data.phone}`);
      } else {
        toast.success(
          res.data.message || "Permintaan nomor dikirim ke WhatsApp",
        );
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Gagal resolve nomor");
    } finally {
      setRequestingPhone(false);
    }
  };

  const openLabelModal = async () => {
    const selectedStore = useChatStore.getState().selectedStore;
    if (!activeContact || !selectedStore) return;
    setShowContactMenu(false);
    setShowLabelModal(true);
    setLoadingLabels(true);
    try {
      const encodedStore = encodeWAId(selectedStore);
      const encodedContact = encodeURIComponent(activeContact.contact_id);
      const [waRes, contactRes] = await Promise.all([
        api.get(`/smart-labels/${encodedStore}/wa-list`),
        api.get(`/smart-labels/${encodedStore}/${encodedContact}`),
      ]);
      setWaLabelsList(waRes.data.labels || []);
      const labels = contactRes.data.labels || activeContact.labels || [];
      setEditingLabels([...labels]);
      setOriginalLabels([...labels]);
    } catch {
      toast.error("Gagal memuat label");
      setEditingLabels([...(activeContact.labels || [])]);
      setOriginalLabels([...(activeContact.labels || [])]);
    } finally {
      setLoadingLabels(false);
    }
  };

  const toggleLabelSelection = (name: string) => {
    setEditingLabels((prev) =>
      prev.includes(name) ? prev.filter((l) => l !== name) : [...prev, name],
    );
  };

  const handleSaveLabels = async () => {
    const selectedStore = useChatStore.getState().selectedStore;
    if (!activeContact || !selectedStore) return;
    const add = editingLabels.filter((l) => !originalLabels.includes(l));
    const remove = originalLabels.filter((l) => !editingLabels.includes(l));
    if (add.length === 0 && remove.length === 0) {
      setShowLabelModal(false);
      return;
    }
    setSavingLabels(true);
    try {
      const encodedStore = encodeWAId(selectedStore);
      const encodedContact = encodeURIComponent(activeContact.contact_id);
      const res = await api.post(
        `/smart-labels/${encodedStore}/${encodedContact}/update`,
        { add, remove },
      );
      const labels = res.data.labels || editingLabels;
      useChatStore
        .getState()
        .setContacts((prev) =>
          prev.map((c) =>
            c.contact_id === activeContact.contact_id ? { ...c, labels } : c,
          ),
        );
      setActiveContact((prev) => (prev ? { ...prev, labels } : null));
      setOriginalLabels([...labels]);
      await fetchLabelCounts();
      toast.success(res.data.message || "Label diperbarui");
      setShowLabelModal(false);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Gagal menyimpan label");
    } finally {
      setSavingLabels(false);
    }
  };

  const handleSyncLabelsFromWa = async () => {
    const selectedStore = useChatStore.getState().selectedStore;
    if (!activeContact || !selectedStore) return;
    setLoadingLabels(true);
    try {
      const encodedStore = encodeWAId(selectedStore);
      const encodedContact = encodeURIComponent(activeContact.contact_id);
      const res = await api.post(
        `/smart-labels/${encodedStore}/${encodedContact}/sync`,
      );
      const labels = res.data.labels || [];
      setEditingLabels([...labels]);
      setOriginalLabels([...labels]);
      useChatStore
        .getState()
        .setContacts((prev) =>
          prev.map((c) =>
            c.contact_id === activeContact.contact_id ? { ...c, labels } : c,
          ),
        );
      setActiveContact((prev) => (prev ? { ...prev, labels } : null));
      await fetchLabelCounts();
      toast.success("Label disinkronkan dari WhatsApp");
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Gagal sinkron dari WA");
    } finally {
      setLoadingLabels(false);
    }
  };

  const handleSyncWaHistory = async () => {
    const selectedStore = useChatStore.getState().selectedStore;
    if (!activeContact || !selectedStore) return;
    setSyncingWaHistory(true);
    try {
      const res = await api.post(
        `/chat/${selectedStore}/${encodeURIComponent(activeContact.contact_id)}/sync-wa`,
      );
      toast.success(
        res.data.count > 0
          ? `Berhasil sinkron ${res.data.count} pesan dari WA`
          : "Tidak ada pesan baru di WA",
      );
      await fetchMessages(activeContact.contact_id);
      setShowContactMenu(false);
    } catch (err: any) {
      toast.error(
        err.response?.data?.message || "Gagal sinkron riwayat dari WA",
      );
    } finally {
      setSyncingWaHistory(false);
    }
  };

  const handleGlobalSync = async () => {
    const selectedStore = useChatStore.getState().selectedStore;
    if (!selectedStore) return;
    if (
      !window.confirm(
        "Tarik SEMUA kontak dan chat aktif dari WhatsApp? Ini bisa memakan waktu beberapa saat.",
      )
    )
      return;
    setGlobalSyncProgress({
      status: "starting",
      message: "Memulai sinkronisasi global...",
    });
    try {
      await api.post(`/chat/${selectedStore}/sync-all-wa`);
      toast.success("Sinkronisasi global dimulai");
    } catch (err: any) {
      toast.error(
        err.response?.data?.message || "Gagal memulai sinkronisasi global",
      );
      setGlobalSyncProgress(null);
    }
  };

  const handleSweepUnanswered = async () => {
    const selectedStore = useChatStore.getState().selectedStore;
    if (!selectedStore) return;
    if (
      !window.confirm(
        "Bot AI akan menyapu bersih dan membalas otomatis SEMUA chat pelanggan (maks 2 hari terakhir) yang belum Anda balas. Apakah Anda yakin?",
      )
    )
      return;
    setGlobalSyncProgress({
      status: "starting",
      message: "Memulai Sapu Bersih AI...",
    });
    try {
      await api.post(`/chat/${selectedStore}/sweep-unanswered`);
      toast.success("Sapu Bersih AI dimulai di background!");
    } catch (err: any) {
      toast.error(
        err.response?.data?.message || "Gagal memulai Sapu Bersih AI",
      );
      setGlobalSyncProgress(null);
    }
  };

  const handleCreateLabel = async () => {
    const selectedStore = useChatStore.getState().selectedStore;
    if (!selectedStore || !newLabelName.trim()) return;
    setLoadingLabels(true);
    try {
      await api.post("/smart-label/" + selectedStore + "/create", {
        name: newLabelName.trim(),
        color: newLabelColor,
      });
      toast.success("Label dibuat di WhatsApp");
      setNewLabelName("");
      setNewLabelColor(0);
      const waRes = await api.get("/smart-label/" + selectedStore + "/wa-list");
      setWaLabelsList(waRes.data.labels || []);
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Gagal membuat label");
    } finally {
      setLoadingLabels(false);
    }
  };

  const handleEditLabel = async () => {
    const selectedStore = useChatStore.getState().selectedStore;
    if (!selectedStore || !editingLabelId || !editingLabelName.trim()) return;
    setLoadingLabels(true);
    try {
      await api.put("/smart-label/" + selectedStore + "/" + editingLabelId, {
        name: editingLabelName.trim(),
        color: editingLabelColor,
      });
      toast.success("Label diperbarui");
      setEditingLabelId(null);
      const waRes = await api.get("/smart-label/" + selectedStore + "/wa-list");
      setWaLabelsList(waRes.data.labels || []);
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Gagal mengedit label");
    } finally {
      setLoadingLabels(false);
    }
  };

  const handleDeleteLabel = async (labelId: string, labelName: string) => {
    const selectedStore = useChatStore.getState().selectedStore;
    if (!selectedStore) return;
    if (!window.confirm("Hapus label " + labelName + " dari WhatsApp?")) return;
    setLoadingLabels(true);
    try {
      await api.delete("/smart-label/" + selectedStore + "/" + labelId);
      toast.success("Label dihapus");
      const waRes = await api.get("/smart-label/" + selectedStore + "/wa-list");
      setWaLabelsList(waRes.data.labels || []);
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Gagal menghapus label");
    } finally {
      setLoadingLabels(false);
    }
  };

  const handleViewSummary = async () => {
    const selectedStore = useChatStore.getState().selectedStore;
    if (!activeContact || !selectedStore) return;
    setShowContactMenu(false);
    try {
      const encodedStore = encodeWAId(selectedStore);
      const encodedContact = encodeURIComponent(activeContact.contact_id);
      const res = await api.get(
        `/smart-labels/${encodedStore}/${encodedContact}`,
      );
      setContactSummary(
        res.data.summary || "Belum ada rekapan AI untuk kontak ini.",
      );
      setShowSummaryModal(true);
    } catch (err) {
      toast.error("Gagal memuat rekap");
    }
  };

  const handleCopyContactId = () => {
    if (!activeContact) return;
    navigator.clipboard.writeText(activeContact.contact_id);
    toast.success("ID kontak disalin");
    setShowContactMenu(false);
  };

  const handleSendReaction = async (waMessageId: string, emoji: string) => {
    const selectedStore = useChatStore.getState().selectedStore;
    if (!selectedStore) return;
    setShowReactionPicker(null);
    try {
      await api.post(`/chat/${selectedStore}/messages/reaction`, {
        messageId: waMessageId,
        emoji,
      });
      toast.success(`Reaksi ${emoji} terkirim`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Gagal mengirim reaksi");
    }
  };

  const handleForwardMessage = async () => {
    const selectedStore = useChatStore.getState().selectedStore;
    if (!selectedStore || !forwardTarget || !forwardMsgId) return;
    try {
      await api.post(`/chat/${selectedStore}/messages/forward`, {
        messageId: forwardMsgId,
        to: forwardTarget,
      });
      setShowForwardPicker(false);
      setForwardMsgId(null);
      setForwardTarget("");
      toast.success("Pesan diforward");
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Gagal forward pesan");
    }
  };

  const handleClearChat = async () => {
    const selectedStore = useChatStore.getState().selectedStore;
    if (!activeContact || !selectedStore) return;
    if (
      !confirm(
        `Hapus semua riwayat chat dengan ${getDisplayName(activeContact)}?`,
      )
    )
      return;
    setShowContactMenu(false);
    try {
      await api.delete(
        `/chat/${selectedStore}/${encodeURIComponent(activeContact.contact_id)}`,
      );
      setMessages([]);
      setActiveContact(null);
      setShowMobileChat(false);
      await fetchContacts();
      toast.success("Riwayat chat dihapus");
    } catch (err: any) {
      toast.error(
        err.response?.data?.message ||
          "Gagal menghapus chat (perlu role admin)",
      );
    }
  };

  const availableLabels = Object.keys(labelCounts).sort();

  const filteredContacts = useChatStore.getState().contacts.filter((c) => {
    const name = getDisplayName(c);
    if (!name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (chatFilter === "unread" && c.unread_count <= 0) return false;
    if (
      chatFilter === "label" &&
      selectedLabel &&
      !(c.labels || []).includes(selectedLabel)
    )
      return false;
    return true;
  });

  const unreadTotal = useChatStore
    .getState()
    .contacts.filter((c) => c.unread_count > 0).length;

  const renderMessage = (msg: ChatMessage) => {
    const canReply = !!msg.wa_message_id;
    const onReply = () => {
      if (!msg.wa_message_id) return;
      setReplyTo({
        wa_message_id: msg.wa_message_id,
        body: msg.body,
        is_from_me: msg.is_from_me,
        sender_name: msg.sender_name,
      });
    };

    if (!msg.is_from_me) {
      return (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          key={msg.id}
          className="group flex gap-3 max-w-[80%]"
        >
          <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center shrink-0 border border-slate-600 uppercase text-xs font-bold text-slate-300">
            {(msg.sender_name || "U").charAt(0)}
          </div>
          <div>
            <div
              className={`${msg.is_revoked ? "bg-slate-800/30 dark:bg-slate-100/30 border-slate-600/30 italic opacity-60" : "bg-slate-800/80 dark:bg-slate-100 border-slate-700 dark:border-slate-300"} border rounded-2xl rounded-tl-sm p-3 text-sm text-slate-200 dark:text-slate-700 shadow-sm shadow-black/20`}
              onDoubleClick={canReply && !msg.is_revoked ? onReply : undefined}
            >
              {!msg.is_revoked && <QuotedBlock msg={msg} />}
              <MessageBody body={msg.body} />
            </div>
            <div className="flex items-center gap-2 mt-1 ml-1">
              <span className="text-[10px] text-slate-500">
                {formatTime(msg.timestamp)}
              </span>
              {canReply && (
                <button
                  onClick={onReply}
                  className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-blue-400 transition-all"
                  title="Balas"
                >
                  <Reply className="w-3 h-3" />
                </button>
              )}
              {canReply && (
                <div className="relative">
                  <button
                    onClick={() =>
                      setShowReactionPicker(
                        showReactionPicker === msg.wa_message_id
                          ? null
                          : msg.wa_message_id || null,
                      )
                    }
                    className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-yellow-400 transition-all"
                    title="Reaksi"
                  >
                    <Smile className="w-3 h-3" />
                  </button>
                  {showReactionPicker === msg.wa_message_id && (
                    <div
                      data-reaction-picker
                      className="absolute bottom-full left-0 mb-1 flex gap-1 bg-slate-800 border border-slate-600 rounded-xl p-1.5 z-20 shadow-xl"
                    >
                      {["👍", "❤️", "😂", "😮", "😢", "🙏"].map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() =>
                            handleSendReaction(msg.wa_message_id!, emoji)
                          }
                          className="hover:scale-125 transition-transform text-sm"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {canReply && (
                <button
                  onClick={() => {
                    setShowForwardPicker(true);
                    setForwardMsgId(msg.wa_message_id || null);
                    setForwardTarget("");
                  }}
                  className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-emerald-400 transition-all"
                  title="Forward"
                >
                  <Share2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </motion.div>
      );
    }

    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        key={msg.id}
        className="group flex gap-3 max-w-[80%] ml-auto flex-row-reverse"
      >
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${msg.sender_name === "CS Manual" ? "bg-purple-500/20 text-purple-400 border-purple-500/30" : "bg-blue-500/20 text-blue-400 border-blue-500/30"}`}
        >
          {msg.sender_name === "CS Manual" ? (
            <User className="w-4 h-4" />
          ) : (
            <Bot className="w-4 h-4" />
          )}
        </div>
        <div>
          <div
            className="bg-blue-600 rounded-2xl rounded-tr-sm p-3 text-sm text-white shadow-sm shadow-blue-900/20"
            onDoubleClick={canReply ? onReply : undefined}
          >
            <QuotedBlock msg={msg} />
            <MessageBody body={msg.body} />
          </div>
          <div className="flex items-center justify-end gap-1 mt-1 mr-1">
            {canReply && (
              <button
                onClick={onReply}
                className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-blue-400 transition-all mr-1"
                title="Balas"
              >
                <Reply className="w-3 h-3" />
              </button>
            )}
            {canReply && (
              <div className="relative mr-1">
                <button
                  onClick={() =>
                    setShowReactionPicker(
                      showReactionPicker === msg.wa_message_id
                        ? null
                        : msg.wa_message_id || null,
                    )
                  }
                  className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-yellow-400 transition-all"
                  title="Reaksi"
                >
                  <Smile className="w-3 h-3" />
                </button>
                {showReactionPicker === msg.wa_message_id && (
                  <div
                    data-reaction-picker
                    className="absolute bottom-full right-0 mb-1 flex gap-1 bg-slate-800 border border-slate-600 rounded-xl p-1.5 z-20 shadow-xl"
                  >
                    {["👍", "❤️", "😂", "😮", "😢", "🙏"].map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() =>
                          handleSendReaction(msg.wa_message_id!, emoji)
                        }
                        className="hover:scale-125 transition-transform text-sm"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {canReply && (
              <button
                onClick={() => {
                  setShowForwardPicker(true);
                  setForwardMsgId(msg.wa_message_id || null);
                  setForwardTarget("");
                }}
                className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-emerald-400 transition-all mr-1"
                title="Forward"
              >
                <Share2 className="w-3 h-3" />
              </button>
            )}
            <span className="text-[10px] text-slate-500">
              {formatTime(msg.timestamp)} • {msg.sender_name}
            </span>
            {msg.is_read ? (
              <CheckCheck className="w-3 h-3 text-blue-400" />
            ) : (
              <Check className="w-3 h-3 text-slate-500" />
            )}
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="h-full flex flex-col -mx-4 lg:-mx-8 -my-4 lg:-my-8 relative overflow-hidden bg-[#09090b] dark:bg-white">
      <div className="absolute top-[20%] left-[50%] w-[30vw] h-[30vw] rounded-full bg-blue-600/5 blur-[120px] pointer-events-none" />

      <div className="flex h-full relative z-10">
        {/* Sidebar Contacts */}
        <div
          className={`${showMobileChat ? "hidden md:flex" : "flex"} w-full md:w-80 lg:w-96 flex-col bg-slate-900/40 dark:bg-white border-r border-slate-800/50 dark:border-slate-200 backdrop-blur-xl shrink-0 h-[calc(100vh-64px)] lg:h-screen`}
        >
          <div className="p-4 border-b border-slate-800/50 dark:border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-white dark:text-slate-900">
                Chats
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleGlobalSync}
                  disabled={!!globalSyncProgress}
                  className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                  title="Tarik Semua Chat WA"
                >
                  <RotateCw
                    className={`w-4 h-4 ${globalSyncProgress ? "animate-spin" : ""}`}
                  />
                </button>
                <button
                  onClick={handleSweepUnanswered}
                  disabled={!!globalSyncProgress}
                  className="p-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-colors"
                  title="Sapu Bersih AI (Balas Chat Tertunda)"
                >
                  <Bot className="w-4 h-4" />
                </button>
                <button
                  onClick={() => fetchContacts()}
                  disabled={loadingContacts}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors"
                  title="Refresh"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${loadingContacts ? "animate-spin" : ""}`}
                  />
                </button>
                <select
                  value={useChatStore.getState().selectedStore}
                  onChange={(e) => {
                    useChatStore.getState().setSelectedStore(e.target.value);
                    setActiveContact(null);
                    setMessages([]);
                    setShowMobileChat(false);
                    setChatFilter("all");
                    setSelectedLabel("");
                  }}
                  className="bg-slate-800 dark:bg-slate-100 border border-slate-700 dark:border-slate-300 text-xs text-white dark:text-slate-900 rounded-lg px-2 py-1 outline-none focus:border-blue-500 max-w-[140px] truncate"
                >
                  {stores.map((s) => (
                    <option key={s.wa_id} value={s.wa_id}>
                      {s.name || s.wa_id}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Filter tabs — seperti WA */}
            <div className="flex gap-1 overflow-x-auto custom-scrollbar pb-0.5">
              {[
                { id: "all" as ChatFilter, label: "Semua" },
                {
                  id: "unread" as ChatFilter,
                  label: `Belum dibaca${unreadTotal > 0 ? ` (${unreadTotal})` : ""}`,
                },
                { id: "label" as ChatFilter, label: "Label" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setChatFilter(tab.id);
                    if (tab.id !== "label") setSelectedLabel("");
                  }}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${chatFilter === tab.id ? "bg-blue-600 text-white" : "bg-slate-800/60 text-slate-400 hover:text-slate-200"}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Global Sync Progress */}
            {globalSyncProgress && (
              <div className="bg-emerald-900/40 border border-emerald-500/30 rounded-lg p-2 flex flex-col gap-1.5">
                <div className="flex justify-between items-center text-xs text-emerald-300">
                  <span className="font-medium truncate pr-2">
                    {globalSyncProgress.message}
                  </span>
                  {globalSyncProgress.current !== undefined &&
                    globalSyncProgress.total !== undefined && (
                      <span>
                        {Math.round(
                          (globalSyncProgress.current /
                            globalSyncProgress.total) *
                            100,
                        )}
                        %
                      </span>
                    )}
                </div>
                {globalSyncProgress.current !== undefined &&
                  globalSyncProgress.total !== undefined && (
                    <div className="w-full bg-slate-800 rounded-full h-1">
                      <div
                        className="bg-emerald-400 h-1 rounded-full transition-all duration-300"
                        style={{
                          width: `${(globalSyncProgress.current / globalSyncProgress.total) * 100}%`,
                        }}
                      ></div>
                    </div>
                  )}
              </div>
            )}

            {/* Label picker */}
            {chatFilter === "label" && (
              <div className="flex gap-1 flex-wrap">
                {availableLabels.length === 0 ? (
                  <span className="text-xs text-slate-500">
                    Belum ada label
                  </span>
                ) : (
                  availableLabels.map((label) => (
                    <button
                      key={label}
                      onClick={() =>
                        setSelectedLabel(selectedLabel === label ? "" : label)
                      }
                      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all flex items-center gap-1 ${selectedLabel === label ? "bg-emerald-600 text-white" : "bg-slate-800/60 text-slate-400 hover:text-slate-200"}`}
                    >
                      <Tag className="w-3 h-3" />
                      {label} ({labelCounts[label]})
                    </button>
                  ))
                )}
              </div>
            )}

            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-blue-400 transition-colors" />
              <input
                type="text"
                placeholder="Cari nama kontak..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-950/50 dark:bg-slate-50 border border-slate-700/50 dark:border-slate-300 rounded-xl py-2 pl-9 pr-4 text-sm text-slate-200 dark:text-slate-700 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
            {loadingContacts ? (
              <div className="flex justify-center p-4">
                <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredContacts.length === 0 ? (
              <p className="text-center text-sm text-slate-500 py-8">
                {chatFilter === "unread"
                  ? "Tidak ada chat belum dibaca"
                  : chatFilter === "label" && selectedLabel
                    ? `Tidak ada kontak dengan label "${selectedLabel}"`
                    : "Tidak ada kontak"}
              </p>
            ) : (
              filteredContacts.map((chat, i) => {
                const displayName = getDisplayName(chat);
                const isActive = activeContact?.contact_id === chat.contact_id;
                return (
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.03, 0.3) }}
                    key={chat.contact_id}
                    onClick={() => handleSelectContact(chat)}
                    className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${isActive ? "bg-blue-500/10 border border-blue-500/20" : "hover:bg-slate-800/50 border border-transparent"}`}
                  >
                    <div className="relative shrink-0">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center text-lg font-bold text-slate-300 uppercase">
                        {displayName.charAt(0)}
                      </div>
                      {chat.unread_count > 0 && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-slate-900">
                          {chat.unread_count}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline mb-0.5">
                        <h4
                          className={`text-sm font-semibold truncate ${chat.unread_count > 0 ? "text-white" : "text-slate-300"}`}
                        >
                          {displayName}
                        </h4>
                        <span
                          className={`text-xs shrink-0 ml-2 ${chat.unread_count > 0 ? "text-blue-400 font-medium" : "text-slate-500"}`}
                        >
                          {chat.last_seen ? formatTime(chat.last_seen) : ""}
                        </span>
                      </div>
                      <p
                        className={`text-xs truncate ${chat.unread_count > 0 ? "text-slate-300 font-medium" : "text-slate-500"}`}
                      >
                        {formatPreview(chat.last_message)}
                      </p>
                      {(chat.labels || []).length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {(chat.labels || []).slice(0, 2).map((l) => (
                            <span
                              key={l}
                              className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            >
                              {l}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })
            )}

            {hasMoreContacts && (
              <div
                ref={loadMoreContactsRef}
                className="h-10 flex items-center justify-center"
              >
                {loadingMoreContacts && (
                  <div className="w-5 h-5 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Chat Area */}
        <div
          className={`${showMobileChat ? "flex" : "hidden md:flex"} flex-1 flex-col h-[calc(100vh-64px)] lg:h-screen`}
        >
          {activeContact ? (
            <>
              {/* Header */}
              <div className="h-16 px-4 md:px-6 border-b border-slate-800/50 dark:border-slate-200 bg-slate-900/40 dark:bg-white backdrop-blur-xl flex justify-between items-center shrink-0">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowMobileChat(false)}
                    className="md:hidden p-1.5 rounded-lg hover:bg-slate-800 text-slate-400"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center font-bold text-white uppercase">
                    {getDisplayName(activeContact).charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-bold text-white dark:text-slate-900 text-sm">
                      {getDisplayName(activeContact)}
                    </h3>
                    <p className="text-[10px] text-slate-500">
                      {resolvedPhone
                        ? `+${resolvedPhone}`
                        : (activeContact as any).contact_phone
                          ? `+${(activeContact as any).contact_phone}`
                          : formatPhoneDisplay(activeContact.contact_id)}
                    </p>
                    <p className="text-xs font-medium flex items-center gap-1 mt-0.5">
                      {activeContact.is_bot_paused ? (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          <span className="text-amber-400">AI Paused</span>
                        </>
                      ) : (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          <span className="text-emerald-400">AI Active</span>
                        </>
                      )}
                      {(activeContact.labels || []).length > 0 && (
                        <span className="text-slate-500 ml-1">
                          • {(activeContact.labels || []).join(", ")}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleToggleBot}
                    disabled={togglingBot}
                    title={
                      activeContact.is_bot_paused
                        ? "Aktifkan AI"
                        : "Pause AI 30 menit"
                    }
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${activeContact.is_bot_paused ? "bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30" : "bg-amber-600/20 text-amber-400 hover:bg-amber-600/30"}`}
                  >
                    {activeContact.is_bot_paused ? (
                      <Play className="w-3.5 h-3.5" />
                    ) : (
                      <Pause className="w-3.5 h-3.5" />
                    )}
                    <span className="hidden sm:inline">
                      {activeContact.is_bot_paused ? "Aktifkan AI" : "Pause AI"}
                    </span>
                  </button>
                  <button
                    onClick={handleRequestPhone}
                    disabled={requestingPhone}
                    title="Resolve / minta nomor asli (untuk kontak LID)"
                    className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 hover:text-emerald-400 transition-colors disabled:opacity-50"
                  >
                    <Phone
                      className={`w-4 h-4 ${requestingPhone ? "animate-pulse" : ""}`}
                    />
                  </button>
                  <div className="relative" ref={menuRef}>
                    <button
                      onClick={() => setShowContactMenu((v) => !v)}
                      title="Menu kontak"
                      className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                    <AnimatePresence>
                      {showContactMenu && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95, y: -4 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: -4 }}
                          className="absolute right-0 top-full mt-2 w-52 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden"
                        >
                          <button
                            onClick={openLabelModal}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-800 transition-colors"
                          >
                            <Tag className="w-4 h-4 text-emerald-400" /> Kelola
                            Label
                          </button>
                          <button
                            onClick={handleSyncLabelsFromWa}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-800 transition-colors"
                          >
                            <RotateCw className="w-4 h-4 text-blue-400" />{" "}
                            Sinkron Label dari WA
                          </button>
                          <button
                            onClick={handleSyncWaHistory}
                            disabled={syncingWaHistory}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-50"
                          >
                            {syncingWaHistory ? (
                              <div className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <RotateCw className="w-4 h-4 text-green-400" />
                            )}
                            Tarik Riwayat WA
                          </button>
                          <button
                            onClick={handleViewSummary}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-800 transition-colors"
                          >
                            <FileText className="w-4 h-4 text-purple-400" />{" "}
                            Lihat Rekap AI
                          </button>
                          <button
                            onClick={handleCopyContactId}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-800 transition-colors"
                          >
                            <Copy className="w-4 h-4 text-slate-400" /> Salin ID
                            Kontak
                          </button>
                          <div className="border-t border-slate-700" />
                          <button
                            onClick={handleClearChat}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" /> Hapus Riwayat Chat
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>

              {/* Messages Area (Virtuoso) */}
              <div className="flex-1 bg-transparent px-2 md:px-6 py-2 flex flex-col">
                {/* Reconnect Warning Banner */}
                <ReconnectWarning lastReconnect={lastReconnectTime} />

                {loadingMessages ? (
                  <div className="flex justify-center h-full items-center">
                    <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <Virtuoso
                    className="h-full custom-scrollbar"
                    data={messages}
                    firstItemIndex={firstItemIndex}
                    initialTopMostItemIndex={
                      messages.length > 0
                        ? messages.length - 1 + firstItemIndex
                        : 0
                    }
                    startReached={loadOlderMessages}
                    components={{
                      Header: () =>
                        loadingOlder ? (
                          <div className="flex justify-center py-3">
                            <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                          </div>
                        ) : (
                          <div className="h-4" />
                        ),
                      Footer: () => <div className="h-4" />,
                    }}
                    itemContent={(_, msg) => (
                      <div className="py-1">{renderMessage(msg)}</div>
                    )}
                    followOutput="auto"
                    alignToBottom
                  />
                )}
              </div>

              {/* Reply banner */}
              <AnimatePresence>
                {replyTo && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="px-4 pt-2 bg-slate-900/60 border-t border-slate-800/50"
                  >
                    <div className="flex items-center gap-2 bg-slate-800/50 rounded-xl px-3 py-2">
                      <Reply className="w-4 h-4 text-blue-400 shrink-0" />
                      <div className="flex-1 min-w-0 border-l-2 border-blue-400 pl-2">
                        <p className="text-xs font-semibold text-blue-400">
                          {replyTo.sender_name}
                        </p>
                        <p className="text-xs text-slate-400 truncate">
                          {formatPreview(replyTo.body)}
                        </p>
                      </div>
                      <button
                        onClick={() => setReplyTo(null)}
                        className="text-slate-500 hover:text-white p-1"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Input */}
              <div className="p-4 bg-slate-900/40 dark:bg-white backdrop-blur-xl border-t border-slate-800/50 dark:border-slate-200">
                <div className="relative flex items-end gap-2 bg-slate-950/50 dark:bg-slate-50 border border-slate-700/50 dark:border-slate-300 rounded-2xl p-2 focus-within:border-blue-500/50 transition-colors">
                  <button
                    onClick={() => {
                      setShowMediaPicker(true);
                      fetchMediaAssets();
                    }}
                    disabled={sending}
                    className="shrink-0 p-2 rounded-xl text-slate-400 hover:text-blue-400 hover:bg-slate-800 transition-colors"
                    title="Kirim media dari katalog"
                  >
                    <Paperclip className="w-5 h-5" />
                  </button>
                  <textarea
                    rows={1}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    className="w-full bg-transparent text-sm text-slate-200 dark:text-slate-700 placeholder-slate-500 focus:outline-none resize-none py-2 px-1 custom-scrollbar max-h-32"
                    placeholder="Ketik pesan manual untuk takeover..."
                  />
                  <button
                    onClick={handleSend}
                    disabled={sending || !inputText.trim()}
                    className="shrink-0 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl px-4 py-2 text-sm font-medium transition-all shadow-lg shadow-blue-500/20 active:scale-95"
                  >
                    {sending ? "..." : "Send"}
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 text-center mt-2">
                  Kirim pesan/media manual akan otomatis pause AI selama 30
                  menit. Double-click pesan untuk reply.
                </p>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
              <MessageSquare className="w-16 h-16 mb-4 opacity-20" />
              <p>Pilih kontak untuk melihat percakapan</p>
            </div>
          )}
        </div>
      </div>

      {/* Media Picker Modal */}
      <AnimatePresence>
        {showMediaPicker && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setShowMediaPicker(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-slate-700">
                <h3 className="font-bold text-white flex items-center gap-2">
                  <ImageIcon className="w-5 h-5 text-blue-400" />
                  Pilih Media Katalog
                </h3>
                <button
                  onClick={() => setShowMediaPicker(false)}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
                {loadingMedia ? (
                  <div className="flex justify-center py-8">
                    <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : mediaAssets.length === 0 ? (
                  <p className="text-center text-slate-500 py-8 text-sm">
                    Tidak ada media terdaftar untuk agen toko ini.
                    <br />
                    Upload di menu Media Gallery.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {mediaAssets.map((asset) => (
                      <button
                        key={asset.id}
                        onClick={() => handleSendMedia(asset)}
                        disabled={sending}
                        className="group relative rounded-xl overflow-hidden border border-slate-700 hover:border-blue-500 transition-all text-left"
                      >
                        {asset.type === "video" ? (
                          <div className="aspect-video bg-slate-800 flex items-center justify-center">
                            <Video className="w-8 h-8 text-slate-500 group-hover:text-blue-400" />
                          </div>
                        ) : (
                          <img
                            src={`${UPLOAD_BASE}/uploads/${asset.filename}`}
                            alt={asset.label}
                            className="aspect-video object-cover w-full"
                            loading="lazy"
                          />
                        )}
                        <div className="p-2 bg-slate-800/90">
                          <p className="text-xs font-semibold text-white truncate">
                            {asset.label}
                          </p>
                          {asset.description && (
                            <p className="text-[10px] text-slate-400 truncate">
                              {asset.description}
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Label Manager Modal */}
      <AnimatePresence>
        {showLabelModal && activeContact && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setShowLabelModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-slate-700">
                <h3 className="font-bold text-white flex items-center gap-2">
                  <Tag className="w-5 h-5 text-emerald-400" />
                  Kelola Label — {getDisplayName(activeContact)}
                </h3>
                <button
                  onClick={() => setShowLabelModal(false)}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 space-y-4">
                <p className="text-xs text-slate-500">
                  Label disinkronkan ke WhatsApp Business. Tap untuk
                  tambah/hapus.
                </p>
                {loadingLabels ? (
                  <div className="flex justify-center py-6">
                    <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : waLabelsList.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-4">
                    Tidak ada label di WA Business. Buat label dulu di aplikasi
                    WhatsApp.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {waLabelsList.map((lbl) => {
                      const active = editingLabels.includes(lbl.name);
                      return (
                        <button
                          key={lbl.id}
                          onClick={() => toggleLabelSelection(lbl.name)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${active ? "bg-emerald-600/20 border-emerald-500 text-emerald-300" : "bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500"}`}
                          style={
                            lbl.hexColor && active
                              ? { borderColor: lbl.hexColor }
                              : undefined
                          }
                        >
                          {lbl.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                <button
                  onClick={() => {
                    setShowLabelManager(true);
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2 text-xs text-purple-400 hover:text-purple-300 transition-colors border-t border-slate-700 pt-3 mt-2"
                >
                  <Tag className="w-3.5 h-3.5" />
                  Kelola Label WA (Buat/Edit/Hapus)
                </button>
                <button
                  onClick={handleSyncLabelsFromWa}
                  disabled={loadingLabels}
                  className="w-full flex items-center justify-center gap-2 py-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <RotateCw
                    className={`w-3.5 h-3.5 ${loadingLabels ? "animate-spin" : ""}`}
                  />
                  Tarik label terbaru dari WhatsApp
                </button>
              </div>
              <div className="flex gap-2 p-4 border-t border-slate-700">
                <button
                  onClick={() => setShowLabelModal(false)}
                  className="flex-1 py-2 rounded-xl text-sm text-slate-400 hover:bg-slate-800 transition-colors"
                >
                  Batal
                </button>
                <button
                  onClick={handleSaveLabels}
                  disabled={savingLabels}
                  className="flex-1 py-2 rounded-xl text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50"
                >
                  {savingLabels ? "Menyimpan..." : "Simpan ke WA"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Forward Message Modal */}
      <AnimatePresence>
        {showForwardPicker && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => {
              setShowForwardPicker(false);
              setForwardMsgId(null);
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-slate-700">
                <h3 className="font-bold text-white flex items-center gap-2">
                  <Share2 className="w-5 h-5 text-emerald-400" />
                  Forward Pesan
                </h3>
                <button
                  onClick={() => {
                    setShowForwardPicker(false);
                    setForwardMsgId(null);
                  }}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-xs text-slate-400">
                  Masukkan ID kontak tujuan (contoh: 62812xxxx@c.us)
                </p>
                <input
                  type="text"
                  value={forwardTarget}
                  onChange={(e) => setForwardTarget(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleForwardMessage()}
                  placeholder="62812xxxx@c.us"
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  autoFocus
                />
              </div>
              <div className="flex gap-2 p-4 border-t border-slate-700">
                <button
                  onClick={() => {
                    setShowForwardPicker(false);
                    setForwardMsgId(null);
                  }}
                  className="flex-1 py-2 rounded-xl text-sm text-slate-400 hover:bg-slate-800 transition-colors"
                >
                  Batal
                </button>
                <button
                  onClick={handleForwardMessage}
                  disabled={!forwardTarget.trim()}
                  className="flex-1 py-2 rounded-xl text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50"
                >
                  Forward
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Label Manager Modal — CRUD label WA */}
      <AnimatePresence>
        {showLabelManager && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => {
              setShowLabelManager(false);
              setEditingLabelId(null);
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-slate-700">
                <h3 className="font-bold text-white flex items-center gap-2">
                  <Tag className="w-5 h-5 text-purple-400" />
                  Kelola Label WhatsApp
                </h3>
                <button
                  onClick={() => {
                    setShowLabelManager(false);
                    setEditingLabelId(null);
                  }}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
                {/* Create new label */}
                <div className="bg-slate-800/50 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-medium text-slate-400">
                    Buat Label Baru
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newLabelName}
                      onChange={(e) => setNewLabelName(e.target.value)}
                      placeholder="Nama label..."
                      className="flex-1 bg-slate-950/50 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                    />
                    <select
                      value={newLabelColor}
                      onChange={(e) => setNewLabelColor(Number(e.target.value))}
                      className="bg-slate-950/50 border border-slate-600 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
                    >
                      {Array.from({ length: 20 }, (_, i) => (
                        <option key={i} value={i}>
                          Warna {i}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleCreateLabel}
                      disabled={loadingLabels || !newLabelName.trim()}
                      className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors"
                    >
                      Buat
                    </button>
                  </div>
                </div>

                {/* List existing labels */}
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-2">
                    Label Terdaftar di WA
                  </p>
                  {waLabelsList.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-4">
                      Belum ada label.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {waLabelsList.map((lbl: WaLabel) => {
                        const isProtected =
                          lbl.name === "Closing" || lbl.name === "Cancel";
                        return editingLabelId === lbl.id ? (
                          <div
                            key={lbl.id}
                            className="flex gap-2 items-center bg-slate-800 rounded-lg p-2"
                          >
                            <input
                              type="text"
                              value={editingLabelName}
                              onChange={(e) =>
                                setEditingLabelName(e.target.value)
                              }
                              className="flex-1 bg-slate-950/50 border border-slate-600 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-purple-500"
                              autoFocus
                            />
                            <select
                              value={editingLabelColor}
                              onChange={(e) =>
                                setEditingLabelColor(Number(e.target.value))
                              }
                              className="bg-slate-950/50 border border-slate-600 rounded-lg px-1 py-1 text-xs text-white"
                            >
                              {Array.from({ length: 20 }, (_, i) => (
                                <option key={i} value={i}>
                                  W{i}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={handleEditLabel}
                              disabled={loadingLabels}
                              className="px-2 py-1 bg-emerald-600 text-white rounded text-xs font-medium"
                            >
                              Simpan
                            </button>
                            <button
                              onClick={() => setEditingLabelId(null)}
                              className="px-2 py-1 bg-slate-600 text-white rounded text-xs"
                            >
                              Batal
                            </button>
                          </div>
                        ) : (
                          <div
                            key={lbl.id}
                            className="flex items-center justify-between bg-slate-800/50 rounded-lg px-3 py-2"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-white">
                                {lbl.name}
                              </span>
                              <span className="text-xs text-slate-500">
                                Warna {lbl.color ?? "-"}
                              </span>
                              {isProtected && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                  🔒 Protected
                                </span>
                              )}
                            </div>
                            <div className="flex gap-1">
                              <button
                                onClick={() => {
                                  setEditingLabelId(lbl.id);
                                  setEditingLabelName(lbl.name);
                                  setEditingLabelColor(lbl.color ?? 0);
                                }}
                                className="px-2 py-1 text-xs text-blue-400 hover:bg-slate-700 rounded transition-colors"
                              >
                                Edit
                              </button>
                              {!isProtected && (
                                <button
                                  onClick={() =>
                                    handleDeleteLabel(lbl.id, lbl.name)
                                  }
                                  className="px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 rounded transition-colors"
                                >
                                  Hapus
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="p-4 border-t border-slate-700">
                <button
                  onClick={() => {
                    setShowLabelManager(false);
                    setEditingLabelId(null);
                  }}
                  className="w-full py-2 rounded-xl text-sm text-slate-400 hover:bg-slate-800 transition-colors"
                >
                  Tutup
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI Summary Modal */}
      <AnimatePresence>
        {showSummaryModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setShowSummaryModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-slate-700">
                <h3 className="font-bold text-white flex items-center gap-2">
                  <FileText className="w-5 h-5 text-purple-400" />
                  Rekap AI
                </h3>
                <button
                  onClick={() => setShowSummaryModal(false)}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
                <pre className="text-sm text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">
                  {contactSummary}
                </pre>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ChatManagement;
