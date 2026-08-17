import { describe, it, expect, vi, afterEach } from "vitest";
import {
  apiFetch,
  ApiError,
  errorMessage,
  NETWORK_ERROR_STATUS,
} from "@/lib/utils/api-client";

function mockFetch(response: Response | Error) {
  const fn = vi.fn(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response)
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

/** Await a rejection and get it back as a typed ApiError. */
async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
    throw new Error("expected the request to reject");
  } catch (error) {
    return error as ApiError;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("returns the parsed body on success", async () => {
    mockFetch(jsonResponse({ tables: [{ name: "users" }] }));

    await expect(apiFetch<{ tables: unknown[] }>("/api/tables")).resolves.toEqual({
      tables: [{ name: "users" }],
    });
  });

  it("throws with the server's message on a non-2xx response", async () => {
    mockFetch(jsonResponse({ error: "Connection not found." }, { status: 404 }));

    await expect(apiFetch("/api/data")).rejects.toThrow("Connection not found.");
  });

  it("marks a 404 as a missing connection", async () => {
    mockFetch(jsonResponse({ error: "gone" }, { status: 404 }));

    const error = await rejection(apiFetch("/api/data"));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.isConnectionMissing).toBe(true);
  });

  it("marks a 403 as forbidden", async () => {
    mockFetch(
      jsonResponse({ error: "Write operations are not allowed" }, { status: 403 })
    );

    const error = await rejection(apiFetch("/api/query"));
    expect(error.isForbidden).toBe(true);
  });

  describe("rate limiting", () => {
    it("explains a 429 rather than reporting a generic failure", async () => {
      // The rate limiter trips at 100 requests/min and the UI previously showed
      // nothing at all for it.
      mockFetch(
        jsonResponse({ error: "Too many requests." }, {
          status: 429,
          headers: { "Retry-After": "60" },
        })
      );

      const error = await rejection(apiFetch("/api/data"));
      expect(error.isRateLimited).toBe(true);
      expect(error.retryAfterSeconds).toBe(60);
      expect(error.message).toContain("Retry in 60s");
    });

    it("still explains a 429 with no Retry-After header", async () => {
      mockFetch(jsonResponse({}, { status: 429 }));

      const error = await rejection(apiFetch("/api/data"));
      expect(error.isRateLimited).toBe(true);
      expect(error.retryAfterSeconds).toBeUndefined();
      expect(error.message).toContain("Too many requests");
    });

    it("ignores a non-numeric Retry-After", async () => {
      mockFetch(
        jsonResponse({}, { status: 429, headers: { "Retry-After": "soon" } })
      );

      const error = await rejection(apiFetch("/api/data"));
      expect(error.retryAfterSeconds).toBeUndefined();
    });
  });

  it("reports a transport failure as unreachable rather than swallowing it", async () => {
    mockFetch(new TypeError("Failed to fetch"));

    const error = await rejection(apiFetch("/api/data"));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(NETWORK_ERROR_STATUS);
    expect(error.message).toContain("Could not reach the server");
  });

  it("treats a 200 body carrying an error field as a failure", async () => {
    // Several routes report problems this way. Callers used to read straight
    // past it and then find `result.data` undefined.
    mockFetch(jsonResponse({ error: "Invalid filters format" }));

    await expect(apiFetch("/api/data")).rejects.toThrow("Invalid filters format");
  });

  it("does not mistake a data field named error-ish for an error", async () => {
    mockFetch(jsonResponse({ errorCount: 3, rows: [] }));

    await expect(apiFetch("/api/query")).resolves.toEqual({
      errorCount: 3,
      rows: [],
    });
  });

  it("reports a malformed body clearly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response("<html>oops</html>", { status: 200 }))
      )
    );

    await expect(apiFetch("/api/data")).rejects.toThrow(/malformed/i);
  });

  it("falls back to a status message when the error body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("Bad Gateway", { status: 502 })))
    );

    await expect(apiFetch("/api/data")).rejects.toThrow("status 502");
  });
});

describe("errorMessage", () => {
  it("uses an ApiError's message", () => {
    expect(errorMessage(new ApiError("nope", 500))).toBe("nope");
  });

  it("uses a plain Error's message", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("has a fallback for non-errors", () => {
    expect(errorMessage("just a string")).toBe("Something went wrong.");
    expect(errorMessage(undefined)).toBe("Something went wrong.");
  });
});
