import axios from 'axios';
import toast from 'react-hot-toast';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3002/api',
  timeout: 12000, // 12 detik
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
  (error) => {
    const status = error.response?.status;
    // Jangan intercept request ke /auth/login agar login page bisa berjalan normal
    const url = error.config?.url || '';
    if (url.includes('/auth/login')) {
      return Promise.reject(error);
    }

    if (status === 401) {
      // 401 = token expired / tidak ada → logout
      // Cegah multiple redirect dengan cek apakah sudah di halaman login
      if (!window.location.pathname.includes('/login')) {
        sessionStorage.removeItem('crm_token');
        sessionStorage.removeItem('crm_user');
        localStorage.removeItem('crm_token');
        localStorage.removeItem('crm_user');
        toast.error('Sesi berakhir. Silakan login kembali.', { id: 'session-expired' });
        setTimeout(() => {
          window.location.href = '/login';
        }, 1500);
      }
    } else if (status === 403) {
      // 403 = akses ditolak (role tidak cukup) → JANGAN logout
      toast.error('Akses ditolak. Anda tidak memiliki izin untuk tindakan ini.', { id: 'access-denied' });
    }

    return Promise.reject(error);
  }
);

export default api;

