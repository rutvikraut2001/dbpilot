import "server-only";

import { config } from "./config";

/**
 * Server-side state management for connection-specific settings.
 *
 * This is the authority on whether a connection may write. The client can
 * *request* a change through POST /api/settings (a deliberate, audited user
 * action), but it can never assert the state as a side effect of connecting,
 * and it can never override FORCE_READ_ONLY.
 *
 * Two invariants:
 *   1. Unknown connection → read-only. Absence of state never means "writable".
 *   2. FORCE_READ_ONLY=true → read-only, unconditionally, for every connection.
 */

interface ConnectionAccess {
  readOnly: boolean;
  /**
   * When temporary write access lapses (ms since epoch). Absent means the
   * setting has no expiry. Enforced here rather than by a client-side timer, so
   * closing the tab or editing local state cannot extend it.
   */
  writeExpiresAt?: number;
  /** Why write access was requested — recorded for the audit log. */
  reason?: string;
}

export interface WriteAccessState {
  readOnly: boolean;
  writeExpiresAt?: number;
  reason?: string;
}

export interface GrantWriteOptions {
  /** Minutes of write access before it reverts automatically. */
  durationMinutes?: number;
  reason?: string;
}

// Persist on globalThis so it survives HMR recompilation in dev mode.
const globalForState = globalThis as unknown as {
  __readOnlyState?: Map<string, ConnectionAccess>;
};
const readOnlyState = (globalForState.__readOnlyState ??= new Map<
  string,
  ConnectionAccess
>());

/** True when a stored entry granted writes but the grant has since lapsed. */
function isExpired(entry: ConnectionAccess): boolean {
  return (
    !entry.readOnly &&
    entry.writeExpiresAt !== undefined &&
    Date.now() >= entry.writeExpiresAt
  );
}

/**
 * True when the deployment forces read-only for every connection, which no
 * client request can override.
 */
export function isForceReadOnly(): boolean {
  return config.forceReadOnly;
}

/**
 * Check if a connection is in read-only mode.
 * Defaults to true (safe) when the connection has no recorded state.
 */
export function isReadOnlyMode(connectionId: string): boolean {
  if (config.forceReadOnly) return true;

  const entry = readOnlyState.get(connectionId);
  if (!entry) return true;

  // A lapsed grant reverts to read-only without anything having to run.
  return entry.readOnly || isExpired(entry);
}

/**
 * Apply an explicit read-only setting for a connection.
 * Returns the effective value, which is `true` regardless of the request when
 * the deployment forces read-only — callers should report this back so the UI
 * can never show a weaker state than the server is actually enforcing.
 */
export function setReadOnlyMode(
  connectionId: string,
  readOnly: boolean,
  options?: GrantWriteOptions
): boolean {
  const effective = config.forceReadOnly ? true : readOnly;

  if (effective) {
    readOnlyState.set(connectionId, { readOnly: true });
    return true;
  }

  const durationMinutes = options?.durationMinutes;
  readOnlyState.set(connectionId, {
    readOnly: false,
    writeExpiresAt:
      durationMinutes && durationMinutes > 0
        ? Date.now() + durationMinutes * 60_000
        : undefined,
    reason: options?.reason,
  });

  return false;
}

/**
 * Full access state for a connection, including when temporary write access
 * lapses. An expired grant is reported as read-only with no expiry, matching
 * what will actually be enforced.
 */
export function getWriteAccess(connectionId: string): WriteAccessState {
  if (isReadOnlyMode(connectionId)) {
    return { readOnly: true };
  }

  const entry = readOnlyState.get(connectionId);
  return {
    readOnly: false,
    writeExpiresAt: entry?.writeExpiresAt,
    reason: entry?.reason,
  };
}

/**
 * Initialize state when a connection is established.
 *
 * Deliberately does NOT accept a value from the caller. A new connection starts
 * read-only, and an existing connection keeps whatever it already had — so a
 * reconnect (e.g. the studio page's auto-reconnect on reload) can never quietly
 * downgrade a connection from read-only to writable.
 */
export function initReadOnlyMode(connectionId: string): boolean {
  if (!readOnlyState.has(connectionId)) {
    readOnlyState.set(connectionId, { readOnly: true });
  }
  return isReadOnlyMode(connectionId);
}

/**
 * Clear read-only state for a connection (on disconnect).
 */
export function clearReadOnlyState(connectionId: string): void {
  readOnlyState.delete(connectionId);
}

/**
 * Get all connection IDs with their read-only states.
 * Used for debugging/monitoring purposes only.
 */
export function getAllReadOnlyStates(): Map<string, boolean> {
  return new Map(
    Array.from(readOnlyState.keys()).map((id) => [id, isReadOnlyMode(id)])
  );
}
