import { z } from "zod";

// Identifier validation regex - alphanumeric, underscore, dot (for schema.table)
const identifierRegex = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/;
const columnNameRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
// Redis key patterns allow colons, wildcards, hyphens, dots, and digits at start
const redisPatternRegex = /^[a-zA-Z0-9_:.*\-]+$/;

export const TableNameSchema = z
  .string()
  .min(1, "Table name required")
  .max(256, "Table name too long")
  .refine(
    (val) => identifierRegex.test(val) || redisPatternRegex.test(val),
    "Invalid table name"
  );

export const ColumnNameSchema = z
  .string()
  .min(1, "Column name required")
  .max(128, "Column name too long")
  .regex(columnNameRegex, "Invalid column name");

export const ConnectionIdSchema = z
  .string()
  .min(1, "Connection ID required")
  .startsWith("conn_", "Invalid connection ID format");

/**
 * An index name. Same shape as a column name — every engine here accepts a
 * plain identifier, and the adapters validate again before interpolating.
 */
export const IndexNameSchema = z
  .string()
  .min(1, "Index name required")
  .max(128, "Index name too long")
  .regex(columnNameRegex, "Invalid index name");

/**
 * A field an index can be built on.
 *
 * Deliberately looser than ColumnNameSchema: MongoDB indexes nested fields by
 * dotted path (`profile.tier`), which is a legitimate field name there and a
 * malformed identifier in SQL. Being permissive here is safe because it is not
 * the boundary — each SQL adapter runs its own stricter `validateColumnName`
 * before the name reaches a statement, and rejects the dotted form.
 */
export const IndexFieldSchema = z
  .string()
  .min(1, "Field name required")
  .max(128, "Field name too long")
  .regex(
    /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/,
    "Invalid field name"
  );

/**
 * A database name.
 *
 * Far looser than ColumnNameSchema on purpose: real databases are called
 * `CR-DB`, `next-plugin`, `ugp_bos_2.0`, and an identifier pattern would make
 * them unreachable. What makes this safe is quoting at the adapter, not
 * restriction here — see `src/lib/database-name.ts`.
 */
export const DatabaseNameSchema = z
  .string()
  .min(1, "Database name required")
  .max(64, "Database name too long")
  .refine((value) => value === value.trim(), "Database name cannot start or end with a space")
  .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), "Database name cannot contain control characters");

export const CreateDatabaseSchema = z.object({
  connectionId: ConnectionIdSchema,
  name: DatabaseNameSchema,
  // MongoDB only: a database exists once it holds a collection.
  initialCollection: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_.-]*$/, "Invalid collection name")
    .optional(),
});

export const CreateIndexSchema = z.object({
  connectionId: ConnectionIdSchema,
  table: TableNameSchema,
  name: IndexNameSchema,
  columns: z
    .array(IndexFieldSchema)
    .min(1, "An index needs at least one column")
    .max(32, "Too many columns for one index"),
  unique: z.boolean().optional(),
  // Checked against a per-adapter allowlist, not here: the valid set differs by
  // engine (PostgreSQL's gin, MySQL's fulltext, MongoDB's hashed).
  method: z.string().max(32).optional(),
  where: z.string().max(2000).optional(),
  concurrent: z.boolean().optional(),
});

export const QueryOptionsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  // Ceiling matches MAX_PAGE_SIZE in the data route.
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
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
    msg = msg.replace(/mysql:\/\/[^@]+@/gi, "mysql://***@");
    msg = msg.replace(/mariadb:\/\/[^@]+@/gi, "mariadb://***@");
    msg = msg.replace(/mongodb:\/\/[^@]+@/gi, "mongodb://***@");
    msg = msg.replace(/mongodb\+srv:\/\/[^@]+@/gi, "mongodb+srv://***@");
    msg = msg.replace(/clickhouse:\/\/[^@]+@/gi, "clickhouse://***@");
    msg = msg.replace(/redis:\/\/[^@]+@/gi, "redis://***@");
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
