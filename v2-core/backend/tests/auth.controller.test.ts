/**
 * Unit tests for auth.controller.ts
 * Tests: login, register, getSession
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';

// Mock dependencies BEFORE importing controller
vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn(() => 'mock-token-123'),
  },
}));

vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn(() => Promise.resolve('$2b$10$hashedpassword')),
    compare: vi.fn((plain: string) => Promise.resolve(plain === 'admin123')),
  },
}));

vi.mock('../src/models', () => ({
  AdminConfig: {
    count: vi.fn(() => Promise.resolve(1)),
    findOne: vi.fn(() => Promise.resolve({
      username: 'admin',
      password_hash: '$2b$10$hashedpassword',
      role: 'admin',
    })),
    create: vi.fn(),
  },
}));

// Set required env vars
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASS = 'admin123';

// Dynamic import after mocks
const { login, getSession } = await import('../src/controllers/auth.controller');

function mockReq(body: any = {}, params: any = {}): Partial<Request> {
  return { body, params } as Partial<Request>;
}

function mockRes(): Partial<Response> {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res as Partial<Response>;
}

describe('auth.controller', () => {
  describe('login', () => {
    it('should return 400 if user or pass is missing', async () => {
      const req = mockReq({}) as Request;
      const res = mockRes() as Response;
      const next = vi.fn();

      await login(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
    });

    it('should return 401 for invalid credentials', async () => {
      const req = mockReq({ user: 'admin', pass: 'wrong' }) as Request;
      const res = mockRes() as Response;
      const next = vi.fn();

      await login(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should return token for valid credentials', async () => {
      const req = mockReq({ user: 'admin', pass: 'admin123' }) as Request;
      const res = mockRes() as Response;
      const next = vi.fn();

      await login(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          token: 'mock-token-123',
        })
      );
    });
  });

  describe('getSession', () => {
    it('should return user info if authenticated', () => {
      const req = { user: { username: 'admin', role: 'admin' } } as any;
      const res = mockRes() as Response;

      getSession(req, res);

      expect(res.json).toHaveBeenCalledWith({
        user: 'admin',
        role: 'admin',
      });
    });

    it('should return 401 if no user in request', () => {
      const req = { user: null } as any;
      const res = mockRes() as Response;

      getSession(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
    });
  });
});
