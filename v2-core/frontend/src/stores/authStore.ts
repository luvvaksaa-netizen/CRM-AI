import { create } from 'zustand';

const TOKEN_KEY = 'crm_token';
const USER_KEY = 'crm_user';
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3002/api';

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
    const token = sessionStorage.getItem(TOKEN_KEY);
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
    set({ token, user });
  },

  logout: () => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    set({ token: null, user: null });
  },
}));
