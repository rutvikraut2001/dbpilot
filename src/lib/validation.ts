import { z } from "zod";

// Identifier validation regex - alphanumeric, underscore, dot (for schema.table)
const identifierRegex = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/;
const columnNameRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export const TableNameSchema = z
  .string()
  .min(1, "Table name required")
  .max(128, "Table name too long")
  .regex(identifierRegex, "Invalid table name");

export const ColumnNameSchema = z
  .string()
  .min(1, "Column name required")
  .max(128, "Column name too long")
  .regex(columnNameRegex, "Invalid column name");

export const ConnectionIdSchema = z
  .string()
  .min(1, "Connection ID required")
  .startsWith("conn_", "Invalid connection ID format");

export const QueryOptionsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  sortBy: z
    .string()
    .regex(columnNameRegex, "Invalid sort column")
    .optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
});

export const DataWriteSchema = z.object({
  connectionId: ConnectionIdSchema,
  table: TableNameSchema,
  data: z.record(z.string(), z.unknown()),
});

export const DataUpdateSchema = z.object({
  connectionId: ConnectionIdSchema,
  table: TableNameSchema,
  primaryKey: z.record(z.string(), z.unknown()),
  data: z.record(z.string(), z.unknown()),
});

export const QueryExecuteSchema = z.object({
  connectionId: ConnectionIdSchema,
  query: z.string().min(1, "Query required").max(100000, "Query too long"),
});

/**
 * Sanitize error messages to prevent information leakage.
 * Strips credentials, paths, and other sensitive data.
 */
export function sanitizeError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return "Invalid request parameters";
  }

  if (error instanceof Error) {
    let msg = error.message;

    // Remove credentials from connection strings
    msg = msg.replace(/postgresql:\/\/[^@]+@/gi, "postgresql://***@");
    msg = msg.replace(/mongodb:\/\/[^@]+@/gi, "mongodb://***@");
    msg = msg.replace(/mongodb\+srv:\/\/[^@]+@/gi, "mongodb+srv://***@");
    msg = msg.replace(/clickhouse:\/\/[^@]+@/gi, "clickhouse://***@");
    msg = msg.replace(/http:\/\/[^@]+@/gi, "http://***@");
    msg = msg.replace(/https:\/\/[^@]+@/gi, "https://***@");

    // Remove file paths
    msg = msg.replace(/\/home\/[^\s]+/g, "/home/***");
    msg = msg.replace(/\/Users\/[^\s]+/g, "/Users/***");
    msg = msg.replace(/C:\\Users\\[^\s]+/gi, "C:\\Users\\***");

    // Remove password mentions
    msg = msg.replace(/password[=:]\s*\S+/gi, "password=***");

    // Truncate long messages
    if (msg.length > 500) {
      msg = msg.slice(0, 500) + "...";
    }

    return msg;
  }

  return "An unexpected error occurred";
}

/**
 * Validate an identifier (table or column name).
 * Throws if invalid.
 */
export function validateIdentifier(name: string): void {
  if (!identifierRegex.test(name)) {
    throw new Error(`Invalid identifier: ${name}`);
  }
}

/**
 * Validate a column name.
 * Throws if invalid.
 */
export function validateColumnName(name: string): void {
  if (!columnNameRegex.test(name)) {
    throw new Error(`Invalid column name: ${name}`);
  }
}

/**
 * Validate all column names in a data record.
 * Throws if any column name is invalid.
 */
export function validateColumnNames(data: Record<string, unknown>): void {
  for (const key of Object.keys(data)) {
    validateColumnName(key);
  }
}

/**
 * Quote a PostgreSQL identifier for safe use in queries.
 * Validates first, then quotes with double quotes.
 */
export function quotePostgresIdentifier(name: string): string {
  validateIdentifier(name);
  return name
    .split(".")
    .map((part) => `"${part}"`)
    .join(".");
}
