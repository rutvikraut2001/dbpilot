// Database Adapter Types - Unified interface for all database types

export type DatabaseType = 'postgresql' | 'mongodb' | 'clickhouse' | 'redis';

/**
 * Query language family. Determines how read-only mode is enforced:
 * `sql` adapters push enforcement down to the engine, while `mongodb`/`redis`
 * have no per-session equivalent and rely on command inspection.
 */
export type QueryDialect = 'sql' | 'mongodb' | 'redis';

export interface ExecuteQueryOptions {
  /**
   * Execute with writes prohibited. SQL adapters must enforce this at the engine
   * level (PostgreSQL `SET TRANSACTION READ ONLY`, ClickHouse `readonly=1`)
   * rather than by inspecting the query text.
   */
  readOnly?: boolean;
  /**
   * Caller-supplied handle for this execution, so it can be cancelled while in
   * flight. Adapters that support cancellation register the underlying backend
   * against it for the duration of the query.
   */
  runId?: string;
}

export interface AdapterCapabilities {
  supportsUpdate: boolean;
  supportsDelete: boolean;
  supportsTransactions: boolean;
}

export interface SSHTunnelConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  authMethod: 'password' | 'privateKey';
  password?: string;
  privateKey?: string;
  passphrase?: string;
  // Remote DB host:port as seen from SSH server (auto-parsed from connection string if omitted)
  remoteHost?: string;
  remotePort?: number;
}

/**
 * Which environment a connection points at. Purely a client-side label — the
 * server does not treat production differently — but it drives the visual
 * treatment and the extra confirmation on destructive statements, which is what
 * actually prevents "I thought that was staging".
 */
export type ConnectionEnvironment = 'development' | 'staging' | 'production';

export interface ConnectionConfig {
  type: DatabaseType;
  connectionString: string;
  name: string;
  id: string;
  sshTunnel?: SSHTunnelConfig;
  /** Defaults to 'development' when absent (including for pre-existing saved connections). */
  environment?: ConnectionEnvironment;
}

export interface TableInfo {
  name: string;
  type: 'table' | 'collection' | 'view' | 'keyspace';
  schema?: string; // For PostgreSQL
  rowCount?: number;
  sizeBytes?: number;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  defaultValue?: string;
  foreignKeyRef?: {
    table: string;
    column: string;
  };
  // For PostgreSQL enum columns — the allowed values
  enumValues?: string[];
  // For MongoDB - indicates if field is commonly present
  frequency?: number;
}

export interface Relationship {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
}

export interface QueryOptions {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  filters?: Record<string, unknown>;
  /**
   * Whether to run the COUNT query alongside the page fetch. Defaults to true.
   *
   * Counting is often the dominant cost of browsing a large table — it scans
   * where the page fetch does not — and the total only changes when the data
   * does. The API layer caches it per (connection, table, filters) and passes
   * `false` on subsequent pages, supplying the cached total itself.
   */
  includeTotal?: boolean;
  /**
   * Explicit, multi-column ordering. Takes precedence over `sortBy`.
   *
   * Required for correctness when paging through an entire table: LIMIT/OFFSET
   * over an unordered query has no stability guarantee, so successive pages can
   * repeat and skip rows. Exports pass the primary key here.
   */
  orderBy?: string[];
}

export interface PaginatedResult<T = Record<string, unknown>> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  columns: string[];
  rowCount: number;
  executionTimeMs: number;
  error?: string;
  /** Set when `rows` was capped and does not contain the full result set. */
  truncated?: boolean;
  /** Rows the query actually produced, present only when `truncated` is set. */
  totalRows?: number;
}

export interface BulkDeleteResult {
  deleted: number;
  failed: number;
  /** First error encountered, for surfacing a reason when some rows fail. */
  error?: string;
}

export interface TableStats {
  rowCount: number;
  sizeBytes: number;
  indexCount: number;
  lastModified?: Date;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
  type: string;
}

// The unified database adapter interface
export interface DatabaseAdapter {
  // Adapter capabilities (for adapters with limitations like ClickHouse)
  readonly capabilities?: AdapterCapabilities;

