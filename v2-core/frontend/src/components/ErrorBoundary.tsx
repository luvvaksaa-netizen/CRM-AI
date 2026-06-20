import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0f172a] dark:bg-slate-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-slate-900/40 dark:bg-white border border-slate-800/50 dark:border-slate-200 p-6 rounded-2xl backdrop-blur-xl text-center">
            <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white dark:text-slate-900 mb-2">Terjadi Kesalahan UI</h2>
            <p className="text-sm text-slate-400 dark:text-slate-500 mb-6">
              Sistem menemukan error pada tampilan ini. Jangan khawatir, data Anda aman.
            </p>
            <div className="bg-black/20 dark:bg-slate-100 rounded p-3 mb-6 overflow-x-auto text-left">
              <pre className="text-[10px] text-red-400 font-mono">
                {this.state.error?.toString()}
              </pre>
            </div>
            <button
              onClick={() => window.location.href = '/dashboard'}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-xl transition-colors font-medium flex items-center justify-center gap-2 w-full"
            >
              <RefreshCw className="w-4 h-4" />
              Kembali ke Dashboard
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
