/**
 * chatHistory.service.ts — Extracted from dashboard_service.js
 * Handles chat message persistence with dedup and contact identity resolution.
 */

import { ChatMessage } from "../models";
import { buildContactIdentity } from "../utils/contact_identity";
import { socketService } from "./socket.service";
import {
  mergeStableContactIdentity,
  firstStableDisplayName,
} from "./contactIdentity.service";
import logger from "../utils/logger";
import { enqueueWrite, getQueueLength } from "./dbWriteQueue";

export function clipQuotedBody(
  value: any,
  maxLength: number = 700,
): string | null {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

/**
 * Retry helper untuk SQLITE_BUSY — tunggu sebentar lalu coba lagi.
 * Dengan 8 WA store aktif bersamaan, wajar ada lock contention.
 */
async function withSqliteRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 5,
): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const isBusy =
        err?.message?.includes("SQLITE_BUSY") ||
        err?.parent?.message?.includes("SQLITE_BUSY");
      if (!isBusy) throw err;
      lastErr = err;
      // Exponential backoff: 50ms, 100ms, 200ms, 400ms, 800ms
      const delay = Math.min(50 * Math.pow(2, i), 800);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export async function addToChatHistory(
  storeId: string,
  msg: any,
): Promise<void> {
  try {
    // 🔧 WRITE QUEUE: Antri ke dbWriteQueue untuk serialisasi write SQLite
    // Ini mengeliminasi SQLITE_BUSY yang terjadi karena 50+ concurrent write
    await enqueueWrite(async () => {
      // ═══ DEDUP GUARD ═══
      const waMessageId: string | null = msg.wa_message_id || msg.id || null;
      if (waMessageId) {
        const existing = await (ChatMessage as any).findOne({
          where: { wa_message_id: waMessageId },
        });
        if (existing) return;
      }

      const identity =
        msg.contactIdentity ||
        buildContactIdentity(
          msg.from,
          msg.isMe
            ? {}
            : {
                name: msg.sender_name,
                number: msg.contact_phone,
              },
        );

      const recentIdentityRows: any[] = await (ChatMessage as any).findAll({
        where: { store_wa_id: storeId, contact_id: msg.from },
        limit: 20,
        order: [["timestamp", "DESC"]],
      });

      const stableHistoryMsg =
        recentIdentityRows.find((row) => {
          const item = row.get({ plain: true });
          return (
            item.contact_phone ||
            firstStableDisplayName(item.contact_display_name, item.sender_name)
          );
        }) || recentIdentityRows[0];

      const stableIdentity = mergeStableContactIdentity(
        msg.from,
        msg,
        identity,
        stableHistoryMsg,
      );

      const quotedMessageId: string | null =
        msg.quoted_message_id || msg.quotedMessageId || null;
      let quotedRecord: any = null;
      if (quotedMessageId) {
        quotedRecord = await (ChatMessage as any)
          .findOne({
            where: { store_wa_id: storeId, wa_message_id: quotedMessageId },
          })
          .catch(() => null);
      }

      const messageData: any = {
        store_wa_id: storeId,
        contact_id: msg.from,
        wa_message_id: waMessageId,
        sender_name: msg.isMe
          ? msg.sender_name || "CS Manual"
          : firstStableDisplayName(
              msg.sender_name,
              stableIdentity.displayName,
            ) || stableIdentity.displayName,
        contact_display_name: stableIdentity.displayName,
        contact_phone: stableIdentity.phone || null,
        contact_lid: stableIdentity.lid || null,
        contact_type: stableIdentity.type,
        contact_source: stableIdentity.source,
        quoted_message_id: quotedMessageId,
        quoted_body: clipQuotedBody(
          quotedRecord?.body || msg.quoted_body || msg.quotedBody,
        ),
        quoted_from_me:
          msg.quoted_from_me ??
          msg.quotedFromMe ??
          quotedRecord?.is_from_me ??
          null,
        quoted_sender_name:
          msg.quoted_sender_name ||
          msg.quotedSenderName ||
          quotedRecord?.sender_name ||
          null,
        body: msg.body,
        is_from_me: msg.isMe || false,
        type: msg.type || "chat",
        timestamp: msg.timestamp || new Date(),
      };

      let chatMsg: any;
      if (waMessageId) {
        const [record, created] = await (ChatMessage as any).findOrCreate({
          where: { wa_message_id: waMessageId },
          defaults: messageData,
        });
        if (!created) return;
        chatMsg = record;
      } else {
        chatMsg = await (ChatMessage as any).create(messageData);
      }

      socketService.emitNewMessage(storeId, chatMsg.dataValues);
    });
  } catch (err: any) {
    if (err.name === "SequelizeUniqueConstraintError") return;
    logger.error(`addToChatHistory error: ${err.message}`);
  }
}
