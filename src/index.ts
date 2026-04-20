// email-worker/src/index.ts - Scans email inbox and forwards signals to trade-worker

import type { Fetcher } from "@cloudflare/workers-types";

interface SecretBinding {
  get: () => Promise<string | null>;
}

interface Env {
  TRADE_SERVICE: Fetcher;
  EMAIL_HOST_BINDING?: SecretBinding;
  EMAIL_USER_BINDING?: SecretBinding;
  EMAIL_PASS_BINDING?: SecretBinding;
  INTERNAL_KEY_BINDING?: SecretBinding;
  EMAIL_SCAN_SUBJECT?: string;
  USE_IMAP?: string;
}

interface EmailSignal {
  exchange: string;
  action: string;
  symbol: string;
  quantity: number;
  price?: number;
  leverage?: number;
}

const DEFAULT_SCAN_SUBJECT = "Trading Signal";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const contentType = request.headers.get("content-type") || "";
    const userAgent = request.headers.get("user-agent") || "";

    if (userAgent.includes("Mailgun") || contentType.includes("application/x-www-form-urlencoded")) {
      return await handleMailgunWebhook(request, env);
    }
    
    if (contentType.includes("application/json")) {
      return await handleDirectJson(request, env);
    }

    return new Response("Email Worker Ready. POST email data or use webhooks.", {
      headers: { "Content-Type": "text/plain" }
    });
  },

  async scheduled(env: Env): Promise<void> {
    if (env.USE_IMAP === "true") {
      await handleIMAPScan(env);
    }
  }
};

async function handleMailgunWebhook(request: Request, env: Env): Promise<Response> {
  try {
    const formData = await request.formData();
    const subject = formData.get("subject")?.toString() || "";
    const body = formData.get("body-plain")?.toString() || formData.get("stripped-text")?.toString() || "";
    return await processEmail(subject, body, "mailgun", env);
  } catch (error) {
    return errorResponse(error);
  }
}

async function handleDirectJson(request: Request, env: Env): Promise<Response> {
  try {
    const json = await request.json() as Record<string, unknown>;
    const subject = json.subject?.toString() || "";
    const body = json.text?.toString() || json.body?.toString() || JSON.stringify(json);
    return await processEmail(subject, body, "json", env);
  } catch (error) {
    return errorResponse(error);
  }
}

async function handleIMAPScan(env: Env): Promise<Response> {
  try {
    const host = await env.EMAIL_HOST_BINDING?.get();
    const user = await env.EMAIL_USER_BINDING?.get();
    const pass = await env.EMAIL_PASS_BINDING?.get();
    const scanSubject = env.EMAIL_SCAN_SUBJECT || DEFAULT_SCAN_SUBJECT;

    if (!host || !user || !pass) {
      return new Response("Error: Missing IMAP credentials", { status: 500 });
    }

    console.log(`[IMAP] Scanning ${user}@${host} for: ${scanSubject}`);
    return new Response("IMAP not fully implemented in this version", { status: 501 });
  } catch (error) {
    return errorResponse(error);
  }
}

async function processEmail(subject: string, body: string, source: string, env: Env): Promise<Response> {
  const signal = parseEmailSignal(body);
  
  if (!signal) {
    return new Response(JSON.stringify({ success: false, error: "No valid signal in email" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  console.log(`[${source}] Signal: ${JSON.stringify(signal)}`);
  
  try {
    const internalKey = await env.INTERNAL_KEY_BINDING?.get();
    const response = await env.TRADE_SERVICE.fetch("https://trade-worker.internal/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": internalKey || "",
        "X-Source": "email-worker"
      },
      body: JSON.stringify(signal)
    });

    if (!response.ok) {
      return new Response(`Trade worker error: ${response.status}`, { status: 500 });
    }

    const result = await response.json();
    return new Response(JSON.stringify({ success: true, requestId: result.requestId }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return errorResponse(error);
  }
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
        leverage: data.leverage ? Number(data.leverage) : undefined
      };
    }
  } catch {}
  return extractFromPlaintext(body);
}

function extractFromPlaintext(body: string): EmailSignal | null {
  const lower = body.toLowerCase();
  const exchange = extractField(lower, ["exchange", "binance", "mexc", "bybit"]);
  const action = extractField(lower, ["action", "buy", "sell", "long", "short"]);
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
      return after.split(/[\n\r,;]/)[0].trim().replace(/[^a-zA-Z0-9]/g, "");
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

function errorResponse(error: unknown): Response {
  return new Response(`Error: ${error instanceof Error ? error.message : String(error)}`, {
    status: 500, headers: { "Content-Type": "application/json" }
  });
}