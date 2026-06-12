import axios from 'axios';
import toast from 'react-hot-toast';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3002/api',
  timeout: 15000, // 15 detik — prevent hanging requests
});

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('crm_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Flag untuk mencegah multiple redirect ke /login
let isLoggingOut = false;

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;

    if (status === 401 && !isLoggingOut) {
      // 401 = token tidak ada / expired → logout
      isLoggingOut = true;
      sessionStorage.removeItem('crm_token');
      sessionStorage.removeItem('crm_user');
      localStorage.removeItem('crm_token');
      localStorage.removeItem('crm_user');
      toast.error('Sesi berakhir. Silakan login kembali.', { id: 'session-expired' });
      setTimeout(() => {
        window.location.href = '/login';
      }, 1500); // Tunda 1.5 detik agar toast terlihat
    } else if (status === 403) {
      // 403 = akses ditolak (role tidak cukup) → JANGAN logout, cukup toast
      toast.error('Akses ditolak. Anda tidak memiliki izin untuk tindakan ini.', { id: 'access-denied' });
    }
    // Status lain (500, network error, dll) dibiarkan di-handle oleh masing-masing komponen

    return Promise.reject(error);
  }
);

export default api;

