import type { Collection, HttpMethod, KV, RequestBody, AuthConfig } from '../types';
import { createCollection, createRequest } from '../factory';
import { newKV } from '../ids';

const KNOWN_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

interface BruBlock {
  name: string;
  lines: string[];
}

/**
 * Parse a Bruno .bru file into named blocks. Bruno blocks are:
 *
 *   meta { ... }
 *   get { url: ..., body: json, auth: bearer }
 *   headers { Key: Value }
 *   body:json { ... }
 *   auth:bearer { token: ... }
 *
 * We do a small brace-depth tokenizer; Bruno does not allow nested blocks
 * per spec so a single-pass walk is sufficient.
 */
function tokenize(src: string): BruBlock[] {
  const blocks: BruBlock[] = [];
  let i = 0;
  while (i < src.length) {
    // skip whitespace/comments
    while (i < src.length && /[\s]/.test(src[i])) i++;
    if (i >= src.length) break;
    if (src[i] === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    // read name up to '{'
    const nameStart = i;
    while (i < src.length && src[i] !== '{') i++;
    const name = src.slice(nameStart, i).trim();
    if (!name) break;
    if (src[i] !== '{') break;
    i++; // past '{'
    let depth = 1;
    const bodyStart = i;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth === 0) break;
      i++;
    }
    const body = src.slice(bodyStart, i);
    if (src[i] === '}') i++;
    blocks.push({ name, lines: body.split('\n') });
  }
  return blocks;
}

function parseKvLines(lines: string[]): { key: string; value: string; enabled: boolean }[] {
  const out: { key: string; value: string; enabled: boolean }[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const enabled = !line.startsWith('~');
    const cleaned = enabled ? line : line.slice(1).trim();
    const colon = cleaned.indexOf(':');
    if (colon === -1) continue;
    const key = cleaned.slice(0, colon).trim();
    const value = cleaned.slice(colon + 1).trim();
    if (key) out.push({ key, value, enabled });
  }
  return out;
}

function rawBody(lines: string[]): string {
  return lines.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

export function importBruno(text: string, defaultName = 'Imported request'): Collection {
  const blocks = tokenize(text);
  if (blocks.length === 0) {
    throw new Error('Empty or unrecognized Bruno file.');
  }

  const meta = blocks.find((b) => b.name === 'meta');
  const methodBlock = blocks.find((b) => KNOWN_METHODS.includes(b.name.toUpperCase() as HttpMethod));
  if (!methodBlock) {
    throw new Error('Bruno file has no HTTP method block (get/post/put/…).');
  }
  const method = methodBlock.name.toUpperCase() as HttpMethod;
  const methodFields = Object.fromEntries(
    parseKvLines(methodBlock.lines).map((kv) => [kv.key, kv.value])
  );
  const url = methodFields.url ?? '';

  const headers: KV[] = parseKvLines(
    blocks.find((b) => b.name === 'headers')?.lines ?? []
  ).map((kv) => newKV(kv.key, kv.value, kv.enabled));

  const params: KV[] = parseKvLines(
    blocks.find((b) => b.name === 'query' || b.name === 'params:query')?.lines ?? []
  ).map((kv) => newKV(kv.key, kv.value, kv.enabled));

  let body: RequestBody = { mode: 'none' };
  const bodyJson = blocks.find((b) => b.name === 'body:json');
  const bodyText = blocks.find((b) => b.name === 'body:text' || b.name === 'body');
  const bodyForm = blocks.find((b) => b.name === 'body:form-urlencoded');
  const bodyMultipart = blocks.find((b) => b.name === 'body:multipart-form');
  if (bodyJson) {
    body = { mode: 'json', raw: rawBody(bodyJson.lines) };
  } else if (bodyText) {
    body = { mode: 'raw', raw: rawBody(bodyText.lines) };
  } else if (bodyForm) {
    body = {
      mode: 'urlencoded',
      urlencoded: parseKvLines(bodyForm.lines).map((kv) => newKV(kv.key, kv.value, kv.enabled)),
    };
  } else if (bodyMultipart) {
    body = {
      mode: 'form-data',
      formData: parseKvLines(bodyMultipart.lines).map((kv) => newKV(kv.key, kv.value, kv.enabled)),
    };
  }

  let auth: AuthConfig = { type: 'none' };
  const authBearer = blocks.find((b) => b.name === 'auth:bearer');
  const authBasic = blocks.find((b) => b.name === 'auth:basic');
  const authApi = blocks.find((b) => b.name === 'auth:apikey');
  if (authBearer) {
    const f = Object.fromEntries(parseKvLines(authBearer.lines).map((kv) => [kv.key, kv.value]));
    auth = { type: 'bearer', token: f.token ?? '' };
  } else if (authBasic) {
    const f = Object.fromEntries(parseKvLines(authBasic.lines).map((kv) => [kv.key, kv.value]));
    auth = { type: 'basic', username: f.username ?? '', password: f.password ?? '' };
  } else if (authApi) {
    const f = Object.fromEntries(parseKvLines(authApi.lines).map((kv) => [kv.key, kv.value]));
    auth = {
      type: 'apiKey',
      apiKey: {
        key: f.key ?? '',
        value: f.value ?? '',
        in: (f.placement === 'query' ? 'query' : 'header') as 'header' | 'query',
      },
    };
  }

  const name =
    (meta && Object.fromEntries(parseKvLines(meta.lines).map((kv) => [kv.key, kv.value])).name) ||
    defaultName;

  const collection = createCollection(name);
  const req = createRequest({ name, method, url, params, headers, body, auth });
  collection.requests[req.id] = req;
  collection.rootFolder.requestIds.push(req.id);
  return collection;
}
