import { create } from 'zustand';

const TOKEN_KEY = 'crm_token';
const USER_KEY = 'crm_user';

// API_BASE dihitung saat runtime, BUKAN build time
// Mencegah Vite meng-inline localhost:3002 ke production bundle
function resolveApiBase(): string {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace(/\/?$/, '');
  }
  if (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null') {
    return window.location.origin + '/api';
  }
  return '/api';
}

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
      const res = await fetch(`${resolveApiBase()}/auth/session`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        sessionStorage.setItem(USER_KEY, JSON.stringify(data.user));
        set({ token, user: data.user, initialized: true });
        return true;
      }
      // Token invalid — clear
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      set({ token: null, user: null, initialized: true });
      return false;
    } catch {
      // Network error — assume token might still be valid, keep it
      set({ initialized: true });
      return true; // Jangan logout saat network error sementara
    }
  },

  setAuth: (token: string, user: any) => {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
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
