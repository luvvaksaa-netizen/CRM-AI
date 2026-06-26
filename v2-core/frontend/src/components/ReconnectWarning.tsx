import { useState, useEffect } from "react";
import { AlertCircle, X } from "lucide-react";

export interface ReconnectWarningProps {
  lastReconnect?: Date | null;
}

/**
 * ReconnectWarning Component
 *
 * Displays a warning banner when the bot reconnects, informing users that
 * chat history might be incomplete due to WA-JS limitations. The warning
 * auto-dismisses after 5 minutes or can be manually closed.
 */
export function ReconnectWarning({ lastReconnect }: ReconnectWarningProps) {
  const [showWarning, setShowWarning] = useState(true);

  // Auto-hide warning after 5 minutes or when lastReconnect is cleared
  useEffect(() => {
    if (!lastReconnect) {
      setShowWarning(false);
      return;
    }

    // Calculate remaining time before auto-hide
    const timeAgo = Date.now() - lastReconnect.getTime();
    const fiveMinutes = 5 * 60 * 1000;

    // If reconnect is older than 5 minutes, hide immediately
    if (timeAgo > fiveMinutes) {
      setShowWarning(false);
      return;
    }

    // Set timer to hide after remaining time
    const timer = setTimeout(() => {
      setShowWarning(false);
    }, fiveMinutes - timeAgo);

    return () => clearTimeout(timer);
  }, [lastReconnect]);

  if (!showWarning || !lastReconnect) {
    return null;
  }

  return (
    <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-md mb-4 animate-in fade-in duration-300">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-yellow-800">
            ⚠️ Bot baru reconnect
          </p>
          <p className="text-sm text-yellow-700 mt-1">
            Riwayat chat mungkin belum lengkap. Scroll ke atas atau refresh
            untuk sync pesan terbaru.
          </p>
          <p className="text-xs text-yellow-600 mt-2">
            Peringatan ini akan hilang dalam 5 menit atau Anda bisa menutupnya
            sekarang.
          </p>
        </div>
        <button
          onClick={() => setShowWarning(false)}
          className="ml-2 text-yellow-400 hover:text-yellow-600 transition-colors shrink-0"
          aria-label="Tutup peringatan"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
