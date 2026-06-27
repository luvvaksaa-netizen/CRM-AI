/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("wa_session_monitor.service", () => {
  let monitor;

  beforeEach(() => {
    vi.resetModules();
    monitor = require("../src/services/wa_session_monitor.service");
    monitor.stopAllMonitoring();
    monitor.configure({
      getClient: vi.fn(),
      isRestarting: vi.fn(() => false),
      isReady: vi.fn(() => true),
      restartClient: vi.fn(async () => {}),
      syncRecentChats: vi.fn(async () => {}),
      getActiveAIRepliesCount: vi.fn(() => 0),
    });
  });

  afterEach(() => {
    monitor.stopAllMonitoring();
    vi.useRealTimers();
  });

  it("recordActivity updates lastActivityAt", () => {
    monitor.recordActivity("628111", "message");
    const health = monitor.getHealthSnapshot("628111");
    expect(health.lastActivityAt).toBeTypeOf("number");
    expect(health.lastActivitySource).toBe("message");
  });

  it("startMonitoring is idempotent (no duplicate intervals)", () => {
    monitor.startMonitoring("628111");
    monitor.startMonitoring("628111");
    expect(() => monitor.stopMonitoring("628111")).not.toThrow();
  });

  it("derivePublicStatus returns ready when client exists and healthy", async () => {
    const mockClient = { getState: vi.fn(async () => "CONNECTED") };
    monitor.configure({
      getClient: vi.fn(() => mockClient),
      isRestarting: vi.fn(() => false),
      isReady: vi.fn(() => true),
      restartClient: vi.fn(async () => {}),
    });
    monitor.recordActivity("628222", "ready");
    monitor.markStatus("628222", "ready");

    const { statuses } = await monitor.buildStatusMap(["628222"], {
      qrCodes: {},
    });

    expect(statuses["628222"]).toBe("ready");
  });

  it("buildStatusMap returns needs_scan when QR pending", async () => {
    const { statuses } = await monitor.buildStatusMap(["628333"], {
      qrCodes: { "628333": "qr-data" },
    });
    expect(statuses["628333"]).toBe("needs_scan");
  });

  it("buildStatusMap returns disconnected when no client", async () => {
    monitor.configure({
      getClient: vi.fn(() => null),
      isRestarting: vi.fn(() => false),
      isReady: vi.fn(() => false),
      restartClient: vi.fn(async () => {}),
    });

    const { statuses } = await monitor.buildStatusMap(["628444"], {
      qrCodes: {},
    });
    expect(statuses["628444"]).toBe("disconnected");
  });

  it("runHealthCheck triggers restart when getState fails", async () => {
    const restartClient = vi.fn(async () => {});
    const mockClient = {
      getState: vi.fn(async () => {
        throw new Error("hang");
      }),
    };

    monitor.configure({
      getClient: vi.fn(() => mockClient),
      isRestarting: vi.fn(() => false),
      isReady: vi.fn(() => true),
      restartClient,
      getActiveAIRepliesCount: vi.fn(() => 0),
    });

    await monitor.runHealthCheck("628555");

    expect(restartClient).toHaveBeenCalledWith("628555", "health-check");
    const health = monitor.getHealthSnapshot("628555");
    expect(health.isHealthy).toBe(false);
  });
});
