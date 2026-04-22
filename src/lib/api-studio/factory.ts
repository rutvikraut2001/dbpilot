import type { Collection, Environment, HttpRequest, Folder } from './types';
import { newId } from './ids';

export function createFolder(name: string, id?: string): Folder {
  return {
    id: id ?? newId('fld'),
    name,
    requestIds: [],
    folderIds: [],
  };
}

export function createRequest(overrides: Partial<HttpRequest> = {}): HttpRequest {
  return {
    id: overrides.id ?? newId('req'),
    name: overrides.name ?? 'New Request',
    method: overrides.method ?? 'GET',
    url: overrides.url ?? '',
    params: overrides.params ?? [],
    headers: overrides.headers ?? [],
    body: overrides.body ?? { mode: 'none' },
    auth: overrides.auth ?? { type: 'none' },
    captures: overrides.captures ?? [],
    preScript: overrides.preScript,
    testScript: overrides.testScript,
  };
}

export function createCollection(name: string): Collection {
  const now = Date.now();
  const root = createFolder('__root__', newId('fld'));
  return {
    id: newId('col'),
    name,
    rootFolder: root,
    requests: {},
    folders: { [root.id]: root },
    variables: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createEnvironment(name: string): Environment {
  return {
    id: newId('env'),
    name,
    variables: [],
    createdAt: Date.now(),
  };
}

/**
 * Structural equality of a request's editable fields — used to detect "dirty" drafts.
 */
export function requestsEqual(a: HttpRequest, b: HttpRequest): boolean {
  return JSON.stringify(stripIdsForCompare(a)) === JSON.stringify(stripIdsForCompare(b));
}

function stripIdsForCompare(r: HttpRequest) {
  return {
    name: r.name,
    method: r.method,
    url: r.url,
    params: r.params.map(kvShape),
    headers: r.headers.map(kvShape),
    body: r.body,
    auth: r.auth,
    captures: r.captures,
  };
}

function kvShape(kv: { enabled: boolean; key: string; value: string; description?: string }) {
  return { enabled: kv.enabled, key: kv.key, value: kv.value, description: kv.description };
}
