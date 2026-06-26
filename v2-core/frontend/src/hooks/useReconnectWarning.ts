import { useEffect } from 'react';
import { useChatStore } from '../stores/chatStore';
import { socketService } from '../services/socket';

/**
 * useReconnectWarning Hook
 *
 * Listens for WhatsApp bot reconnect events and updates the chat store
 * with the last reconnect timestamp. This allows the ReconnectWarning
 * component to display an informational banner about potential incomplete chat history.
 */
export function useReconnectWarning() {
  const setLastReconnectTime = useChatStore((state) => state.setLastReconnectTime);

  useEffect(() => {
    // Register handler BEFORE socket connects
    socketService.on('ready', () => {
      console.log('[ReconnectWarning] Detected bot ready event — setting reconnect timestamp');
      setLastReconnectTime(new Date());
    });

    // Also listen for explicit 'reconnect' events if emitted by backend
    socketService.on('wa-reconnect', () => {
      console.log('[ReconnectWarning] Detected wa-reconnect event');
      setLastReconnectTime(new Date());
    });

    // Cleanup handlers on unmount
    return () => {
      socketService.off('ready');
      socketService.off('wa-reconnect');
    };
  }, [setLastReconnectTime]);
}
