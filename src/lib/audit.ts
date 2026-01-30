import "server-only";

/**
 * Audit logging for tracking database operations.
 * In production, this should be extended to send logs to an external service.
 */

export type AuditAction =
  | "connection.create"
  | "connection.delete"
  | "connection.test"
  | "query.execute"
  | "data.read"
  | "data.insert"
  | "data.update"
  | "data.delete"
  | "settings.change";

interface AuditEntry {
  timestamp: string;
  action: AuditAction;
  connectionId?: string;
  details?: Record<string, unknown>;
  success: boolean;
  error?: string;
}

// In-memory audit log (last 1000 entries)
// In production, this should be sent to an external logging service
const auditLog: AuditEntry[] = [];
const MAX_AUDIT_ENTRIES = 1000;

/**
 * Log an audit entry.
 * @param action The type of action being performed
 * @param options Additional options for the audit entry
 */
export function audit(
  action: AuditAction,
  options: {
    connectionId?: string;
    details?: Record<string, unknown>;
    success: boolean;
    error?: string;
  }
): void {
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    action,
    ...options,
  };

  // Add to in-memory log
  auditLog.push(entry);
  if (auditLog.length > MAX_AUDIT_ENTRIES) {
    auditLog.shift();
  }

  // Console log for development/Docker logs
  // Always log failures, and log successes in development
  const isDev = process.env.NODE_ENV === "development";
  if (isDev || !entry.success) {
    const logLevel = entry.success ? "info" : "warn";
    const details = entry.details
      ? ` ${JSON.stringify(entry.details)}`
      : "";
    const errorMsg = entry.error ? ` Error: ${entry.error}` : "";

    console[logLevel](
      `[AUDIT] ${entry.timestamp} ${entry.action} ${entry.success ? "OK" : "FAIL"} ${entry.connectionId || ""}${details}${errorMsg}`
    );
  }

  // TODO: In production, send to external service
  // Example integrations:
  // await sendToSentry(entry);
  // await sendToDatadog(entry);
  // await sendToCloudWatch(entry);
}

/**
 * Get recent audit log entries.
 * @param limit Maximum number of entries to return (default 100)
 */
export function getAuditLog(limit = 100): AuditEntry[] {
  return auditLog.slice(-limit);
}

/**
 * Clear all audit log entries.
 * Used for testing or manual cleanup.
 */
export function clearAuditLog(): void {
  auditLog.length = 0;
}

/**
 * Get audit log statistics.
 */
export function getAuditStats(): {
  total: number;
  byAction: Record<string, number>;
  failureCount: number;
} {
  const stats = {
    total: auditLog.length,
    byAction: {} as Record<string, number>,
    failureCount: 0,
  };

  for (const entry of auditLog) {
    stats.byAction[entry.action] = (stats.byAction[entry.action] || 0) + 1;
    if (!entry.success) {
      stats.failureCount++;
    }
  }

  return stats;
}
