import { describe, expect, test, beforeEach, jest } from "bun:test";

const mockEnvBase = {
  EMAIL_HOST_BINDING: { get: async () => "imap.example.com" },
  EMAIL_USER_BINDING: { get: async () => "user@example.com" },
  EMAIL_PASS_BINDING: { get: async () => "password123" },
  INTERNAL_KEY_BINDING: { get: async () => "internal-key-123" },
  EMAIL_SCAN_SUBJECT: "Trading Signal",
  USE_IMAP: "false"
};

describe("email-worker", () => {
  test("GET returns ready message", async () => {
    const worker = (await import("../src/index.ts")).default;
    const req = new Request("https://email-worker.workers.dev");
    const res = await worker.fetch(req, { ...mockEnvBase, TRADE_SERVICE: {} as any });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Email Worker Ready");
  });

  test("POST json with valid signal forwards to trade service", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ requestId: "test-123" }), { status: 200 })
    );

    const worker = (await import("../src/index.ts")).default;
    const req = new Request("https://email-worker.workers.dev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: "Buy Bitcoin",
        text: JSON.stringify({
          exchange: "binance",
          action: "buy",
          symbol: "BTCUSDT",
          quantity: 0.1,
          leverage: 10
        })
      })
    });

    const res = await worker.fetch(req, {
      ...mockEnvBase,
      TRADE_SERVICE: { fetch: mockFetch } as any
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockFetch).toHaveBeenCalled();
  });

  test("POST json with missing signal returns 400", async () => {
    const worker = (await import("../src/index.ts")).default;
    const req = new Request("https://email-worker.workers.dev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "No signal here" })
    });

    const res = await worker.fetch(req, { ...mockEnvBase, TRADE_SERVICE: {} as any });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("No valid signal");
  });

  test("POST mailgun webhook processes form data", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ requestId: "mg-123" }), { status: 200 })
    );

    const worker = (await import("../src/index.ts")).default;
    const formData = new FormData();
    formData.append("subject", "Trading Signal");
    formData.append("body-plain", JSON.stringify({
      exchange: "mexc",
      action: "sell",
      symbol: "ETHUSDT",
      quantity: 1
    }));

    const req = new Request("https://email-worker.workers.dev", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mailgun"
      },
      body: formData
    });

    const res = await worker.fetch(req, {
      ...mockEnvBase,
      TRADE_SERVICE: { fetch: mockFetch } as any
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("POST mailgun with stripped-text fallback", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ requestId: "mg-456" }), { status: 200 })
    );

    const worker = (await import("../src/index.ts")).default;
    const formData = new FormData();
    formData.append("subject", "Signal");
    formData.append("stripped-text", JSON.stringify({
      exchange: "bybit",
      action: "long",
      symbol: "SOLUSDT",
      quantity: 10
    }));

    const req = new Request("https://email-worker.workers.dev", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mailgun"
      },
      body: formData
    });

    const res = await worker.fetch(req, {
      ...mockEnvBase,
      TRADE_SERVICE: { fetch: mockFetch } as any
    });

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalled();
  });

  test("returns 500 on trade service error", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      new Response("Error", { status: 500 })
    );

    const worker = (await import("../src/index.ts")).default;
    const req = new Request("https://email-worker.workers.dev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: "Signal",
        text: JSON.stringify({ exchange: "binance", action: "buy", symbol: "BTC" })
      })
    });

    const res = await worker.fetch(req, {
      ...mockEnvBase,
      TRADE_SERVICE: { fetch: mockFetch } as any
    });

    expect(res.status).toBe(500);
  });

  test("returns 500 on parse error", async () => {
    const worker = (await import("../src/index.ts")).default;
    const req = new Request("https://email-worker.workers.dev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "invalid{json"
    });

    const res = await worker.fetch(req, { ...mockEnvBase, TRADE_SERVICE: {} as any });

    expect(res.status).toBe(500);
  });

  test("returns 500 on exception in processEmail", async () => {
    const mockFetch = jest.fn().mockRejectedValue(new Error("Network error"));

    const worker = (await import("../src/index.ts")).default;
    const req = new Request("https://email-worker.workers.dev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: "Signal",
        text: JSON.stringify({ exchange: "binance", action: "buy", symbol: "BTC" })
      })
    });

    const res = await worker.fetch(req, {
      ...mockEnvBase,
      TRADE_SERVICE: { fetch: mockFetch } as any
    });

    expect(res.status).toBe(500);
  });

  test("handles plaintext signal extraction", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ requestId: "txt-123" }), { status: 200 })
    );

    const worker = (await import("../src/index.ts")).default;
    const req = new Request("https://email-worker.workers.dev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: "Signal",
        text: "exchange: binance\naction: buy\nsymbol: BTCUSDT\nquantity: 0.5"
      })
    });

    const res = await worker.fetch(req, {
      ...mockEnvBase,
      TRADE_SERVICE: { fetch: mockFetch } as any
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test("handles missing quantity with default", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ requestId: "def-qty" }), { status: 200 })
    );

    const worker = (await import("../src/index.ts")).default;
    const req = new Request("https://email-worker.workers.dev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: "Signal",
        text: JSON.stringify({ exchange: "binance", action: "buy", symbol: "ETHUSDT" })
      })
    });

    const res = await worker.fetch(req, {
      ...mockEnvBase,
      TRADE_SERVICE: { fetch: mockFetch } as any
    });

    expect(res.status).toBe(200);
  });
});

describe("scheduled handler", () => {
  test("skips IMAP when USE_IMAP is not true", async () => {
    const worker = (await import("../src/index.ts")).default;

    const mockEnv = {
      ...mockEnvBase,
      USE_IMAP: "false",
      TRADE_SERVICE: { fetch: jest.fn() } as any
    };

    await expect(worker.scheduled(mockEnv)).resolves.not.toThrow();
  });

  test("returns 501 when IMAP credentials missing", async () => {
    const worker = (await import("../src/index.ts")).default;

    const mockEnv = {
      USE_IMAP: "true",
      EMAIL_HOST_BINDING: { get: async () => null },
      EMAIL_USER_BINDING: { get: async () => null },
      EMAIL_PASS_BINDING: { get: async () => null },
      EMAIL_SCAN_SUBJECT: "Signal"
    };

    const res = await worker.scheduled(mockEnv as any);

    expect(res).toBeDefined();
    expect(await res.text()).toContain("not fully implemented");
  });
});