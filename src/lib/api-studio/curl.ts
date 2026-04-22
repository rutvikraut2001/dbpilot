import type {
  AuthConfig,
  HttpMethod,
  HttpRequest,
  KV,
  RequestBody,
} from './types';
import { newKV } from './ids';

const KNOWN_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/**
 * Split a curl command line into argv, honoring quotes, escapes, backslash line
 * continuations, and `$'...'` ANSI-C quoting. Supports the most common copy-as-curl
 * output from browsers / Postman.
 */
function tokenize(src: string): string[] {
  // Collapse `\` + newline continuations and stray CRs
  const cleaned = src.replace(/\\\r?\n/g, ' ').replace(/\r/g, '');

  const tokens: string[] = [];
  let i = 0;
  const n = cleaned.length;

  while (i < n) {
    // Skip whitespace
    while (i < n && /\s/.test(cleaned[i])) i++;
    if (i >= n) break;

    let token = '';
    while (i < n && !/\s/.test(cleaned[i])) {
      const ch = cleaned[i];
      if (ch === '\\') {
        // Unescape next char (\", \\, \n, etc.)
        if (i + 1 < n) {
          const next = cleaned[i + 1];
          token += next === 'n' ? '\n' : next;
          i += 2;
        } else {
          i++;
        }
      } else if (ch === "'") {
        i++;
        while (i < n && cleaned[i] !== "'") {
          token += cleaned[i++];
        }
        i++; // closing quote
      } else if (ch === '"') {
        i++;
        while (i < n && cleaned[i] !== '"') {
          if (cleaned[i] === '\\' && i + 1 < n) {
            token += cleaned[i + 1];
            i += 2;
          } else {
            token += cleaned[i++];
          }
        }
        i++; // closing quote
      } else if (ch === '$' && cleaned[i + 1] === "'") {
        // $'...': ANSI-C quote (Chrome copy-as-curl style)
        i += 2;
        while (i < n && cleaned[i] !== "'") {
          if (cleaned[i] === '\\' && i + 1 < n) {
            const next = cleaned[i + 1];
            const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', "'": "'", '"': '"', '\\': '\\' };
            token += map[next] ?? next;
            i += 2;
          } else {
            token += cleaned[i++];
          }
        }
        i++;
      } else {
        token += ch;
        i++;
      }
    }
    tokens.push(token);
  }
  return tokens;
}

export function isCurlCommand(text: string): boolean {
  return /^\s*curl\b/i.test(text);
}

export interface CurlParseResult {
  method: HttpMethod;
  url: string;
  headers: KV[];
  params: KV[];
  body: RequestBody;
  auth: AuthConfig;
}

/**
 * Parse a `curl ...` command into our HttpRequest shape.
 * Supports: -X/--request, -H/--header, -d/--data/--data-raw/--data-binary/--data-urlencode,
 * --json, -F/--form, -u/--user (basic auth), -b/--cookie, and bare URL.
 */
