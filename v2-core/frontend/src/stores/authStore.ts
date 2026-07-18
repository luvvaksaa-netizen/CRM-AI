import { create } from 'zustand';

const TOKEN_KEY = 'crm_token';
const USER_KEY = 'crm_user';
const API_BASE = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' && window.location.origin !== 'null' ? window.location.origin + '/api' : 'http://localhost:3002/api');

interface AuthState {
  token: string | null;
  user: any | null;
  initialized: boolean;
  initialize: () => Promise<boolean>;
  setAuth: (token: string, user: any) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: sessionStorage.getItem(TOKEN_KEY),
  user: JSON.parse(sessionStorage.getItem(USER_KEY) || 'null'),
  initialized: false,

  initialize: async () => {
    // Try sessionStorage dulu, fallback ke localStorage (cross-tab persistence)
    let token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) {
      token = localStorage.getItem(TOKEN_KEY);
      if (token) {
        // Restore dari localStorage ke sessionStorage
        sessionStorage.setItem(TOKEN_KEY, token);
        const user = localStorage.getItem(USER_KEY);
        if (user) sessionStorage.setItem(USER_KEY, user);
      }
    }
    if (!token) {
      set({ initialized: true });
      return false;
    }

    try {
      const res = await fetch(`${API_BASE}/auth/session`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        // Token expired or invalid — clear and return false
        sessionStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(USER_KEY);
        set({ token: null, user: null, initialized: true });
        return false;
      }

      // Token valid
      set({ initialized: true });
      return true;
    } catch {
      // Network error — keep token, assume it might still be valid
      set({ initialized: true });
      return true; // don't log out on network errors
    }
  },

  setAuth: (token, user) => {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    // Backup ke localStorage untuk cross-tab persistence
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch (_) {}
    set({ token, user });
  },

  logout: () => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    set({ token: null, user: null });
  },
}));
