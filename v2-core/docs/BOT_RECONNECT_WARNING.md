# Bot Reconnect Warning & WA-JS Limitations

## Overview

This document explains the reconnect warning feature and the underlying limitations of using WA-JS (WhatsApp Web.js) for bot automation.

## Reconnect Warning Feature

### What It Does

When the WhatsApp bot reconnects (after a disconnect, server restart, or auto-recovery), a warning banner appears in the chat UI:

```
⚠️ Bot baru reconnect

Riwayat chat mungkin belum lengkap. Scroll ke atas atau refresh untuk sync pesan terbaru.

Peringatan ini akan hilang dalam 5 menit atau Anda bisa menutupnya sekarang.
```

### Why It's Important

During a bot disconnect, any messages sent to the WhatsApp contact are **not captured or stored** because the bot is not listening. When the bot reconnects, it starts fresh and can only see new messages going forward.

## WA-JS Limitations

### What is WA-JS?

WA-JS (WhatsApp Web JavaScript Bridge) is an open-source library that emulates WhatsApp Web browser behavior. Our bot uses WA-JS + whatsapp-web.js to:

- Automate WhatsApp Web via a headless Chromium browser
- Send and receive messages
- Track chat history
- Manage labels and status updates

### Key Limitations

#### 1. **No Persistent Message Queue**

The bot does not have access to WhatsApp's cloud infrastructure or message queue. When the bot is down:

```
Timeline:
13:00 - Customer sends message "Hello"
13:01 - Bot is down (server restart)
13:02 - Customer sends message "Are you there?"
13:05 - Bot reconnects
       ⚠️ Only sees messages sent AFTER reconnect
```

**Impact**: Messages sent during downtime may be lost.

#### 2. **Incomplete Chat History**

After reconnection, the bot can only access:
- Messages visible in the WhatsApp Web interface
- Recently synced messages

It **cannot** access:
- Messages that were deleted/cleared by the user
- Archived conversations that haven't been opened
- Very old message history (WhatsApp Web has limits)

#### 3. **No Graceful Sync**

Unlike WhatsApp Cloud API (which fetches all messages), WA-JS must manually scroll and fetch message history. This is:
- Slow and rate-limited by WhatsApp
- Unreliable if the connection drops during sync
- Limited by browser API constraints

#### 4. **Browser Session Instability**

The bot runs Chromium in headless mode, which can encounter:
- Network timeouts
- Memory leaks
- WhatsApp Web authentication/rate limits
- Browser crashes

Each disconnect requires a full browser restart, increasing recovery time.

#### 5. **No Real-Time Sync**

The bot polls WhatsApp Web for new messages, not true real-time subscription. This means:
- There's a polling delay (typically 5-30 seconds)
- High-frequency messages may be missed if the bot is under load
- Not suitable for high-traffic scenarios

## Current Architecture

### Frontend

```
Chat UI (ChatManagement.tsx)
  └─ ReconnectWarning Component
       └─ Listens to Socket.IO 'ready' event
       └─ Stores lastReconnectTime in chat store
       └─ Shows banner for 5 minutes or until user closes it
```

### Backend

```
WhatsApp Service (whatsapp_service.js)
  └─ client.on('ready') event
       └─ Emits 'ready' via Socket.IO
       └─ Also emits 'wa-reconnect' for explicit reconnect tracking
       └─ Updates bot status to "ready"

Socket Service
  └─ Broadcasts 'ready' and 'wa-reconnect' events to all connected clients
  └─ Connection Status API
       └─ GET /api/bot-activation/:store_wa_id/connection-status
       └─ Returns: is_connected, client_state, is_bot_active, timestamp
```

## Recovery Strategy

### For Users

1. **Scroll Up After Reconnect**: Manually fetch older messages
2. **Use "Tarik Riwayat WA" Button**: Force sync from WhatsApp Web
3. **Check Logs**: Look for messages that might have been missed

### For Operations

1. **Minimize Downtime**: Use auto-restart and health checks
2. **Monitor Connection**: Watch bot status in Dashboard
3. **Set Pause Duration**: Pause AI during maintenance windows
4. **Document Changes**: Keep users informed about downtime

## Long-Term Solution

The **WhatsApp Cloud API** (Meta) provides:

✅ Persistent message storage (no data loss)
✅ Guaranteed message delivery & receipts
✅ Real-time webhooks (true event-driven)
✅ Official rate limits and support
✅ No browser dependencies
✅ Dedicated infrastructure

### Migration Path

```
Phase 1: Evaluate Cloud API
  - Pricing: ~$0.004 per message (conversation-based billing)
  - Setup time: 2-4 weeks
  - Testing: Parallel with WA-JS

Phase 2: Gradual Migration
  - Route new stores to Cloud API
  - Keep WA-JS for existing stores initially
  - Compare performance & cost

Phase 3: Sunsetting
  - Migrate remaining stores
  - Deprecate WA-JS infrastructure
  - Cleanup and cost savings
```

## Testing the Feature

### Simulate Reconnect

```bash
# 1. Open chat in UI
# 2. Stop the bot service
# 3. Wait 5+ seconds
# 4. Restart the bot service
# 5. Warning banner should appear with timestamp
# 6. Warning auto-dismisses after 5 minutes or on click
```

### Verify Connection Status

```bash
curl -H "Authorization: Bearer {token}" \
  http://localhost:3002/api/bot-activation/{store_wa_id}/connection-status

# Response
{
  "is_connected": true,
  "client_state": "READY",
  "is_bot_active": true,
  "last_active": "2024-01-15T10:30:00Z",
  "timestamp": "2024-01-15T10:35:00Z"
}
```

## Configuration

### Environment Variables

```bash
# Reconnect behavior (already configured)
WA_SEND_READY_TIMEOUT_MS=45000      # Time to wait for client readiness
HEALTH_CHECK_INTERVAL_MS=30000      # How often to check client health
MAX_RECONNECT_ATTEMPTS=3             # Auto-reconnect retry count
RECONNECT_DELAY_MS=30000             # Delay between reconnect attempts
```

### Frontend

Warning display settings are hardcoded (can be made configurable):

```typescript
const fiveMinutes = 5 * 60 * 1000;  // Auto-hide duration
```

## Troubleshooting

### Warning Not Appearing

1. **Check Socket.IO**: Ensure frontend can receive 'ready' events
2. **Check Backend**: Verify `/api/bot-activation/:store_wa_id/connection-status` returns `is_connected: true`
3. **Check Chat Store**: Open browser DevTools → Check `useChatStore` state for `lastReconnectTime`

### Messages Still Missing After Sync

This is expected behavior due to WA-JS limitations. Options:

1. **User Manual Check**: Ask customer if they see messages in their app
2. **Force Pull**: Use "Tarik Riwayat WA" to manually fetch history
3. **Escalate**: Document missing messages and follow up manually

### Reconnect Never Completes

1. Check bot logs for errors: `pm2 logs`
2. Check WhatsApp Web authentication status
3. Manually restart: `pm2 restart bot-name`
4. Clear session: Remove `.wwebjs_auth` directory and re-authenticate

## References

- [whatsapp-web.js Documentation](https://docs.wwebjs.dev/)
- [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api)
- Socket.IO Events: See `backend/src/services/socket.service.ts`
- Component: `frontend/src/components/ReconnectWarning.tsx`
- Hook: `frontend/src/hooks/useReconnectWarning.ts`
