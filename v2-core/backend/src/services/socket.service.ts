import { Server } from "socket.io";

/**
 * SocketService — SINGLE SOURCE OF TRUTH for all Socket.IO emissions.
 *
 * Usage:
 *   import { socketService } from './services/socket.service';
 *   socketService.init(io);           // called once from app.ts
 *   socketService.emitNewMessage(...); // called from controllers/services
 *
 * Events:
 *   - 'ready': Bot successfully connected and ready
 *   - 'wa-reconnect': Bot reconnected (explicit event for reconnect warning)
 *   - 'disconnected': Bot disconnected
 *
 * For legacy JS services that receive `io` as a parameter:
 *   const io = socketService.getIO();
 *   if (io) io.emit('event', payload);
 */

class SocketService {
  private io: Server | null = null;

  /** Called once from app.ts after Socket.IO server is created */
  init(io: Server): void {
    this.io = io;
    console.log("[SocketService] Initialized");
  }

  /** For legacy JS services that need the raw Server instance */
  getIO(): Server | null {
    return this.io;
  }

  /** QR codes stored in memory for re-emission on socket reconnect */
  private qrCodes: Record<string, string> = {};

  /** Get current QR codes for all stores */
  getQRCodes(): Record<string, string> {
    return { ...this.qrCodes };
  }

  // ═══════════════════════════════════════════════
  // Message & Chat Events
  // ═══════════════════════════════════════════════

  emitNewMessage(storeId: string, msg: any): void {
    this.io?.emit("newMessage", { storeId, msg });
  }

  emitChatRead(storeId: string, contactId: string): void {
    this.io?.emit("chatRead", { storeId, contactId });
  }

  emitChatCleared(storeId: string, contactId: string): void {
    this.io?.emit("chatCleared", { storeId, contactId });
  }

  emitTypingStatus(
    storeId: string,
    contactId: string,
    isTyping: boolean,
  ): void {
    this.io?.emit("typingStatus", { storeId, contactId, isTyping });
  }

  emitMessageRevoked(
    storeId: string,
    waMessageId: string,
    contactId: string,
  ): void {
    this.io?.emit("messageRevoked", { storeId, waMessageId, contactId });
  }

  // ═══════════════════════════════════════════════
  // Label Events
  // ═══════════════════════════════════════════════

  emitLabelsUpdated(
    storeId: string,
    contactId: string,
    labels: string[],
  ): void {
    this.io?.emit("labelsUpdated", { storeId, contactId, labels });
  }

  // ═══════════════════════════════════════════════
  // Contact Identity Events
  // ═══════════════════════════════════════════════

  emitContactIdentityUpdated(
    storeId: string,
    contactId: string,
    identity: any,
  ): void {
    this.io?.emit("contactIdentityUpdated", { storeId, contactId, identity });
  }

  // ═══════════════════════════════════════════════
  // WhatsApp Connection Events
  // ═══════════════════════════════════════════════

  emitQR(storeId: string, qr: string): void {
    this.qrCodes[storeId] = qr;
    this.io?.emit("qr", { storeId, qr });
  }

  /** Hapus QR dari memory setelah client terhubung (ready) */
  clearQR(storeId: string): void {
    delete this.qrCodes[storeId];
  }

  /** Emitted when a temporary scan session starts */
  emitTempScanReady(
    storeId: string,
    qr: string,
    data?: {
      isTemp?: boolean;
      tempSessionId?: string;
      wa_id?: string;
      name?: string;
    },
  ): void {
    this.io?.emit("temp_scan_ready", { storeId, qr, ...data });
  }

  emitReady(storeId: string): void {
    this.io?.emit("ready", { storeId });
  }

  emitBotReconnect(storeId: string): void {
    this.io?.emit("wa-reconnect", { storeId });
  }

  emitDisconnected(storeId: string): void {
    this.io?.emit("disconnected", { storeId });
  }

  emitQRUpdate(storeId: string, qr: string): void {
    this.io?.emit("qrUpdate", { storeId, qr });
  }

  // ═══════════════════════════════════════════════
  // Store Events
  // ═══════════════════════════════════════════════

  emitStatusUpdate(storeId: string, status: string): void {
    this.io?.emit("statusUpdate", { storeId, status });
  }

  emitStoreUpdated(storeId: string): void {
    this.io?.emit("storeUpdated", { storeId });
  }

  // ═══════════════════════════════════════════════
  // Follow-Up Events
  // ═══════════════════════════════════════════════

  emitFollowUpUpdated(storeWaId: string): void {
    this.io?.emit("followUpUpdated", { storeWaId });
  }

  // ═══════════════════════════════════════════════
  // Media Events
  // ═══════════════════════════════════════════════

  emitMediaUpdated(agentId: number | string): void {
    this.io?.emit("mediaUpdated", { agentId });
  }

  emitMediaAnalysisReady(
    agentId: number | string,
    assetId: number | string,
  ): void {
    this.io?.emit("mediaAnalysisReady", { agentId, assetId });
  }

  // ═══════════════════════════════════════════════
  // Dashboard & System Events
  // ═══════════════════════════════════════════════

  emitDashboardUpdate(): void {
    this.io?.emit("dashboardUpdate");
  }

  emitSysStats(stats: { ram: any; cpu: any; uptime: any }): void {
    this.io?.emit("sysStats", stats);
  }

  emitSysLog(log: { type: string; msg: string; time: string }): void {
    this.io?.emit("sysLog", log);
  }

  emitSyncProgress(storeId: string, payload: any): void {
    this.io?.emit("sync_progress", { storeId, ...payload });
  }
}

export const socketService = new SocketService();
export default socketService;
