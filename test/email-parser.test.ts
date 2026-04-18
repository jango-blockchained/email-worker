import { describe, expect, test } from "bun:test";

interface EmailSignal {
  exchange: string;
  action: string;
  symbol: string;
  quantity: number;
  price?: number;
  leverage?: number;
}

function parseEmailSignal(body: string): EmailSignal | null {
  try {
    const data = JSON.parse(body);
    if (data.exchange && data.action && data.symbol) {
      return {
        exchange: String(data.exchange).toLowerCase(),
        action: normalizeAction(String(data.action)),
        symbol: String(data.symbol).toUpperCase(),
        quantity: Number(data.quantity) || 100,
        price: data.price ? Number(data.price) : undefined,
        leverage: data.leverage ? Number(data.leverage) : undefined,
      };
    }
  } catch {}
  return extractFromPlaintext(body);
}

function extractFromPlaintext(body: string): EmailSignal | null {
  const lower = body.toLowerCase();
  const exchange = extractField(lower, [
    "exchange",
    "binance",
    "mexc",
    "bybit",
  ]);
  const action = extractField(lower, [
    "action",
    "buy",
    "sell",
    "long",
    "short",
  ]);
  const symbol = extractField(lower, ["symbol", "pair"]);

  if (exchange && action && symbol) {
    return {
      exchange: normalizeExchange(exchange),
      action: normalizeAction(action),
      symbol: symbol.toUpperCase().replace(/[^A-Z0-9]/g, ""),
      quantity: 100,
    };
  }
  return null;
}

function extractField(body: string, keywords: string[]): string | null {
  for (const kw of keywords) {
    const idx = body.indexOf(kw + ":");
    if (idx !== -1) {
      const after = body.substring(idx + kw.length + 1).trim();
      return after
        .split(/[\n\r,;]/)[0]
        .trim()
        .replace(/[^a-zA-Z0-9]/g, "");
    }
  }
  return null;
}

function normalizeExchange(value: string): string {
  const v = value.toLowerCase();
  if (v.includes("binance")) return "binance";
  if (v.includes("mexc")) return "mexc";
  if (v.includes("bybit")) return "bybit";
  return v;
}

function normalizeAction(value: string): string {
  const v = value.toLowerCase();
  if (v.includes("buy") || v.includes("long")) return "buy";
  if (v.includes("sell") || v.includes("short")) return "sell";
  return v;
}

describe("Email Signal Parsing", () => {
  test("should parse valid JSON signal", () => {
    const json =
      '{"exchange":"binance","action":"buy","symbol":"BTCUSDT","quantity":100}';
    const result = parseEmailSignal(json);
    expect(result).not.toBeNull();
    expect(result!.exchange).toBe("binance");
    expect(result!.action).toBe("buy");
    expect(result!.symbol).toBe("BTCUSDT");
  });

  test("should parse plaintext with keywords", () => {
    const plaintext = "exchange: binance\naction: buy\nsymbol: BTCUSDT";
    const result = parseEmailSignal(plaintext);
    expect(result).not.toBeNull();
    expect(result!.exchange).toBe("binance");
  });

  test("should return null for invalid input", () => {
    expect(parseEmailSignal("")).toBeNull();
    expect(parseEmailSignal("random text")).toBeNull();
  });
});
