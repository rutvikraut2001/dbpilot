export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

export type AuthType = 'none' | 'bearer' | 'basic' | 'apiKey';

export type BodyMode =
  | 'none'
  | 'json'
  | 'form-data'
  | 'urlencoded'
  | 'raw'
  | 'binary';

export interface KV {
  id: string;
  enabled: boolean;
  key: string;
  value: string;
  description?: string;
}

export interface AuthConfig {
  type: AuthType;
  token?: string;
  username?: string;
  password?: string;
  apiKey?: {
    key: string;
    value: string;
    in: 'header' | 'query';
  };
}

export interface RequestBody {
  mode: BodyMode;
  raw?: string;
  rawLanguage?: 'json' | 'xml' | 'text' | 'html';
  formData?: KV[];
  urlencoded?: KV[];
}

// A variable captured from a response, written back into the active environment
export interface ResponseCapture {
  id: string;
  name: string;                  // variable name (target in env)
  source: 'body-json' | 'header' | 'status';
  jsonPath?: string;             // e.g. "$.data.token" — simple dotted path
  headerName?: string;
}

export interface HttpRequest {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: KV[];
  headers: KV[];
  body: RequestBody;
  auth: AuthConfig;
  captures: ResponseCapture[];
  // v1 reserves fields below for future scripting support; do NOT use in v1
  preScript?: string;
  testScript?: string;
}

export interface Folder {
  id: string;
  name: string;
  requestIds: string[];
  folderIds: string[];
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  rootFolder: Folder;
  requests: Record<string, HttpRequest>;
  folders: Record<string, Folder>;
  variables: KV[];
  createdAt: number;
  updatedAt: number;
}

export interface Environment {
  id: string;
  name: string;
  variables: KV[];
  createdAt: number;
}

export interface ResponseTimings {
  total: number;
  ttfb?: number;
  download?: number;
}

export interface HttpRedirect {
  from: string;
  to: string;
  status: number;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  ok: boolean;
  headers: Record<string, string>;
  body: string;                  // binary → 'base64:<...>' prefix
  size: number;                  // bytes
  contentType: string | null;
  timings: ResponseTimings;
  redirects: HttpRedirect[];
  effectiveUrl: string;
  rewroteHost?: {
    from: string;
    to: string;
  };
}

export interface HttpErrorResult {
  error: string;
  effectiveUrl?: string;
  timings?: ResponseTimings;
}

export type ExecutionResult = HttpResponse | HttpErrorResult;

export function isHttpResponse(r: ExecutionResult): r is HttpResponse {
  return typeof (r as HttpResponse).status === 'number';
}

export interface HistoryEntry {
  id: string;
  at: number;
  requestSnapshot: HttpRequest;
  environmentId: string | null;
  result: ExecutionResult;
}

export interface OpenRequestTab {
  id: string;                    // tab id
  collectionId: string;
  requestId: string;
  draft: HttpRequest;            // live, editable copy
  dirty: boolean;                // draft differs from stored request
}

export type SidebarTab = 'collections' | 'history' | 'environments';
