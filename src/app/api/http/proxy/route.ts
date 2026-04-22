import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { config } from "@/lib/config";
import { sanitizeError, HttpProxyRequestSchema } from "@/lib/validation";
import { rewriteHttpUrlForDockerHost } from "@/lib/utils/connection-string";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isTextContentType(ct: string | null): boolean {
  if (!ct) return true; // default to text if the server did not say
  const lower = ct.toLowerCase();
  return (
    lower.startsWith("text/") ||
    lower.includes("json") ||
    lower.includes("xml") ||
    lower.includes("javascript") ||
    lower.includes("x-www-form-urlencoded") ||
    lower.includes("html")
  );
}

/**
 * POST /api/http/proxy — execute an HTTP request on behalf of the client.
 *
 * Why server-side: avoids browser CORS, supports the same localhost↔host.docker.internal
 * rewrite used by DB connections, and measures precise timing without client-side clock skew.
 *
 * Protected by the global rate limiter in src/middleware.ts (100 req/min/IP by default).
 */
export async function POST(req: NextRequest) {
  const started = performance.now();
  let effectiveUrl: string | undefined;

  try {
    const json = await req.json().catch(() => null);
    const parsed = HttpProxyRequestSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request: " + parsed.error.issues[0]?.message },
        { status: 400 }
      );
    }

    const input = parsed.data;
    const timeoutMs = Math.min(
      input.timeoutMs ?? 30_000,
      config.httpProxyMaxTimeoutMs
    );

    // Docker host rewrite (opt-in, default true — matches DB connector behaviour)
    let targetUrl = input.url;
    let rewroteHost: { from: string; to: string } | undefined;
    if (input.rewriteDockerHost !== false) {
      const rewrite = rewriteHttpUrlForDockerHost(input.url);
      if (rewrite) {
        targetUrl = rewrite.url;
        rewroteHost = { from: rewrite.from, to: rewrite.to };
      }
    }
    effectiveUrl = targetUrl;

    // Build outgoing headers. Block forbidden ones; fetch would reject them anyway.
    const outgoing = new Headers();
    if (input.headers) {
      for (const [k, v] of Object.entries(input.headers)) {
        if (!k) continue;
        const kl = k.toLowerCase();
        if (kl === "host" || kl === "connection" || kl === "content-length") continue;
        outgoing.set(k, v);
      }
    }

    // Build body
    let body: BodyInit | undefined;
    if (input.bodyBase64) {
      body = Buffer.from(input.bodyBase64, "base64");
    } else if (input.body !== undefined && input.method !== "GET" && input.method !== "HEAD") {
      body = input.body;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let upstream: Response;
    try {
      upstream = await fetch(targetUrl, {
        method: input.method,
        headers: outgoing,
        body,
        signal: controller.signal,
        redirect: input.followRedirects === false ? "manual" : "follow",
      });
    } finally {
      clearTimeout(timer);
    }

    const ttfb = Math.round(performance.now() - started);

    // Read body, enforcing max size
    const max = config.httpProxyMaxResponseBytes;
    const reader = upstream.body?.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    let truncated = false;
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        received += value.byteLength;
        if (received > max) {
          truncated = true;
          try { await reader.cancel(); } catch { /* ignore */ }
          break;
        }
        chunks.push(value);
      }
    }
    const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const total = Math.round(performance.now() - started);

    const contentType = upstream.headers.get("content-type");
    const isText = isTextContentType(contentType);
    const bodyOut = isText
      ? buffer.toString("utf8")
      : "base64:" + buffer.toString("base64");

    const headersOut: Record<string, string> = {};
    upstream.headers.forEach((v, k) => {
      headersOut[k] = v;
    });

    audit("api.test.execute", {
      details: {
        method: input.method,
        status: upstream.status,
        size: received,
        totalMs: total,
        rewroteHost: rewroteHost?.from,
        truncated,
      },
      success: upstream.ok,
    });

    return NextResponse.json({
      status: upstream.status,
      statusText: upstream.statusText,
      ok: upstream.ok,
      headers: headersOut,
      body: bodyOut,
      size: received,
      contentType,
      timings: {
        total,
        ttfb,
        download: Math.max(0, total - ttfb),
      },
      redirects: [], // fetch() doesn't expose the chain; left for v2
      effectiveUrl: targetUrl,
      rewroteHost,
      truncated,
    });
  } catch (err) {
    const aborted =
      err instanceof DOMException && err.name === "AbortError";
    const message = aborted
      ? "Request timed out"
      : sanitizeError(err);

    audit("api.test.execute", {
      details: { url: effectiveUrl },
      success: false,
      error: message,
    });

    return NextResponse.json(
      {
        error: message,
        effectiveUrl,
        timings: { total: Math.round(performance.now() - started) },
      },
      { status: aborted ? 504 : 502 }
    );
  }
}
