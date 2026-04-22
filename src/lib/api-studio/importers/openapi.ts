import type { Collection, HttpMethod, HttpRequest, KV, RequestBody } from '../types';
import { createCollection, createFolder, createRequest } from '../factory';
import { newKV } from '../ids';

interface OasParameter {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  required?: boolean;
  example?: unknown;
  schema?: { example?: unknown; default?: unknown; type?: string };
}

interface OasMediaType {
  example?: unknown;
  examples?: Record<string, { value?: unknown }>;
  schema?: { example?: unknown };
}

interface OasOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OasParameter[];
  requestBody?: { content?: Record<string, OasMediaType> };
}

interface OasSpec {
  openapi?: string;
  swagger?: string;
  info: { title: string; description?: string; version?: string };
  servers?: { url: string }[];
  paths: Record<string, Record<string, OasOperation>>;
}

const METHOD_KEYS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

function pickServer(spec: OasSpec): string {
  return spec.servers?.[0]?.url ?? '';
}

function sampleValue(p: OasParameter): string {
  if (p.example !== undefined) return String(p.example);
  if (p.schema?.example !== undefined) return String(p.schema.example);
  if (p.schema?.default !== undefined) return String(p.schema.default);
  return `{{${p.name}}}`;
}

function extractJsonExample(body: OasOperation['requestBody']): string | undefined {
  const content = body?.content;
  if (!content) return undefined;
  const jsonMedia = content['application/json'];
  if (!jsonMedia) return undefined;
  if (jsonMedia.example !== undefined) {
    return JSON.stringify(jsonMedia.example, null, 2);
  }
  const firstExample = jsonMedia.examples && Object.values(jsonMedia.examples)[0];
  if (firstExample?.value !== undefined) {
    return JSON.stringify(firstExample.value, null, 2);
  }
  if (jsonMedia.schema?.example !== undefined) {
    return JSON.stringify(jsonMedia.schema.example, null, 2);
  }
  return undefined;
}

function buildRequest(
  baseUrl: string,
  path: string,
  method: HttpMethod,
  op: OasOperation
): HttpRequest {
  const params: KV[] = [];
  const headers: KV[] = [];
  let pathExpr = path;

  for (const p of op.parameters ?? []) {
    if (p.in === 'query') {
      params.push(newKV(p.name, sampleValue(p), !!p.required));
    } else if (p.in === 'header') {
      headers.push(newKV(p.name, sampleValue(p), !!p.required));
    } else if (p.in === 'path') {
      pathExpr = pathExpr.replace(`{${p.name}}`, `{{${p.name}}}`);
    }
  }

  let body: RequestBody = { mode: 'none' };
  if (op.requestBody) {
    const example = extractJsonExample(op.requestBody);
    if (example !== undefined) {
      body = { mode: 'json', raw: example };
    } else if (op.requestBody.content) {
      body = { mode: 'json', raw: '{\n  \n}' };
    }
  }

  const url = (baseUrl.replace(/\/$/, '') + pathExpr).trim();
  const name = op.operationId || op.summary || `${method} ${path}`;

  return createRequest({
    name,
    method,
    url,
    params,
    headers,
    body,
    auth: { type: 'none' },
  });
}

export function importOpenApi(text: string): Collection {
  let parsed: OasSpec;
  try {
    parsed = JSON.parse(text) as OasSpec;
  } catch {
    throw new Error('OpenAPI import: v1 only accepts JSON (YAML not supported yet).');
  }
  if (!parsed.paths || typeof parsed.paths !== 'object') {
    throw new Error('Not an OpenAPI document (missing paths).');
  }

  const collection = createCollection(parsed.info?.title || 'OpenAPI import');
  collection.description = parsed.info?.description;
  const baseUrl = pickServer(parsed);
  if (baseUrl) {
    collection.variables.push(newKV('baseUrl', baseUrl));
  }

  // Group by first tag; requests with no tags go to root.
  const tagFolders = new Map<string, string>();

  for (const [path, pathItem] of Object.entries(parsed.paths)) {
    for (const key of METHOD_KEYS) {
      const op = pathItem[key] as OasOperation | undefined;
      if (!op) continue;
      const method = key.toUpperCase() as HttpMethod;
      const req = buildRequest(baseUrl ? '{{baseUrl}}' : '', path, method, op);
      collection.requests[req.id] = req;

      const tag = op.tags?.[0];
      if (tag) {
        let folderId = tagFolders.get(tag);
        if (!folderId) {
          const folder = createFolder(tag);
          collection.folders[folder.id] = folder;
          collection.rootFolder.folderIds.push(folder.id);
          folderId = folder.id;
          tagFolders.set(tag, folderId);
        }
        collection.folders[folderId].requestIds.push(req.id);
      } else {
        collection.rootFolder.requestIds.push(req.id);
      }
    }
  }

  return collection;
}
