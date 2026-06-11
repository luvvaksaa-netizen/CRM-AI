/**
 * Unit tests for chat.controller.ts
 * Tests: getChatHistory, getContacts, markAsRead, sendReaction, forwardMessage, clearChat
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';

// Mock socketService
vi.mock('../src/services/socket.service', () => ({
  socketService: {
    emitChatRead: vi.fn(),
    emitChatCleared: vi.fn(),
  },
}));

// Mock models
vi.mock('../src/models', () => ({
  ChatMessage: {
    findAll: vi.fn(),
    update: vi.fn(() => Promise.resolve([1])),
    destroy: vi.fn(() => Promise.resolve(5)),
    getTableName: () => 'ChatMessages',
  },
  ChatSummary: {
    findAll: vi.fn(() => Promise.resolve([])),
    destroy: vi.fn(() => Promise.resolve(1)),
  },
  PausedContact: {
    findAll: vi.fn(() => Promise.resolve([])),
    upsert: vi.fn(() => Promise.resolve([{}, true])),
    destroy: vi.fn(() => Promise.resolve(1)),
  },
  Store: {
    findOne: vi.fn(),
  },
  MediaAsset: {
    findOne: vi.fn(),
  },
  sequelize: {
    query: vi.fn(() => Promise.resolve([])),
  },
}));

const {
  getChatHistory,
  getContacts,
  markAsRead,
  clearChat,
  sendReaction,
  forwardMessage,
} = await import('../src/controllers/chat.controller');

function mockReq(body: any = {}, params: any = {}, query: any = {}): Partial<Request> {
  return { body, params, query } as Partial<Request>;
}

function mockRes(): Partial<Response> {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res as Partial<Response>;
}

describe('chat.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getChatHistory', () => {
    it('should return chat messages', async () => {
      const mockMessages = Array(20).fill({ id: 1, body: 'test' });
      const { ChatMessage } = await import('../src/models');
      (ChatMessage.findAll as any).mockResolvedValue(mockMessages);

      const req = mockReq({}, { storeId: 'store1' }, {}) as Request;
      const res = mockRes() as Response;
      const next = vi.fn();

      await getChatHistory(req, res, next);

      expect(res.json).toHaveBeenCalled();
    });

    it('should respect limit parameter', async () => {
      const mockMessages = Array(5).fill({ id: 1, body: 'test' });
      const { ChatMessage } = await import('../src/models');
      (ChatMessage.findAll as any).mockResolvedValue(mockMessages);

      const req = mockReq({}, { storeId: 'store1' }, { limit: '5' }) as Request;
      const res = mockRes() as Response;
      const next = vi.fn();

      await getChatHistory(req, res, next);

      expect(ChatMessage.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 6 }) // limit+1 for hasMore check
      );
    });
  });

  describe('markAsRead', () => {
    it('should mark messages as read', async () => {
      const req = mockReq({}, { storeId: 'store1', contactId: 'contact1' }) as Request;
      const res = mockRes() as Response;
      const next = vi.fn();

      await markAsRead(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });
  });

  describe('clearChat', () => {
    it('should clear chat messages and summary', async () => {
      const req = mockReq({}, { storeId: 'store1', contactId: 'contact1' }) as Request;
      const res = mockRes() as Response;
      const next = vi.fn();

      await clearChat(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });
  });

  describe('sendReaction', () => {
    it('should return 400 if messageId missing', async () => {
      const req = mockReq({ emoji: '👍' }, { storeId: 'store1' }) as Request;
      const res = mockRes() as Response;
      const next = vi.fn();

      await sendReaction(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('forwardMessage', () => {
    it('should return 400 if required fields missing', async () => {
      const req = mockReq({}, { storeId: 'store1' }) as Request;
      const res = mockRes() as Response;
      const next = vi.fn();

      await forwardMessage(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
