import { useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import ChatManagement from './pages/ChatManagement';
import Stores from './pages/Stores';
import FollowUp from './pages/FollowUp';
import Settings from './pages/Settings';
import MediaGallery from './pages/MediaGallery';
import Login from './pages/Login';
import Agents from './pages/Agents';
import Summaries from './pages/Summaries';
import Closing from './pages/Closing';
import LearningCenter from './pages/LearningCenter';
import BotActivation from './pages/BotActivation';
import SmartLabels from './pages/SmartLabels';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuthStore } from './stores/authStore';
import { socketService } from './services/socket';

function App() {
  const initialize = useAuthStore((s) => s.initialize);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    initialize().finally(() => setChecking(false));
  }, [initialize]);

  // Global Socket.IO lifecycle — connect on auth, disconnect on logout
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (token) {
      socketService.connect();
    } else {
      socketService.disconnect();
    }
  }, [token]);

  if (checking) {
    return (
      <div className="min-h-screen bg-[#0f172a] dark:bg-slate-50 dark:text-slate-700 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <>
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/stores" element={<Stores />} />
          <Route path="/chat" element={<ChatManagement />} />
          <Route path="/followup" element={<FollowUp />} />
          <Route path="/media" element={<MediaGallery />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/rekap" element={<Summaries />} />
          <Route path="/closing" element={<Closing />} />
          <Route path="/learning" element={<LearningCenter />} />
          <Route path="/bot-activation" element={<BotActivation />} />
          <Route path="/labels" element={<SmartLabels />} />
        </Route>
      </Routes>
    </Router>
      <Toaster position="top-right" toastOptions={{
        style: { background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155' },
        success: { iconTheme: { primary: '#10b981', secondary: '#e2e8f0' } },
        error: { iconTheme: { primary: '#ef4444', secondary: '#e2e8f0' } }
      }} />
    </>
  );
}

export default App;
