import "server-only";

/**
 * Server-side configuration from environment variables.
 * Provides typed access to configuration values with sensible defaults.
 */

export const config = {
  // Environment
  isDevelopment: process.env.NODE_ENV === "development",
  isProduction: process.env.NODE_ENV === "production",
  nodeEnv: process.env.NODE_ENV || "development",

  // Force all connections to be read-only (for shared/demo instances)
  forceReadOnly: process.env.FORCE_READ_ONLY === "true",

  // Rate limiting
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000"),
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100"),

  // Audit logging
  auditLogEnabled: process.env.AUDIT_LOG_ENABLED !== "false", // Enabled by default
  auditLogMaxEntries: parseInt(process.env.AUDIT_LOG_MAX_ENTRIES || "1000"),
} as const;

/**
 * Validate configuration on startup.
 * Logs warnings for any misconfigurations.
 */
export function validateConfig(): void {
  if (config.isProduction && !config.forceReadOnly) {
    console.warn(
      "[CONFIG] Running in production without FORCE_READ_ONLY=true. " +
        "Consider enabling read-only mode for shared instances."
    );
  }

  if (config.rateLimitMaxRequests < 10) {
    console.warn(
      "[CONFIG] RATE_LIMIT_MAX_REQUESTS is very low. " +
        "This may cause issues for legitimate users."
    );
  }
}
