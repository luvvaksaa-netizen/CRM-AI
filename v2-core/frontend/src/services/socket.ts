import { io, Socket } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002/api';
const WS_URL: string = API_URL.replace(/\/api\/?$/, '');

interface PendingHandler {
  event: string;
  handler: (...args: any[]) => void;
}

class SocketService {
  public socket: Socket | null = null;
  private pendingHandlers: PendingHandler[] = [];

  /**
   * Register event handler BEFORE socket connects.
   * This ensures no events are missed due to timing.
   * If socket is already connected, registers immediately.
   */
  on(event: string, handler: (...args: any[]) => void) {
    if (this.socket?.connected) {
      this.socket.on(event, handler);
    } else {
      this.pendingHandlers.push({ event, handler });
    }
  }

  /**
   * Remove a specific event handler.
   */
  off(event: string, handler?: (...args: any[]) => void) {
    if (this.socket) {
      this.socket.off(event, handler);
    }
    // Also remove from pending
    this.pendingHandlers = this.pendingHandlers.filter(
      p => p.event !== event || (handler && p.handler !== handler)
    );
  }

  connect() {
    if (this.socket?.connected) {
      // Register any newly added pending handlers before returning
      for (const { event, handler } of this.pendingHandlers) {
        this.socket.on(event, handler);
      }
      this.pendingHandlers = [];
      return this.socket;
    }

    if (this.socket && !this.socket.connected) {
      this.socket.connect();
      return this.socket;
    }

    this.socket = io(WS_URL, {
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
      autoConnect: false, // CRITICAL: prevent connect before handlers register
    });

    // Register system-level handlers
    this.socket.on('connect', () => {
      console.log('Socket.IO terhubung:', this.socket?.id);
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Socket.IO terputus:', reason);
      if (reason === 'io server disconnect') {
        this.socket?.connect();
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('Socket.IO connection error:', error.message);
    });

    this.socket.on('reconnect', (attemptNumber) => {
      console.log(`Socket.IO reconnected setelah ${attemptNumber} percobaan`);
    });

    this.socket.on('reconnect_attempt', (attemptNumber) => {
      console.log(`Socket.IO reconnect attempt #${attemptNumber}`);
    });

    this.socket.on('reconnect_error', (error) => {
      console.error('Socket.IO reconnect error:', error.message);
    });

    this.socket.on('reconnect_failed', () => {
      console.error('Socket.IO gagal reconnect setelah semua percobaan');
    });

    // Register all pending handlers BEFORE connecting
    for (const { event, handler } of this.pendingHandlers) {
      this.socket.on(event, handler);
    }
    this.pendingHandlers = [];

    // Now connect
    this.socket.connect();
    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

export const socketService = new SocketService();
export default socketService;