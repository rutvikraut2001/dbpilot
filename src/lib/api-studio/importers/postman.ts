import type {
  Collection,
  HttpMethod,
  HttpRequest,
  KV,
  AuthConfig,
  RequestBody,
  Folder,
} from '../types';
import { createCollection, createFolder, createRequest } from '../factory';
import { newKV } from '../ids';

interface PostmanHeader {
  key: string;
  value: string;
  disabled?: boolean;
  description?: string;
}

interface PostmanUrl {
  raw?: string;
  protocol?: string;
  host?: string[] | string;
  path?: string[] | string;
  query?: { key: string; value: string; disabled?: boolean; description?: string }[];
}

interface PostmanBody {
  mode?: 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql';
  raw?: string;
  urlencoded?: { key: string; value: string; disabled?: boolean; description?: string }[];
  formdata?: { key: string; value: string; disabled?: boolean; type?: string; description?: string }[];
  options?: { raw?: { language?: string } };
}

interface PostmanAuth {
  type?: string;
  bearer?: { key: string; value: string }[] | { token?: string };
  basic?: { key: string; value: string }[];
  apikey?: { key: string; value: string }[];
}

interface PostmanItem {
  name: string;
  item?: PostmanItem[];
  request?: {
    method?: string;
    url?: PostmanUrl | string;
    header?: PostmanHeader[];
    body?: PostmanBody;
    auth?: PostmanAuth;
  };
}

interface PostmanCollectionJson {
  info: { name: string; description?: string };
  item: PostmanItem[];
  variable?: { key: string; value: string; disabled?: boolean }[];
  auth?: PostmanAuth;
}

const KNOWN_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function normalizeMethod(m: string | undefined): HttpMethod {
  const up = (m ?? 'GET').toUpperCase() as HttpMethod;
  return KNOWN_METHODS.includes(up) ? up : 'GET';
}

function buildUrl(raw: PostmanUrl | string | undefined): { url: string; params: KV[] } {
  if (!raw) return { url: '', params: [] };
  if (typeof raw === 'string') return { url: raw, params: [] };
  const url = raw.raw ?? '';
  const params: KV[] = (raw.query ?? [])
    .filter((q) => q.key)
    .map((q) => ({
      ...newKV(q.key, q.value ?? '', !q.disabled),
      description: q.description,
    }));
  return { url, params };
}

function buildHeaders(headers: PostmanHeader[] | undefined): KV[] {
  return (headers ?? [])
    .filter((h) => h.key)
    .map((h) => ({
      ...newKV(h.key, h.value ?? '', !h.disabled),
      description: h.description,
    }));
}

function buildBody(body: PostmanBody | undefined): RequestBody {
  if (!body?.mode) return { mode: 'none' };
  if (body.mode === 'raw') {
    const lang = body.options?.raw?.language;
    return {
      mode: lang === 'json' ? 'json' : 'raw',
      raw: body.raw ?? '',
    };
  }
  if (body.mode === 'urlencoded') {
    return {
      mode: 'urlencoded',
      urlencoded: (body.urlencoded ?? []).map((p) => ({
        ...newKV(p.key, p.value ?? '', !p.disabled),
        description: p.description,
      })),
    };
  }
  if (body.mode === 'formdata') {
    return {
      mode: 'form-data',
      formData: (body.formdata ?? []).map((p) => ({
        ...newKV(p.key, p.value ?? '', !p.disabled),
        description: p.description,
      })),
    };
  }
  return { mode: 'none' };
}

function buildAuth(auth: PostmanAuth | undefined): AuthConfig {
  if (!auth?.type) return { type: 'none' };
  const lookup = (arr: { key: string; value: string }[] | undefined, key: string) =>
    arr?.find((a) => a.key === key)?.value ?? '';

  switch (auth.type) {
    case 'bearer': {
      if (Array.isArray(auth.bearer)) {
        return { type: 'bearer', token: lookup(auth.bearer, 'token') };
      }
      return { type: 'bearer', token: auth.bearer?.token ?? '' };
    }
    case 'basic':
      return {
        type: 'basic',
        username: lookup(auth.basic, 'username'),
        password: lookup(auth.basic, 'password'),
      };
    case 'apikey':
      return {
        type: 'apiKey',
        apiKey: {
          key: lookup(auth.apikey, 'key'),
          value: lookup(auth.apikey, 'value'),
          in: (lookup(auth.apikey, 'in') || 'header') as 'header' | 'query',
        },
      };
    default:
      return { type: 'none' };
  }
}

function walkItems(
  items: PostmanItem[],
  collection: Collection,
  parentFolder: Folder
) {
  for (const item of items) {
    if (item.item) {
      const sub = createFolder(item.name);
      collection.folders[sub.id] = sub;
      parentFolder.folderIds.push(sub.id);
      walkItems(item.item, collection, sub);
      continue;
    }
    if (!item.request) continue;
    const { url, params } = buildUrl(item.request.url);
    const req: HttpRequest = createRequest({
      name: item.name || 'Untitled',
      method: normalizeMethod(item.request.method),
      url,
      params,
      headers: buildHeaders(item.request.header),
      body: buildBody(item.request.body),
      auth: buildAuth(item.request.auth),
    });
    collection.requests[req.id] = req;
    parentFolder.requestIds.push(req.id);
  }
}

export function importPostmanV21(text: string): Collection {
  const data = JSON.parse(text) as PostmanCollectionJson;
  if (!data.info || !Array.isArray(data.item)) {
    throw new Error('Not a Postman v2.1 collection (missing info or item array)');
  }
  const collection = createCollection(data.info.name || 'Imported collection');
  collection.description = data.info.description;
  collection.variables = (data.variable ?? [])
    .filter((v) => v.key)
    .map((v) => ({
      ...newKV(v.key, v.value ?? '', !v.disabled),
    }));
  walkItems(data.item, collection, collection.rootFolder);
  return collection;
}
