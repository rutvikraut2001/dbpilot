import "server-only";

/**
 * Server-side state management for connection-specific settings.
 * This state CANNOT be manipulated by the client, ensuring security.
 */

// Persist on globalThis so it survives HMR recompilation in dev mode.
const globalForState = globalThis as unknown as { __readOnlyState?: Map<string, boolean> };
const readOnlyState = (globalForState.__readOnlyState ??= new Map<string, boolean>());

/**
 * Set the read-only mode for a connection.
 */
export function setReadOnlyMode(connectionId: string, readOnly: boolean): void {
  readOnlyState.set(connectionId, readOnly);
}

/**
 * Check if a connection is in read-only mode.
 * Defaults to true (safe) if not explicitly set.
 */
export function isReadOnlyMode(connectionId: string): boolean {
  return readOnlyState.get(connectionId) ?? true;
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
