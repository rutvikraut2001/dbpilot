// Database Adapter Types - Unified interface for all database types

export type DatabaseType = 'postgresql' | 'mysql' | 'mongodb' | 'clickhouse' | 'redis';

/**
 * Query language family. Determines how read-only mode is enforced:
 * `sql` adapters push enforcement down to the engine, while `mongodb`/`redis`
 * have no per-session equivalent and rely on command inspection.
 */
export type QueryDialect = 'sql' | 'mongodb' | 'redis';

export interface ExecuteQueryOptions {
  /**
   * Execute with writes prohibited. SQL adapters must enforce this at the engine
   * level (PostgreSQL `SET TRANSACTION READ ONLY`, MySQL
   * `START TRANSACTION READ ONLY`, ClickHouse `readonly=1`) rather than by
   * inspecting the query text.
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
  /**
   * Whether indexes can be created and dropped through the adapter.
   *
   * Listing is separate and always available — `getIndexInfo` returns `[]` for
   * an engine with no indexes to speak of. This flag governs only the write
   * side, so the UI can show a read-only index list for ClickHouse (whose data
   * skipping indices are declared with the table, not added later) without
   * offering a Create button that could only fail.
   */
  supportsIndexManagement: boolean;
  /**
   * Whether a new database can be created through the adapter.
   *
   * Listing and switching are separate and always available. Redis has a fixed
   * set of numbered keyspaces created by server configuration, so it can offer
   * them for selection without offering a Create button that could only fail.
   */
  supportsDatabaseCreate: boolean;
  /**
   * Whether a table's columns can be altered through the adapter.
   *
   * Off for engines where the operation has no honest synchronous meaning:
   * MongoDB has no schema to alter, and ClickHouse's column changes are
   * asynchronous mutations that rewrite parts in the background rather than
   * completing when the statement returns.
   */
  supportsSchemaEdit: boolean;
}

/** A column to add, as the user described it. */
export interface ColumnDefinition {
  name: string;
  /**
   * The engine's own type name, passed through rather than mapped.
   *
   * A shared type vocabulary across PostgreSQL, MySQL and ClickHouse would have
   * to either lose precision (`varchar(64)` vs `text` vs `String`) or invent a
   * lowest common denominator nobody wants. The UI offers each engine's real
   * types; the adapter validates against what that engine accepts.
   */
  type: string;
  nullable?: boolean;
  /** Raw SQL for the default. Null means no default. */
  defaultValue?: string | null;
}

/**
 * One change to a table's structure.
 *
 * A discriminated union rather than a free-form statement: it is what lets the
 * API decide which changes are destructive, and lets each adapter render the
 * same intent in its own dialect.
 */
export type SchemaChange =
  | { kind: 'addColumn'; column: ColumnDefinition }
  | { kind: 'dropColumn'; name: string }
  | { kind: 'renameColumn'; from: string; to: string }
  | { kind: 'setType'; name: string; type: string; using?: string }
  | { kind: 'setNullable'; name: string; nullable: boolean }
  | { kind: 'setDefault'; name: string; defaultValue: string | null };

/** The SQL an adapter would run for a set of changes, without running it. */
export interface SchemaChangePlan {
  /** Statements in execution order, for the user to review before applying. */
  statements: string[];
  /**
   * Whether the engine applies these atomically.
   *
   * PostgreSQL has transactional DDL, so a failed change rolls the whole edit
   * back. MySQL commits implicitly at each statement, so a batch that fails
   * halfway leaves the earlier changes applied — which the UI must say plainly
   * rather than implying an all-or-nothing edit.
   */
  atomic: boolean;
  /** Human-readable warnings: rewrites, locks, data loss. */
  warnings: string[];
}

/**
 * A database on the connected server.
 *
 * "Database" here is the level *above* tables — a PostgreSQL or MySQL database,
 * a MongoDB database, a ClickHouse database, a numbered Redis keyspace. It is
 * deliberately not PostgreSQL's `schema`, which sits between the two.
 */
export interface DatabaseInfo {
  name: string;
  /** Bytes on disk, when the engine reports it. */
  sizeBytes?: number;
  /**
   * Tables, collections or keys held, when the engine reports it cheaply.
   *
   * Redis has no size in bytes per keyspace but does know the key count, which
   * is the number that tells a user which of sixteen numbered databases they
   * actually want.
   */
  objectCount?: number;
  /** The database this connection is currently reading from. */
  isCurrent: boolean;
  /**
   * Owned by the engine rather than the user — `template1`,
   * `information_schema`, MongoDB's `admin`. Hidden by default in the picker,
   * since selecting one is rarely what someone means to do.
   */
  isSystem: boolean;
}

