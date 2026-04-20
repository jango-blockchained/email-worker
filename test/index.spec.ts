import { describe, expect, test, vi } from "bun:test";
import worker from "../src/index";

describe("Email Worker fetch handler", () => {
  test("should handle standard GET request with default text response", async () => {
    const req = new Request("http://localhost");
    const mockEnv = {} as any;
    const res = await worker.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Email Worker Ready");
  });

  test("should handle Mailgun webhook payload", async () => {
    const params = new URLSearchParams();
    params.append("subject", "Trade");
    params.append("body-plain", '{"exchange":"mexc","action":"long","symbol":"BTC_USDT"}');
    
    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mailgun" },
      body: params.toString()
    });

    const mockEnv = {
      INTERNAL_KEY_BINDING: { get: async () => "test-key" },
      TRADE_SERVICE: {
        fetch: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ requestId: "123" })
        })
      }
    } as any;

    const res = await worker.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.requestId).toBe("123");
    expect(mockEnv.TRADE_SERVICE.fetch).toHaveBeenCalled();
  });

  test("should handle Mailgun webhook with invalid signal", async () => {
    const params = new URLSearchParams();
    params.append("subject", "Hello");
    params.append("body-plain", 'Just saying hi');
    
    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });

    const mockEnv = {} as any;
    const res = await worker.fetch(req, mockEnv);
    expect(res.status).toBe(400);
  });

  test("should handle direct JSON POST", async () => {
    const payload = {
      subject: "Test",
      body: '{"exchange":"binance","action":"buy","symbol":"ETH_USDT"}'
    };

    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const mockEnv = {
      INTERNAL_KEY_BINDING: { get: async () => "test-key" },
      TRADE_SERVICE: {
        fetch: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ requestId: "456" })
        })
      }
    } as any;

    const res = await worker.fetch(req, mockEnv);
    expect(res.status).toBe(200);
  });

  test("should handle TRADE_SERVICE error", async () => {
    const payload = {
      subject: "Test",
      body: '{"exchange":"binance","action":"buy","symbol":"ETH_USDT"}'
    };

    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const mockEnv = {
      INTERNAL_KEY_BINDING: { get: async () => "test-key" },
      TRADE_SERVICE: {
        fetch: vi.fn().mockResolvedValue({
          ok: false,
          status: 500
        })
      }
    } as any;

    const res = await worker.fetch(req, mockEnv);
    expect(res.status).toBe(500);
  });
});

describe("Email Worker scheduled handler", () => {
  test("should handle scheduled event when USE_IMAP is true", async () => {
    const mockEnv = {
      USE_IMAP: "true",
      EMAIL_HOST_BINDING: { get: async () => "imap.test.com" },
      EMAIL_USER_BINDING: { get: async () => "user@test.com" },
      EMAIL_PASS_BINDING: { get: async () => "password" },
    } as any;

    // It currently just returns an unimplemented log/response but doesn't return anything to scheduled
    // However, calling it shouldn't crash.
    await expect(worker.scheduled(mockEnv)).resolves.toBeUndefined();
  });

  test("should skip IMAP scan if USE_IMAP is false", async () => {
    const mockEnv = {
      USE_IMAP: "false"
    } as any;

    await expect(worker.scheduled(mockEnv)).resolves.toBeUndefined();
  });
});