  // Query language family, used to pick the right read-only enforcement.
  readonly dialect: QueryDialect;

  // Connection management
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(): Promise<{ success: boolean; message: string }>;
  isConnected(): boolean;
  // Lightweight health check using existing connection (no new connections)
  ping(): Promise<boolean>;

  // Schema operations
  getTables(): Promise<TableInfo[]>;
  getTableSchema(tableName: string): Promise<ColumnInfo[]>;
  getRelationships(): Promise<Relationship[]>;

  // Data operations
  getRows(table: string, options: QueryOptions): Promise<PaginatedResult>;
  insertRow(table: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
  updateRow(table: string, primaryKey: Record<string, unknown>, data: Record<string, unknown>): Promise<Record<string, unknown>>;
  deleteRow(table: string, primaryKey: Record<string, unknown>): Promise<boolean>;
  /**
   * Delete many rows in one call. BaseAdapter provides a sequential fallback;
   * adapters that can express this as a single statement should override it.
   */
  deleteRows(table: string, primaryKeys: Record<string, unknown>[]): Promise<BulkDeleteResult>;

  // Query execution
  executeQuery(query: string, options?: ExecuteQueryOptions): Promise<QueryResult>;

  /**
   * Ask the planner how many rows a statement would affect, without running it.
   * Returns null when the adapter or the statement cannot be estimated.
   */
  estimateAffectedRows?(statement: string): Promise<number | null>;

  /**
   * Ask the database to abort an in-flight query started with this `runId`.
   * Returns false when the run is unknown (already finished) or the engine
   * offers no way to cancel.
   */
  cancelQuery?(runId: string): Promise<boolean>;

  // Analytics
  getTableStats(table: string): Promise<TableStats>;
  getIndexInfo(table: string): Promise<IndexInfo[]>;
  getDatabaseStats(): Promise<{
    totalSize: number;
    tableCount: number;
    version: string;
  }>;
}

// Base adapter class with common functionality
export abstract class BaseAdapter implements DatabaseAdapter {
  abstract readonly dialect: QueryDialect;

  protected connectionString: string;
  protected connected: boolean = false;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract testConnection(): Promise<{ success: boolean; message: string }>;
  abstract ping(): Promise<boolean>;

  isConnected(): boolean {
    return this.connected;
  }

  abstract getTables(): Promise<TableInfo[]>;
  abstract getTableSchema(tableName: string): Promise<ColumnInfo[]>;
  abstract getRelationships(): Promise<Relationship[]>;
  abstract getRows(table: string, options: QueryOptions): Promise<PaginatedResult>;
  abstract insertRow(table: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
  abstract updateRow(table: string, primaryKey: Record<string, unknown>, data: Record<string, unknown>): Promise<Record<string, unknown>>;
  abstract deleteRow(table: string, primaryKey: Record<string, unknown>): Promise<boolean>;

  /**
   * Sequential fallback for bulk delete.
   *
   * Even unoptimized this is a large win over the client issuing one HTTP
   * request per row: the round trips collapse to one and the connection is
   * acquired once. Adapters that can do better should override.
   */
  async deleteRows(
    table: string,
    primaryKeys: Record<string, unknown>[]
  ): Promise<BulkDeleteResult> {
    let deleted = 0;
    let failed = 0;
    let firstError: string | undefined;

    for (const primaryKey of primaryKeys) {
      try {
        const ok = await this.deleteRow(table, primaryKey);
        if (ok) deleted++;
        else failed++;
      } catch (error) {
        failed++;
        firstError ??= error instanceof Error ? error.message : String(error);
      }
    }

    return { deleted, failed, error: firstError };
  }
  abstract executeQuery(query: string, options?: ExecuteQueryOptions): Promise<QueryResult>;
  abstract getTableStats(table: string): Promise<TableStats>;
  abstract getIndexInfo(table: string): Promise<IndexInfo[]>;
  abstract getDatabaseStats(): Promise<{ totalSize: number; tableCount: number; version: string }>;
}