export function parseCurl(text: string): CurlParseResult {
  const argv = tokenize(text.trim());
  if (argv[0]?.toLowerCase() === 'curl') argv.shift();

  let method: HttpMethod | null = null;
  const headers: KV[] = [];
  const bodyParts: string[] = [];
  const formParts: KV[] = [];
  const urlencodedParts: KV[] = [];
  let url = '';
  let jsonBody = false;
  let auth: AuthConfig = { type: 'none' };

  const popValue = (flag: string, i: number): [string, number] => {
    // Either `--flag=value` or `--flag value`
    const eq = flag.indexOf('=');
    if (eq > 0) return [flag.slice(eq + 1), i];
    return [argv[i + 1] ?? '', i + 1];
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg.startsWith('-X') || arg === '--request' || arg.startsWith('--request=')) {
      const raw = arg === '-X' || arg === '--request' ? argv[++i] : arg.replace(/^-X|^--request=/, '');
      const up = (raw ?? 'GET').toUpperCase() as HttpMethod;
      if (KNOWN_METHODS.includes(up)) method = up;
      continue;
    }

    if (arg === '-H' || arg.startsWith('--header')) {
      const [raw, ni] = arg === '-H' || arg === '--header' ? [argv[++i], i] : popValue(arg, i);
      i = ni;
      if (!raw) continue;
      const idx = raw.indexOf(':');
      if (idx === -1) continue;
      const key = raw.slice(0, idx).trim();
      const value = raw.slice(idx + 1).trim();
      if (key) headers.push(newKV(key, value, true));
      continue;
    }

    if (arg === '-A' || arg === '--user-agent') {
      const v = argv[++i] ?? '';
      if (v) headers.push(newKV('User-Agent', v, true));
      continue;
    }

    if (arg === '-e' || arg === '--referer') {
      const v = argv[++i] ?? '';
      if (v) headers.push(newKV('Referer', v, true));
      continue;
    }

    if (arg === '-b' || arg === '--cookie' || arg.startsWith('--cookie=')) {
      const [raw, ni] = arg === '-b' || arg === '--cookie' ? [argv[++i], i] : popValue(arg, i);
      i = ni;
      if (raw) headers.push(newKV('Cookie', raw, true));
      continue;
    }

    if (arg === '-u' || arg === '--user' || arg.startsWith('--user=')) {
      const [raw, ni] = arg === '-u' || arg === '--user' ? [argv[++i], i] : popValue(arg, i);
      i = ni;
      if (!raw) continue;
      const colon = raw.indexOf(':');
      auth = {
        type: 'basic',
        username: colon >= 0 ? raw.slice(0, colon) : raw,
        password: colon >= 0 ? raw.slice(colon + 1) : '',
      };
      continue;
    }

    if (arg === '--json') {
      const v = argv[++i] ?? '';
      bodyParts.push(v);
      jsonBody = true;
      if (!headers.some((h) => h.key.toLowerCase() === 'content-type')) {
        headers.push(newKV('Content-Type', 'application/json', true));
      }
      continue;
    }

    if (arg === '-d' || arg === '--data' || arg === '--data-raw' || arg === '--data-binary' || arg === '--data-ascii' || arg.startsWith('--data=')) {
      const [raw, ni] = arg.startsWith('--data=') ? popValue(arg, i) : [argv[++i], i];
      i = ni;
      if (raw !== undefined) bodyParts.push(raw);
      continue;
    }

    if (arg === '--data-urlencode' || arg.startsWith('--data-urlencode=')) {
      const [raw, ni] = arg.startsWith('--data-urlencode=') ? popValue(arg, i) : [argv[++i], i];
      i = ni;
      if (!raw) continue;
      const eq = raw.indexOf('=');
      if (eq === -1) {
        urlencodedParts.push(newKV('', raw, true));
      } else {
        urlencodedParts.push(newKV(raw.slice(0, eq), raw.slice(eq + 1), true));
      }
      continue;
    }

    if (arg === '-F' || arg === '--form' || arg.startsWith('--form=')) {
      const [raw, ni] = arg.startsWith('--form=') ? popValue(arg, i) : [argv[++i], i];
      i = ni;
      if (!raw) continue;
      const eq = raw.indexOf('=');
      if (eq === -1) continue;
      formParts.push(newKV(raw.slice(0, eq), raw.slice(eq + 1), true));
      continue;
    }

    // Ignore flags we don't support (compressed, -v, -s, -k, -L, etc.) and their values for known-arg flags
    if (arg === '--compressed' || arg === '-v' || arg === '--verbose' || arg === '-s' || arg === '--silent' ||
        arg === '-L' || arg === '--location' || arg === '-k' || arg === '--insecure' ||
        arg === '-i' || arg === '--include' || arg === '-I' || arg === '--head' ||
        arg === '-O' || arg === '--remote-name' || arg === '-#' || arg === '--progress-bar' ||
        arg === '-N' || arg === '--no-buffer') {
      continue;
    }

    if (arg.startsWith('-') && !arg.startsWith('http')) {
      // Unknown flag — consume its value if present to avoid swallowing the URL
      const next = argv[i + 1];
      if (next && !next.startsWith('-') && !next.startsWith('http')) {
        i++;
      }
      continue;
    }

    // Bare argument — treat first http(s) as URL
    if (!url && /^https?:\/\//i.test(arg)) {
      url = arg;
    } else if (!url) {
      url = arg;
    }
  }

  // Separate query params from URL
  const params: KV[] = [];
  try {
    const u = new URL(url);
    u.searchParams.forEach((v, k) => params.push(newKV(k, v, true)));
    u.search = '';
    url = u.toString();
  } catch {
    // leave url as-is if it contains {{vars}} or isn't parseable
  }

  // Build body
  let body: RequestBody = { mode: 'none' };
  if (formParts.length > 0) {
    body = { mode: 'form-data', formData: formParts };
  } else if (urlencodedParts.length > 0) {
    body = { mode: 'urlencoded', urlencoded: urlencodedParts };
    if (!headers.some((h) => h.key.toLowerCase() === 'content-type')) {
      headers.push(newKV('Content-Type', 'application/x-www-form-urlencoded', true));
    }
  } else if (bodyParts.length > 0) {
    const raw = bodyParts.join('&');
    const ct = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value.toLowerCase() ?? '';
    if (jsonBody || ct.includes('application/json') || /^\s*[{\[]/.test(raw)) {
      body = { mode: 'json', raw };
    } else if (ct.includes('application/x-www-form-urlencoded') && raw.includes('=')) {
      const pairs: KV[] = [];
      for (const pair of raw.split('&')) {
        const eq = pair.indexOf('=');
        if (eq === -1) pairs.push(newKV(decodeURIComponent(pair), '', true));
        else
          pairs.push(
            newKV(
              decodeURIComponent(pair.slice(0, eq)),
              decodeURIComponent(pair.slice(eq + 1)),
              true
            )
          );
      }
      body = { mode: 'urlencoded', urlencoded: pairs };
    } else {
      body = { mode: 'raw', raw };
    }
  }

  // Derive method if not specified: body implies POST, else GET
  const resolvedMethod = method ?? (body.mode !== 'none' ? 'POST' : 'GET');

  return {
    method: resolvedMethod,
    url,
    headers,
    params,
    body,
    auth,
  };
}

/**
 * Shell-escape a value for single-quote contexts (POSIX).
 * `'hello'` becomes `'"'"'hello'"'"'` only if it contains a single quote.
 */
function sq(v: string): string {
  if (v === '') return "''";
  if (!/['\\\s"]/.test(v)) return v;
  return `'${v.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build a curl command from a request. Does NOT interpolate {{vars}} — the caller
 * can pass in an already-resolved request if they want literals.
 */
export function buildCurl(req: HttpRequest): string {
  const parts: string[] = ['curl'];
  if (req.method !== 'GET') {
    parts.push('-X', req.method);
  }

  let url = req.url;
  const enabledParams = req.params.filter((p) => p.enabled && p.key);
  if (enabledParams.length > 0) {
    try {
      const u = new URL(req.url);
      for (const p of enabledParams) u.searchParams.append(p.key, p.value);
      url = u.toString();
    } catch {
      const sep = url.includes('?') ? '&' : '?';
      url =
        url +
        sep +
        enabledParams
          .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
          .join('&');
    }
  }
  parts.push(sq(url));

  for (const h of req.headers) {
    if (!h.enabled || !h.key) continue;
    parts.push('-H', sq(`${h.key}: ${h.value}`));
  }

  switch (req.auth.type) {
    case 'bearer':
      if (req.auth.token) parts.push('-H', sq(`Authorization: Bearer ${req.auth.token}`));
      break;
    case 'basic':
      if (req.auth.username || req.auth.password) {
        parts.push('-u', sq(`${req.auth.username ?? ''}:${req.auth.password ?? ''}`));
      }
      break;
    case 'apiKey':
      if (req.auth.apiKey?.in === 'header' && req.auth.apiKey.key) {
        parts.push('-H', sq(`${req.auth.apiKey.key}: ${req.auth.apiKey.value ?? ''}`));
      }
      break;
  }

  if (req.body.mode === 'json' || req.body.mode === 'raw') {
    if (req.body.raw) {
      parts.push('--data-raw', sq(req.body.raw));
    }
  } else if (req.body.mode === 'urlencoded') {
    for (const kv of req.body.urlencoded ?? []) {
      if (!kv.enabled || !kv.key) continue;
      parts.push('--data-urlencode', sq(`${kv.key}=${kv.value}`));
    }
  } else if (req.body.mode === 'form-data') {
    for (const kv of req.body.formData ?? []) {
      if (!kv.enabled || !kv.key) continue;
      parts.push('-F', sq(`${kv.key}=${kv.value}`));
    }
  }

  return parts.join(' ');
}
