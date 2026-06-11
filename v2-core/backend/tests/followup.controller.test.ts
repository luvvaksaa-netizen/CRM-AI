/**
 * Unit tests for followup.controller.ts
 * Tests: getStats, getAll, cancelFollowUp, getPipeline, scheduleManual
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';

// Mock the followup service
const mockFollowUpService = {
  getFollowUpStats: vi.fn(),
  getFollowUps: vi.fn(),
  cancelFollowUpById: vi.fn(),
  getFollowUpConfig: vi.fn(),
};

vi.mock('../src/services/followup.service', () => mockFollowUpService);

// Mock models
vi.mock('../src/models', () => ({
  FollowUp: {
    update: vi.fn(() => Promise.resolve([1])),
    create: vi.fn(() => Promise.resolve({ id: 1, status: 'pending' })),
    findByPk: vi.fn(),
  },
  Store: {
    findOne: vi.fn(),
  },
}));

const {
  getStats,
  getAll,
  cancelFollowUp,
  emergencyCancelAll,
  scheduleManual,
} = await import('../src/controllers/followup.controller');

function mockReq(body: any = {}, params: any = {}, query: any = {}): Partial<Request> {
  return { body, params, query } as Partial<Request>;
}

function mockRes(): Partial<Response> {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res as Partial<Response>;
}

describe('followup.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getStats', () => {
    it('should return follow-up stats', async () => {
      mockFollowUpService.getFollowUpStats.mockResolvedValue({
        pending: 5, sent: 10, replied: 3, total: 18,
      });

      const req = mockReq({}, { storeId: 'store1' }) as Request;
      const res = mockRes() as Response;
      const next = vi.fn();

      await getStats(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        pending: 5, sent: 10, replied: 3, total: 18,
      });
    });
  });

  describe('getAll', () => {
    it('should return paginated follow-ups', async () => {
      mockFollowUpService.getFollowUps.mockResolvedValue(
        Array(45).fill({ id: 1, status: 'sent' })
      );

      const req = mockReq({}, { storeId: 'store1' }, { page: '1', limit: '10' }) as Request;
      const res = mockRes() as Response;
      const next = vi.fn();

      await getAll(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          total: 45,
          page: 1,
          totalPages: 5,
          limit: 10,
        })
      );
    });
  });

  describe('cancelFollowUp', () => {
    it('should cancel a pending follow-up', async () => {
      mockFollowUpService.cancelFollowUpById.mockResolvedValue(true);

      const req = mockReq({}, { id: '1' }) as Request;
      const res = mockRes() as Response;
      const next = vi.fn();

      await cancelFollowUp(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('should return 400 if follow-up not found', async () => {
      mockFollowUpService.cancelFollowUpById.mockResolvedValue(false);

      const req = mockReq({}, { id: '999' }) as Request;
      const res = mockRes() as Response;
      const next = vi.fn();

      await cancelFollowUp(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('emergencyCancelAll', () => {
    it('should cancel all pending follow-ups', async () => {
      const req = mockReq({}, {}) as Request;
      const res = mockRes() as Response;
      const next = vi.fn();

      await emergencyCancelAll(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });
  });

  describe('scheduleManual', () => {
    it('should return 400 if required fields missing', async () => {
      const req = mockReq({}) as Request;
      const res = mockRes() as Response;
      const next = vi.fn();

      await scheduleManual(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should schedule a manual follow-up', async () => {
      const req = mockReq({
        store_wa_id: 'store1',
        contact_id: 'contact1',
        contact_name: 'Test',
      }, {}, {}) as Request;
      const res = mockRes() as Response;
      const next = vi.fn();

      await scheduleManual(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });
  });
});
