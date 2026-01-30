import "server-only";

/**
 * Server-side state management for connection-specific settings.
 * This state CANNOT be manipulated by the client, ensuring security.
 */

// Server-side read-only state per connection
const readOnlyState = new Map<string, boolean>();

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
