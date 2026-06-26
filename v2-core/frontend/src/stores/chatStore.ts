import { create } from "zustand";

export interface ChatContact {
  contact_id: string;
  sender_name: string;
  contact_display_name: string;
  last_message: string;
  last_seen: string;
  unread_count: number;
  is_bot_paused: boolean;
  paused_until: string | null;
  labels?: string[];
}

export interface ChatMessage {
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

interface ChatState {
  selectedStore: string;
  contacts: ChatContact[];
  activeContact: ChatContact | null;
  messages: ChatMessage[];
  loadingContacts: boolean;
  loadingMessages: boolean;
  hasMoreMessages: boolean;
  typingContact: string | null;
  lastReconnectTime: Date | null;

  // Actions
  setSelectedStore: (storeId: string) => void;
  setContacts: (
    contacts: ChatContact[] | ((prev: ChatContact[]) => ChatContact[]),
  ) => void;
  setActiveContact: (
    contact:
      | ChatContact
      | null
      | ((prev: ChatContact | null) => ChatContact | null),
  ) => void;
  setMessages: (
    messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
  ) => void;
  setLoadingContacts: (loading: boolean) => void;
  setLoadingMessages: (loading: boolean) => void;
  setHasMoreMessages: (hasMore: boolean) => void;
  setTypingContact: (
    contactId: string | null | ((prev: string | null) => string | null),
  ) => void;
  setLastReconnectTime: (time: Date | null) => void;

  // Specific Actions
  addMessage: (msg: ChatMessage) => void;
  updateContactLabels: (contactId: string, labels: string[]) => void;
  updateContactUnread: (contactId: string, unreadCount: number) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  selectedStore: "",
  contacts: [],
  activeContact: null,
  messages: [],
  loadingContacts: false,
  loadingMessages: false,
  hasMoreMessages: false,
  typingContact: null,
  lastReconnectTime: null,

  setSelectedStore: (storeId) => set({ selectedStore: storeId }),

  setContacts: (updater) =>
    set((state) => ({
      contacts:
        typeof updater === "function" ? updater(state.contacts) : updater,
    })),

  setActiveContact: (updater) =>
    set((state) => ({
      activeContact:
        typeof updater === "function" ? updater(state.activeContact) : updater,
    })),

  setMessages: (updater) =>
    set((state) => ({
      messages:
        typeof updater === "function" ? updater(state.messages) : updater,
    })),

  setLoadingContacts: (loading) => set({ loadingContacts: loading }),
  setLoadingMessages: (loading) => set({ loadingMessages: loading }),
  setHasMoreMessages: (hasMore) => set({ hasMoreMessages: hasMore }),
  setLastReconnectTime: (time) => set({ lastReconnectTime: time }),

  setTypingContact: (updater) =>
    set((state) => ({
      typingContact:
        typeof updater === "function" ? updater(state.typingContact) : updater,
    })),

  addMessage: (msg) =>
    set((state) => {
      const exists = state.messages.some(
        (m) => m.id === msg.id || m.wa_message_id === msg.wa_message_id,
      );
      if (exists) return state; // Don't add duplicate
      return { messages: [...state.messages, msg] };
    }),

  updateContactLabels: (contactId, labels) =>
    set((state) => {
      const newContacts = state.contacts.map((c) =>
        c.contact_id === contactId ? { ...c, labels } : c,
      );
      const newActive =
        state.activeContact?.contact_id === contactId
          ? { ...state.activeContact, labels }
          : state.activeContact;
      return { contacts: newContacts, activeContact: newActive };
    }),

  updateContactUnread: (contactId, unreadCount) =>
    set((state) => ({
      contacts: state.contacts.map((c) =>
        c.contact_id === contactId ? { ...c, unread_count: unreadCount } : c,
      ),
    })),
}));
