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

// Persist on globalThis so it survives HMR recompilation in dev mode.
const globalForState = globalThis as unknown as { __readOnlyState?: Map<string, boolean> };
const readOnlyState = (globalForState.__readOnlyState ??= new Map<string, boolean>());

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
  return readOnlyState.get(connectionId) ?? true;
}

/**
 * Apply an explicit read-only setting for a connection.
 * Returns the effective value, which is `true` regardless of the request when
 * the deployment forces read-only — callers should report this back so the UI
 * can never show a weaker state than the server is actually enforcing.
 */
export function setReadOnlyMode(connectionId: string, readOnly: boolean): boolean {
  const effective = config.forceReadOnly ? true : readOnly;
  readOnlyState.set(connectionId, effective);
  return effective;
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
    readOnlyState.set(connectionId, true);
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
  return new Map(readOnlyState);
}
