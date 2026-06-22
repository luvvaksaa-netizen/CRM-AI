import axios from 'axios';
import toast from 'react-hot-toast';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 30000, // 30 detik (was 12s, increased for slow connections)
});

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('crm_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status;
    // Jangan intercept request ke /auth/login agar login page bisa berjalan normal
    const url = error.config?.url || '';
    if (url.includes('/auth/login')) {
      return Promise.reject(error);
    }

    if (status === 401) {
      // Retry sekali dengan token dari localStorage (cross-tab recovery)
      const retryCount = error.config?._retryCount || 0;
      if (retryCount < 1) {
        error.config._retryCount = retryCount + 1;
        // Coba dapatkan token dari localStorage sebagai fallback
        const localToken = localStorage.getItem('crm_token');
        const currentToken = error.config?.headers?.Authorization?.toString().replace('Bearer ', '') || '';
        
        // Hanya retry jika token di localStorage BEDA dengan token yang baru saja gagal (mencegah infinite loop axios)
        if (localToken && localToken !== currentToken) {
          error.config.headers.Authorization = `Bearer ${localToken}`;
          return api(error.config);
        }
      }
      
      // 401 = token benar-benar expired / tidak valid
      if (!window.location.pathname.includes('/login')) {
        // Simpan current path agar bisa redirect setelah login
        const currentPath = window.location.pathname;
        if (currentPath !== '/login') {
          sessionStorage.setItem('redirectAfterLogin', currentPath);
        }
        sessionStorage.removeItem('crm_token');
        sessionStorage.removeItem('crm_user');
        localStorage.removeItem('crm_token');
        localStorage.removeItem('crm_user');
        toast.error('Sesi berakhir. Silakan login kembali.', { id: 'session-expired' });
        // Gunakan navigate daripada window.location untuk SPA
        setTimeout(() => {
          window.location.href = '/login';
        }, 1500);
      }
    } else if (status === 403) {
      toast.error('Akses ditolak. Anda tidak memiliki izin untuk tindakan ini.', { id: 'access-denied' });
    } else if (status === 429) {
      // Rate limited — jangan retry, tapi beri tahu user
      toast.error('Terlalu banyak permintaan. Tunggu sebentar.', { id: 'rate-limited', duration: 5000 });
    }

    return Promise.reject(error);
  }
);

export default api;

