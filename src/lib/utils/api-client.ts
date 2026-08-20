/**
 * Client-side wrapper around fetch for this app's API.
 *
 * Exists because every call site was hand-rolling its own error handling — and
 * mostly getting it wrong. Three failure modes were being conflated or dropped:
 *
 *   - a transport failure (offline, server down) threw and was swallowed
 *   - a non-2xx response was parsed as if it were data, so `result.data` came
 *     back undefined and the caller silently returned
 *   - a 429 from the rate limiter looked like any other failure, so the user got
 *     a blank panel with no hint that backing off would fix it
 *
 * Every API call should go through `apiFetch`, which turns all three into a
 * typed `ApiError` carrying a message worth showing someone.
 */

export class ApiError extends Error {
  readonly status: number;
  /** Seconds to wait, from the Retry-After header. Only set for 429s. */
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    status: number,
    retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  /** Rate limited — retrying after a pause is the correct response. */
  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /** The server has no adapter for this connection; reconnecting is needed. */
  get isConnectionMissing(): boolean {
    return this.status === 404;
  }

  /** Blocked by read-only mode or a forced read-only deployment. */
  get isForbidden(): boolean {
    return this.status === 403;
  }
}

/** Status 0 marks a request that never reached the server. */
export const NETWORK_ERROR_STATUS = 0;

function rateLimitMessage(retryAfterSeconds?: number): string {
  const wait = retryAfterSeconds
    ? `Retry in ${retryAfterSeconds}s.`
    : 'Please wait a moment and try again.';
  return `Too many requests. ${wait}`;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (body && typeof body.error === 'string') return body.error;
  } catch {
    // Non-JSON error body (e.g. an HTML error page) — fall through.
  }
  return `Request failed with status ${response.status}`;
}

export interface ApiFetchOptions {
  /**
   * Whether a 2xx body carrying an `error` field counts as a failure.
   * Defaults to true, because most routes report problems that way and callers
   * were reading straight past it.
   *
   * Set false where a reported error is itself a meaningful result. `/api/query`
   * is the case: a SQL error comes back alongside `executionTimeMs` and
   * `rowCount`, and throwing would discard them — a failed query would lose the
   * timing the server had already measured.
   */
  bodyErrorIsFailure?: boolean;
}

/**
 * Fetch and parse a JSON API response, throwing `ApiError` on any failure.
 */
export async function apiFetch<T>(
  url: string,
  init?: RequestInit,
  options?: ApiFetchOptions
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiError(
      'Could not reach the server. Check that it is running and try again.',
      NETWORK_ERROR_STATUS
    );
  }

  if (response.status === 429) {
    const header = response.headers.get('Retry-After');
    const retryAfterSeconds = header ? Number(header) : undefined;
    throw new ApiError(
      rateLimitMessage(
        Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined
      ),
      429,
      Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined
    );
  }

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError('The server returned a malformed response.', response.status);
  }

  if (
    options?.bodyErrorIsFailure !== false &&
    body &&
    typeof body === 'object' &&
    'error' in body &&
    typeof (body as { error: unknown }).error === 'string'
  ) {
    throw new ApiError((body as { error: string }).error, response.status);
  }

  return body as T;
}

/** A message suitable for showing a user, for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
