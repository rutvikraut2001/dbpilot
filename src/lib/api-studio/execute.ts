import type {
  ExecutionResult,
  HttpRequest,
  HttpResponse,
  KV,
  ResponseCapture,
} from './types';
import { resolveKVs, resolveString, jsonPathGet } from './interpolate';

export interface ExecuteInput {
  request: HttpRequest;
  environment: { variables: KV[] } | null;
  collection: { variables: KV[] } | null;
}

export interface ExecuteOutcome {
  result: ExecutionResult;
  /** Variable name → captured value (enabled captures only). */
  captured: Record<string, string>;
  /** Variable names referenced by the request that weren't resolvable. */
  unresolvedVars: string[];
}

function appendParams(url: string, params: Array<{ key: string; value: string }>): string {
  if (!params.length) return url;
  try {
    const u = new URL(url);
    for (const p of params) u.searchParams.append(p.key, p.value);
    return u.toString();
  } catch {
    // Fallback for URLs that still contain unresolved tokens (invalid URL)
    const sep = url.includes('?') ? '&' : '?';
    const enc = params
      .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
      .join('&');
    return url + sep + enc;
  }
}

function buildHeaders(req: HttpRequest, layers: KV[][]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const h of resolveKVs(req.headers, layers)) {
    headers[h.key] = h.value;
  }

  switch (req.auth.type) {
    case 'bearer':
      if (req.auth.token) headers['Authorization'] = `Bearer ${resolveString(req.auth.token, layers)}`;
      break;
    case 'basic':
      if (req.auth.username || req.auth.password) {
        const u = resolveString(req.auth.username ?? '', layers);
        const p = resolveString(req.auth.password ?? '', layers);
        headers['Authorization'] = `Basic ${btoa(`${u}:${p}`)}`;
      }
      break;
    case 'apiKey':
      if (req.auth.apiKey?.in === 'header' && req.auth.apiKey.key) {
        headers[resolveString(req.auth.apiKey.key, layers)] = resolveString(req.auth.apiKey.value ?? '', layers);
      }
      break;
  }

  if (req.body.mode === 'json' && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (req.body.mode === 'urlencoded' && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  return headers;
}

function buildBody(req: HttpRequest, layers: KV[][]): string | undefined {
  if (req.body.mode === 'none' || req.method === 'GET' || req.method === 'HEAD') return undefined;
  switch (req.body.mode) {
    case 'json':
    case 'raw':
      return resolveString(req.body.raw ?? '', layers);
    case 'urlencoded': {
      const pairs = resolveKVs(req.body.urlencoded ?? [], layers);
      return pairs
        .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
        .join('&');
    }
    case 'form-data':
      // v1: form-data sent as JSON preview only (we'd need to use FormData + multipart boundary
      // in the server proxy for full parity; stub for now).
      return JSON.stringify(resolveKVs(req.body.formData ?? [], layers));
    default:
      return undefined;
  }
}

function runCaptures(captures: ResponseCapture[], response: HttpResponse): Record<string, string> {
  const out: Record<string, string> = {};
  if (!captures.length) return out;

  let parsedBody: unknown = null;
  let parseAttempted = false;

  for (const cap of captures) {
    if (!cap.name) continue;
    try {
      if (cap.source === 'status') {
        out[cap.name] = String(response.status);
      } else if (cap.source === 'header' && cap.headerName) {
        const hv = response.headers[cap.headerName.toLowerCase()] ?? response.headers[cap.headerName];
        if (hv !== undefined) out[cap.name] = hv;
      } else if (cap.source === 'body-json') {
        if (!parseAttempted) {
          parseAttempted = true;
          try {
            parsedBody = response.body.startsWith('base64:') ? null : JSON.parse(response.body);
          } catch {
            parsedBody = null;
          }
        }
        if (parsedBody != null && cap.jsonPath) {
          const v = jsonPathGet(parsedBody, cap.jsonPath);
          if (v !== undefined) out[cap.name] = typeof v === 'string' ? v : JSON.stringify(v);
        }
      }
    } catch {
      // capture errors are non-fatal
    }
  }
  return out;
}

/**
 * Run a request through the /api/http/proxy endpoint, with variable interpolation
 * from the environment + collection layers. Returns both the response and any
 * captured variable writes (the caller decides whether to merge into the env).
 */
export async function executeRequest(input: ExecuteInput): Promise<ExecuteOutcome> {
  const layers: KV[][] = [
    input.collection?.variables ?? [],
    input.environment?.variables ?? [],
  ];

  const resolvedUrl = resolveString(input.request.url, layers);
  const params = resolveKVs(input.request.params, layers);
  const authQuery =
    input.request.auth.type === 'apiKey' && input.request.auth.apiKey?.in === 'query'
      ? [
          {
            key: resolveString(input.request.auth.apiKey.key, layers),
            value: resolveString(input.request.auth.apiKey.value ?? '', layers),
          },
        ]
      : [];

  const url = appendParams(resolvedUrl, [...params, ...authQuery]);
  const headers = buildHeaders(input.request, layers);
  const body = buildBody(input.request, layers);

  const res = await fetch('/api/http/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: input.request.method,
      url,
      headers,
      body,
      rewriteDockerHost: true,
    }),
  });

  const json = await res.json();

  if (!res.ok || json.error) {
    return {
      result: {
        error: json.error ?? `Proxy failed: ${res.status}`,
        effectiveUrl: json.effectiveUrl,
        timings: json.timings,
      },
      captured: {},
      unresolvedVars: [],
    };
  }

  const response = json as HttpResponse;
  const captured = runCaptures(input.request.captures, response);

  return {
    result: response,
    captured,
    unresolvedVars: [],
  };
}
