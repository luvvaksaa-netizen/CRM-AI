import { useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useTheme } from '../contexts/ThemeContext';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LayoutDashboard, 
  MessageSquareText, 
  RefreshCw, 
  Settings, 
  LogOut,
  Sparkles,
  Menu,
  X,
  Smartphone,
  Image as ImageIcon,
  FileText,
  Target,
  Brain,
  Bot,
  Zap,
  Sun,
  Moon,
  Tag
} from 'lucide-react';

const SIDEBAR_ITEMS = [
  { icon: LayoutDashboard, label: 'Overview', path: '/dashboard' },
  { icon: MessageSquareText, label: 'Chat & CRM', path: '/chat' },
  { icon: Smartphone, label: 'WA Devices', path: '/stores' },
  { icon: RefreshCw, label: 'Follow Up', path: '/followup' },
  { icon: ImageIcon, label: 'Media Gallery', path: '/media' },
  { icon: FileText, label: 'Rekap', path: '/rekap' },
  { icon: Target, label: 'Closing', path: '/closing' },
  { icon: Bot, label: 'AI Agents', path: '/agents' },
  { icon: Tag, label: 'Smart Labels', path: '/labels' },
  { icon: Zap, label: 'Bot Control', path: '/bot-activation' },
  { icon: Brain, label: 'Learning', path: '/learning' },
  { icon: Settings, label: 'Settings', path: '/settings' },
];

const Layout = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore((state) => state.logout);
  const { theme, toggleTheme } = useTheme();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const SidebarContent = () => (
    <>
      <div className="flex items-center gap-3 p-6 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-100 to-slate-400">CRM AI</h1>
          <p className="text-xs text-blue-400 font-medium">Enterprise V2</p>
        </div>
      </div>

      <nav className="flex-1 px-4 space-y-2">
        {SIDEBAR_ITEMS.map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => setIsMobileMenuOpen(false)}
              className={({ isActive }) => `
                flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 relative group
                ${isActive ? 'text-white dark:text-slate-900' : 'text-slate-400 dark:text-slate-500 hover:text-slate-200 dark:hover:text-slate-700'}
              `}
            >
              {isActive && (
                <motion.div 
                  layoutId="activeTab"
                  className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-xl"
                  initial={false}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              )}
              <item.icon className={`w-5 h-5 z-10 transition-colors ${isActive ? 'text-blue-400' : 'group-hover:text-slate-300 dark:group-hover:text-slate-600'}`} />
              <span className="font-medium z-10">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Theme Toggle in Sidebar */}
      <div className="px-4 py-2">
        <button
          onClick={toggleTheme}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-slate-400 dark:text-slate-500 hover:text-slate-200 dark:hover:text-slate-700 hover:bg-slate-800/50 dark:hover:bg-slate-100 transition-all"
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          <span className="font-medium">{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
        </button>
      </div>

      <div className="p-4 mt-auto">
        <button 
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-slate-400 dark:text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium">Logout</span>
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-[#09090b] dark:bg-white text-slate-200 dark:text-slate-700 flex overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-72 flex-col bg-slate-900/50 dark:bg-white dark:border-slate-200 border-r border-slate-800/50 dark:border-r-slate-200 backdrop-blur-xl">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
              onClick={() => setIsMobileMenuOpen(false)}
            />
            <motion.aside 
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 w-72 bg-slate-900/90 dark:bg-white dark:border-slate-200 border-r border-slate-800/50 dark:border-r-slate-200 backdrop-blur-2xl z-50 flex flex-col"
            >
              <button 
                className="absolute top-6 right-4 p-2 text-slate-400 dark:text-slate-500 hover:text-white dark:hover:text-slate-900"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <X className="w-6 h-6" />
              </button>
              <SidebarContent />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Mobile Header */}
        <header className="lg:hidden flex items-center justify-between p-4 bg-slate-900/50 dark:bg-white dark:border-slate-200 border-b border-slate-800/50 dark:border-b-slate-200 backdrop-blur-xl shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-white dark:text-slate-900">CRM AI</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="p-2 text-slate-400 dark:text-slate-500 hover:text-white dark:hover:text-slate-900"
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button 
              className="p-2 text-slate-400 dark:text-slate-500 hover:text-white dark:hover:text-slate-900"
              onClick={() => setIsMobileMenuOpen(true)}
            >
              <Menu className="w-6 h-6" />
            </button>
          </div>
        </header>

        {/* Page Content with Glass Scrollbar */}
        <div className="flex-1 overflow-y-auto custom-scrollbar relative">
          <div className="absolute top-[-20%] left-[20%] w-[50vw] h-[50vw] rounded-full bg-blue-600/5 blur-[150px] pointer-events-none" />
          <div className="p-4 lg:p-8 relative z-10 min-h-full">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
};

export default Layout;