/** Options for creating a database, where an engine needs more than a name. */
export interface CreateDatabaseOptions {
  /**
   * First collection to create, for MongoDB.
   *
   * MongoDB has no CREATE DATABASE: a database begins to exist when something is
   * written into it, so creating one without a collection would produce a name
   * that disappears again on refresh. Required there, ignored elsewhere.
   */
  initialCollection?: string;
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
  /**
   * Cardinality, read from the schema rather than assumed.
   *
   * A foreign key is one-to-many by default, but one-to-one when the
   * referencing column set is itself unique — the constraint that stops a second
   * child row pointing at the same parent. Both adapters previously returned
   * `one-to-many` unconditionally, so the diagram labelled every edge `1:N`
   * whether or not that was true.
   */
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
  /**
   * Whether the child row may exist without a parent.
   *
   * True when the referencing column is nullable. This is the second axis of
   * crow's-foot notation — zero-or-one versus exactly-one — and is what
   * separates an optional association from a required one.
   */
  optional?: boolean;
  /**
   * Set when this relationship passes through a junction table: a table whose
   * primary key is made up entirely of foreign keys to exactly two other tables
   * and which carries no other meaning of its own.
   *
   * The relationship is still stored as the two real foreign keys; this only
   * marks them as the two halves of a many-to-many so the diagram can say so.
   */
  viaJunctionTable?: string;
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
  /** Bytes on disk. Absent when the engine does not expose it. */
  sizeBytes?: number;
  /**
   * Times the planner has chosen this index since statistics were last reset.
   *
   * `0` is a real, meaningful answer — it is what identifies an index nothing
   * reads — so this must stay `undefined` when the engine cannot tell us,
   * rather than defaulting to zero and accusing every index of being unused.
   */
  scans?: number;
  /** The engine's own DDL for the index, when it can produce it. */
  definition?: string;
  /** Set when the index covers only a subset of rows (a partial index). */
  isPartial?: boolean;
}

/** How an index should be built. Shared by every adapter that supports it. */
export interface CreateIndexOptions {
  name: string;
  columns: string[];
  unique?: boolean;
  /**
   * Engine-specific index method — PostgreSQL's `btree`/`hash`/`gin`/`gist`,
   * MySQL's `BTREE`/`HASH`, MongoDB's `1`/`text`/`hashed`. Validated against a
   * per-adapter allowlist rather than interpolated as given.
   */
  method?: string;
  /**
   * Predicate for a partial index. PostgreSQL and MongoDB only; adapters
   * without support must reject it rather than silently build a full index,
   * which would quietly cost far more disk than the user asked for.
   */
  where?: string;
  /**
   * Build without taking a write lock on the table (PostgreSQL `CONCURRENTLY`).
   *
   * Cannot run inside a transaction, and a failed concurrent build leaves an
   * INVALID index behind that must be dropped by hand — so adapters that honour
   * it must say so, and callers must treat it as the considered choice it is.
   */
  concurrent?: boolean;
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

  /**
   * Databases visible to these credentials.
   *
   * Available on every adapter: connecting without naming a database is
   * legitimate, and this is what lets the user pick one afterwards rather than
   * being dropped into whichever database the driver happened to default to.
   */
  listDatabases(): Promise<DatabaseInfo[]>;

  /**
   * The database currently in use, or null when none has been selected.
   *
   * Null is a real state, not an error. A connection string with no database
   * leaves the adapter connected to the *server* with nothing chosen, and the UI
   * shows the picker rather than an empty, unexplained table list.
   */
  getCurrentDatabase(): string | null;

  /**
   * Point this connection at a different database.
   *
   * PostgreSQL, MySQL and ClickHouse cannot change database on an open
   * connection, so those adapters rebuild their pool; MongoDB and Redis switch
   * in place. Either way the caller must treat cached schema and open table tabs
   * as invalid afterwards — they name tables that need not exist in the new one.
   */
  useDatabase(name: string): Promise<void>;

  /** Create a database. Only defined when `capabilities.supportsDatabaseCreate`. */
  createDatabase?(name: string, options?: CreateDatabaseOptions): Promise<void>;

  /**
   * Render a set of structural changes as statements, without running them.
   *
   * Separate from applying so the user can read exactly what will run. For a
   * change that rewrites a table or discards a column, seeing the statement is
   * the difference between confirming a described intent and confirming a
   * black box.
   */
  planSchemaChanges?(
    table: string,
    changes: SchemaChange[]
  ): Promise<SchemaChangePlan>;

  /**
   * Apply structural changes to a table.
   *
   * Only defined when `capabilities.supportsSchemaEdit`.
   */
  alterTable?(table: string, changes: SchemaChange[]): Promise<void>;

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

  /**
   * Create an index. Only defined when `capabilities.supportsIndexManagement`.
   *
   * Returns the index as the engine actually stored it — the name may have been
   * chosen by the server, and the method may have been substituted.
   */
  createIndex?(table: string, options: CreateIndexOptions): Promise<IndexInfo>;

  /**
   * Drop an index. Only defined when `capabilities.supportsIndexManagement`.
   *
   * Returns false when no such index existed. Must refuse to drop the primary
   * key: on most engines that is not an index the user can lose independently
   * of the constraint it implements.
   */
  dropIndex?(table: string, indexName: string): Promise<boolean>;

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

  abstract listDatabases(): Promise<DatabaseInfo[]>;
  abstract getCurrentDatabase(): string | null;
  abstract useDatabase(name: string): Promise<void>;
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
