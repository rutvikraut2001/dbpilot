import { Pool, PoolClient } from "pg";
import {
  BaseAdapter,
  TableInfo,
  ColumnInfo,
  Relationship,
  QueryOptions,
  PaginatedResult,
  QueryResult,
  TableStats,
  IndexInfo,
  DatabaseInfo,
  CreateIndexOptions,
  AdapterCapabilities,
  ExecuteQueryOptions,
  QueryDialect,
  BulkDeleteResult,
} from "./types";
import { splitSqlStatements } from "../query-guard";
import { quoteDoubleQuoted, withDatabase } from "../database-name";

export class PostgresAdapter extends BaseAdapter {
  readonly dialect: QueryDialect = "sql";

  readonly capabilities: AdapterCapabilities = {
    supportsUpdate: true,
    supportsDelete: true,
    supportsTransactions: true,
    supportsIndexManagement: true,
    supportsDatabaseCreate: true,
  };

  /**
   * Database the pool is connected to.
   *
   * Read back from the server rather than parsed from the connection string:
   * `pg` silently defaults a URL with no database to one named after the *user*,
   * so the string is not a reliable statement of where queries are actually
   * going. Asking `current_database()` is.
   */
  private currentDatabase: string | null = null;

  private pool: Pool | null = null;

  /**
   * Backend process id per in-flight run, so a query can be cancelled.
   *
   * Cancellation in PostgreSQL is out-of-band: you cannot interrupt a connection
   * that is waiting on a result, you ask the *server* to signal that backend
   * from a different connection. That needs its pid, captured when the query
   * starts.
   */
  private readonly runningBackends = new Map<string, number>();

  async connect(): Promise<void> {
    try {
      this.pool = new Pool({
        connectionString: this.connectionString,
        // Production-ready pool settings
        max: 20, // Max connections for high traffic
        min: 2, // Keep minimum connections ready
        idleTimeoutMillis: 30000, // Close idle connections after 30s
        connectionTimeoutMillis: 10000, // Connection timeout
        // Keep connections alive
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
      });

      // Set statement timeout for all queries (30 seconds max)
      this.pool.on("connect", (client) => {
        client.query("SET statement_timeout = '30000'");
      });

      // Test the connection, and record where it actually landed.
      const client = await this.pool.connect();
      const resolved = await client.query("SELECT current_database() AS db");
      this.currentDatabase = resolved.rows[0]?.db ?? null;
      client.release();
      this.connected = true;
    } catch (error) {
      this.connected = false;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.connected = false;
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    let client: PoolClient | null = null;
    try {
      const testPool = new Pool({
        connectionString: this.connectionString,
        max: 1,
        connectionTimeoutMillis: 5000,
      });

      client = await testPool.connect();
      const result = await client.query("SELECT version()");
      client.release();
      await testPool.end();

      return {
        success: true,
        message: `Connected successfully. ${result.rows[0].version}`,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Connection failed",
      };
    }
  }

  /**
   * Lightweight health check using existing pool (no new connections).
   * Use this for reconnect checks instead of testConnection.
   */
  async ping(): Promise<boolean> {
    if (!this.pool) return false;
    try {
      const client = await this.pool.connect();
      await client.query("SELECT 1");
      client.release();
      return true;
    } catch {
      return false;
    }
  }

  private getPool(): Pool {
    if (!this.pool) {
      throw new Error("Database not connected. Call connect() first.");
    }
    return this.pool;
  }

  /**
   * Validate an identifier (table or column name) to prevent SQL injection.
   * Only allows alphanumeric, underscore, and dot (for schema.table format).
   */
  private validateIdentifier(name: string): void {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/.test(name)) {
      throw new Error(`Invalid identifier: ${name}`);
    }
  }

  /**
   * Validate a column name to prevent SQL injection.
   */
  private validateColumnName(name: string): void {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`Invalid column name: ${name}`);
    }
  }

  /**
   * Quote and validate an identifier for safe use in queries.
   */
  private quoteIdentifier(name: string): string {
    this.validateIdentifier(name);
    return name
      .split(".")
      .map((part) => `"${part}"`)
      .join(".");
  }

  getCurrentDatabase(): string | null {
    return this.currentDatabase;
  }

  async listDatabases(): Promise<DatabaseInfo[]> {
    const pool = this.getPool();

    // datallowconn excludes template0, which refuses connections by design, so
    // offering it would only produce a confusing failure. The templates that do
    // allow connections are listed but marked as system.
    const result = await pool.query(`
      SELECT
        d.datname AS name,
        pg_database_size(d.datname) AS size_bytes,
        d.datistemplate AS is_template
      FROM pg_database d
      WHERE d.datallowconn
      ORDER BY d.datname
    `);

    return result.rows.map((row) => ({
      name: row.name,
      sizeBytes: Number(row.size_bytes) || 0,
      isCurrent: row.name === this.currentDatabase,
      isSystem: row.is_template || row.name === "postgres",
    }));
  }

  /**
   * Reconnect the pool against another database.
   *
   * PostgreSQL binds a connection to one database for its lifetime — there is no
   * `USE`, and the protocol offers no way to change it — so switching means
   * building a new pool and discarding the old one. The old pool is ended only
   * after the new one connects, so a failed switch leaves the adapter on the
   * database it was already using rather than on nothing at all.
   */
  async useDatabase(name: string): Promise<void> {
    const target = withDatabase(this.connectionString, name);
    if (target === this.connectionString && name === this.currentDatabase) {
      return;
    }

    const previousPool = this.pool;
    const previousConnectionString = this.connectionString;

    this.pool = null;
    this.connectionString = target;

    try {
      await this.connect();
    } catch (error) {
      // Put the working pool back; the caller sees the failure, not a dead
      // adapter.
      this.connectionString = previousConnectionString;
      this.pool = previousPool;
      this.connected = previousPool !== null;
      throw error;
    }

    await previousPool?.end().catch(() => {
      /* the old pool is being discarded either way */
    });
  }

  /**
   * Create a database.
   *
   * `CREATE DATABASE` cannot run inside a transaction block, so this goes
   * through the pool directly rather than a managed client. The name is quoted
   * rather than validated against an identifier pattern — real databases are
   * called things like `CR-DB` and `ugp_bos_2.0`, which no identifier regex
   * accepts.
   */
  async createDatabase(name: string): Promise<void> {
    const pool = this.getPool();
    await pool.query(`CREATE DATABASE ${quoteDoubleQuoted(name)}`);
  }

  async getTables(): Promise<TableInfo[]> {
    const pool = this.getPool();

    const query = `
      SELECT
        t.table_schema as schema,
        t.table_name as name,
        t.table_type as type,
        pg_total_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name)) as size_bytes,
        (SELECT reltuples::bigint FROM pg_class WHERE oid = (quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))::regclass) as row_count
      FROM information_schema.tables t
      WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY t.table_schema, t.table_name
    `;

    const result = await pool.query(query);

    return result.rows.map((row) => ({
      name: row.name,
      schema: row.schema,
      type: row.type === "VIEW" ? "view" : "table",
      rowCount: parseInt(row.row_count) || 0,
      sizeBytes: parseInt(row.size_bytes) || 0,
    }));
  }

  async getTableSchema(tableName: string): Promise<ColumnInfo[]> {
    const pool = this.getPool();

    // Parse schema.table format
    const [schema, table] = tableName.includes(".")
      ? tableName.split(".")
      : ["public", tableName];

    const query = `
      SELECT
        c.column_name as name,
        c.data_type as type,
        c.udt_name as udt_name,
        c.is_nullable = 'YES' as nullable,
        c.column_default as default_value,
        COALESCE(pk.is_primary, false) as is_primary_key,
        COALESCE(fk.is_foreign, false) as is_foreign_key,
        fk.foreign_table,
        fk.foreign_column
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT kcu.column_name, true as is_primary
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = $1
          AND tc.table_name = $2
      ) pk ON c.column_name = pk.column_name
      LEFT JOIN (
        SELECT
          kcu.column_name,
          true as is_foreign,
          ccu.table_name as foreign_table,
          ccu.column_name as foreign_column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = $1
          AND tc.table_name = $2
      ) fk ON c.column_name = fk.column_name
      WHERE c.table_schema = $1 AND c.table_name = $2
      ORDER BY c.ordinal_position
    `;

    const result = await pool.query(query, [schema, table]);

    // Fetch enum values for USER-DEFINED columns (PostgreSQL enums)
    const udtNames = result.rows
      .filter((row) => row.type === 'USER-DEFINED')
      .map((row) => row.udt_name as string);

    const enumMap: Record<string, string[]> = {};
    if (udtNames.length > 0) {
      const uniqueUdts = [...new Set(udtNames)];
      const enumQuery = `
        SELECT t.typname, e.enumlabel
        FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = ANY($1)
        ORDER BY t.typname, e.enumsortorder
      `;
      const enumResult = await pool.query(enumQuery, [uniqueUdts]);
      for (const row of enumResult.rows) {
        if (!enumMap[row.typname]) enumMap[row.typname] = [];
        enumMap[row.typname].push(row.enumlabel);
      }
    }

    return result.rows.map((row) => ({
      name: row.name,
      type: row.type === 'USER-DEFINED' ? row.udt_name : row.type,
      nullable: row.nullable,
      isPrimaryKey: row.is_primary_key,
      isForeignKey: row.is_foreign_key,
      defaultValue: row.default_value || undefined,
      foreignKeyRef: row.foreign_table
        ? {
            table: row.foreign_table,
            column: row.foreign_column,
          }
        : undefined,
      enumValues: enumMap[row.udt_name] || undefined,
    }));
  }

  async getRelationships(): Promise<Relationship[]> {
    const pool = this.getPool();

    const query = `
      SELECT
        tc.table_name as source_table,
        kcu.column_name as source_column,
        ccu.table_name as target_table,
        ccu.column_name as target_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
    `;

    const result = await pool.query(query);

    return result.rows.map((row) => ({
      sourceTable: row.source_table,
      sourceColumn: row.source_column,
      targetTable: row.target_table,
      targetColumn: row.target_column,
      type: "one-to-many" as const, // Default assumption
    }));
  }

  async getRows(
    table: string,
    options: QueryOptions,
  ): Promise<PaginatedResult> {
    const pool = this.getPool();
    const {
      page,
      pageSize,
      sortBy,
      sortOrder,
      filters,
      includeTotal = true,
      orderBy,
    } = options;

    // Validate and quote table name to prevent SQL injection
    const quotedTable = this.quoteIdentifier(table);
    const offset = (page - 1) * pageSize;
    const params: unknown[] = [];
    let paramIndex = 1;

    // Build WHERE clause from filters with validated column names
    let whereClause = "";
    if (filters && Object.keys(filters).length > 0) {
      const conditions = Object.entries(filters).map(([key, value]) => {
        this.validateColumnName(key);
        params.push(value);
        return `"${key}" = $${paramIndex++}`;
      });
      whereClause = `WHERE ${conditions.join(" AND ")}`;
    }

    // Build ORDER BY clause with validated column names.
    // An explicit multi-column orderBy wins: it is what makes paging through a
    // whole table deterministic.
    let orderClause = "";
    if (orderBy && orderBy.length > 0) {
      const columns = orderBy.map((col) => {
        this.validateColumnName(col);
        return `"${col}"`;
      });
      orderClause = `ORDER BY ${columns.join(", ")}`;
    } else if (sortBy) {
      this.validateColumnName(sortBy);
      orderClause = `ORDER BY "${sortBy}" ${sortOrder === "desc" ? "DESC" : "ASC"}`;
    }

    // Count and page fetch are independent, so run them together rather than
    // making the page wait on a scan it doesn't need. Skipped entirely when the
    // caller already has a cached total.
    const countQuery = `SELECT COUNT(*) as total FROM ${quotedTable} ${whereClause}`;
    const countParams = [...params];

    params.push(pageSize, offset);
    const dataQuery = `
      SELECT * FROM ${quotedTable}
      ${whereClause}
      ${orderClause}
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `;

    const [dataResult, countResult] = await Promise.all([
      pool.query(dataQuery, params),
      includeTotal ? pool.query(countQuery, countParams) : Promise.resolve(null),
    ]);

    const total = countResult ? parseInt(countResult.rows[0].total) : 0;

    return {
      data: dataResult.rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async insertRow(
    table: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const pool = this.getPool();

    // Validate table and column names to prevent SQL injection
    const quotedTable = this.quoteIdentifier(table);
    const columns = Object.keys(data);
    columns.forEach((col) => this.validateColumnName(col));

    // Get column types so we can properly serialize JSON/JSONB values
    const [schema, tbl] = table.includes(".")
      ? table.split(".")
      : ["public", table];
    const colTypeResult = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
      [schema, tbl],
    );
    const colTypes: Record<string, string> = {};
    for (const row of colTypeResult.rows) {
      colTypes[row.column_name] = row.data_type;
    }

    const values = columns.map((col) => {
      const val = data[col];
      if (val === null || val === undefined) return val;
      const dtype = (colTypes[col] || "").toLowerCase();
      // Handle boolean columns: convert string "true"/"false" to actual boolean
      if (dtype === "boolean" && typeof val === "string") {
        return val.toLowerCase() === "true";
      }
      // Handle JSON/JSONB columns
      if (dtype === "json" || dtype === "jsonb") {
        if (typeof val === "object") return JSON.stringify(val);
        if (typeof val === "string") {
          try { JSON.parse(val); return val; } catch { /* pass through */ }
        }
      }
      return val;
    });
    const placeholders = columns.map((_, i) => `$${i + 1}`);

    const query = `
      INSERT INTO ${quotedTable} (${columns.map((c) => `"${c}"`).join(", ")})
      VALUES (${placeholders.join(", ")})
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  async updateRow(
    table: string,
    primaryKey: Record<string, unknown>,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const pool = this.getPool();

    // Validate table and column names to prevent SQL injection
    const quotedTable = this.quoteIdentifier(table);
    const setColumns = Object.keys(data);
    setColumns.forEach((col) => this.validateColumnName(col));
    Object.keys(primaryKey).forEach((col) => this.validateColumnName(col));

    // Get column types so we can properly serialize JSON/JSONB values
    const [schema, tbl] = table.includes(".")
      ? table.split(".")
      : ["public", table];
    const colTypeResult = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
      [schema, tbl],
    );
    const colTypes: Record<string, string> = {};
    for (const row of colTypeResult.rows) {
      colTypes[row.column_name] = row.data_type;
    }

    // Serialize values based on column type
    const serializeValue = (col: string, val: unknown): unknown => {
      if (val === null || val === undefined) return val;
      const dtype = (colTypes[col] || "").toLowerCase();
      // Handle boolean columns: convert string "true"/"false" to actual boolean
      if (dtype === "boolean" && typeof val === "string") {
        return val.toLowerCase() === "true";
      }
      // Handle JSON/JSONB columns
      if (dtype === "json" || dtype === "jsonb") {
        if (typeof val === "object") return JSON.stringify(val);
        if (typeof val === "string") {
          try { JSON.parse(val); return val; } catch { /* pass through */ }
        }
      }
      return val;
    };

    const values = [
      ...Object.entries(data).map(([col, val]) => serializeValue(col, val)),
      ...Object.values(primaryKey),
    ];

    const setClause = setColumns
      .map((col, i) => `"${col}" = $${i + 1}`)
      .join(", ");

    const whereClause = Object.keys(primaryKey)
      .map((col, i) => `"${col}" = $${setColumns.length + i + 1}`)
      .join(" AND ");

    const query = `
      UPDATE ${quotedTable}
      SET ${setClause}
      WHERE ${whereClause}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
      throw new Error(
        `No rows updated. The row may not exist or primary key values may be incorrect.`,
      );
    }

    return result.rows[0];
  }

  async deleteRow(
    table: string,
    primaryKey: Record<string, unknown>,
  ): Promise<boolean> {
    const pool = this.getPool();

    // Validate table and column names to prevent SQL injection
    const quotedTable = this.quoteIdentifier(table);
    Object.keys(primaryKey).forEach((col) => this.validateColumnName(col));

    const whereClause = Object.keys(primaryKey)
      .map((col, i) => `"${col}" = $${i + 1}`)
      .join(" AND ");

    const query = `DELETE FROM ${quotedTable} WHERE ${whereClause}`;
    const result = await pool.query(query, Object.values(primaryKey));

    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Delete many rows in a single statement.
   *
   * Builds one DELETE with the primary keys OR'd together, fully parameterized:
   *   DELETE FROM t WHERE ("id" = $1) OR ("id" = $2) ...
   * Composite keys AND their columns within each group. Every row goes in one
   * round trip and one implicit transaction, so a partial failure rolls back
   * rather than leaving half the selection deleted.
   */
  async deleteRows(
    table: string,
    primaryKeys: Record<string, unknown>[],
  ): Promise<BulkDeleteResult> {
    if (primaryKeys.length === 0) return { deleted: 0, failed: 0 };

    const pool = this.getPool();
    const quotedTable = this.quoteIdentifier(table);

    const params: unknown[] = [];
    const groups = primaryKeys.map((primaryKey) => {
      const columns = Object.keys(primaryKey);
      if (columns.length === 0) {
        throw new Error("Cannot delete a row without primary key values");
      }
      const conditions = columns.map((col) => {
        this.validateColumnName(col);
        params.push(primaryKey[col]);
        return `"${col}" = $${params.length}`;
      });
      return `(${conditions.join(" AND ")})`;
    });

    const query = `DELETE FROM ${quotedTable} WHERE ${groups.join(" OR ")}`;

    try {
      const result = await pool.query(query, params);
      const deleted = result.rowCount ?? 0;
      return { deleted, failed: Math.max(0, primaryKeys.length - deleted) };
    } catch (error) {
      return {
        deleted: 0,
        failed: primaryKeys.length,
        error: error instanceof Error ? error.message : "Bulk delete failed",
      };
    }
  }

  /**
   * Estimated rows a statement would affect, from the query planner.
   *
   * Uses plain `EXPLAIN`, never `EXPLAIN ANALYZE`. That distinction is the whole
   * point: ANALYZE *executes* the statement to gather real timings, so using it
   * to preview a DELETE would delete the rows. Plain EXPLAIN only plans.
   *
   * The BEGIN/ROLLBACK wrapper is defence in depth, not the mechanism — nothing
   * should have been executed for it to roll back.
   *
   * The number is an estimate from table statistics and can be off by orders of
   * magnitude on a table that has not been ANALYZEd; callers must present it as
   * approximate.
   */
  async estimateAffectedRows(statement: string): Promise<number | null> {
    const pool = this.getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const result = await client.query(
        `EXPLAIN (FORMAT JSON) ${statement}`,
      );
      await client.query("ROLLBACK");

      const plan = result.rows[0]?.["QUERY PLAN"];
      const root = Array.isArray(plan) ? plan[0]?.Plan : undefined;
      if (!root) return null;

      // For INSERT/UPDATE/DELETE the root is a ModifyTable node, and its own
      // "Plan Rows" is 0 — it emits rows only with RETURNING. The estimate of
      // how many rows will be touched lives on the child scan node.
      const node =
        root["Node Type"] === "ModifyTable" && Array.isArray(root.Plans)
          ? root.Plans[0]
          : root;

      const planRows = node?.["Plan Rows"];
      return typeof planRows === "number" ? planRows : null;
    } catch {
      await client.query("ROLLBACK").catch(() => {
        /* transaction may already be aborted */
      });
      return null;
    } finally {
      client.release();
    }
  }

  async executeQuery(
    query: string,
    options?: ExecuteQueryOptions,
  ): Promise<QueryResult> {
    if (options?.readOnly) {
      return this.executeReadOnlyQuery(query, options.runId);
    }

    const pool = this.getPool();
    const startTime = Date.now();
    // A dedicated client rather than pool.query, so the backend running this
    // statement can be identified and cancelled. Behaviour is otherwise
    // identical, including multi-statement batches and DDL.
    const client = await pool.connect();

    try {
      await this.registerBackend(client, options?.runId);
      const result = await client.query(query);
      const executionTimeMs = Date.now() - startTime;

      return {
        rows: result.rows,
        columns: result.fields?.map((f) => f.name) || [],
        rowCount: result.rowCount ?? result.rows.length,
        executionTimeMs,
      };
    } catch (error) {
      return {
        rows: [],
        columns: [],
        rowCount: 0,
        executionTimeMs: Date.now() - startTime,
        error:
          error instanceof Error ? error.message : "Query execution failed",
      };
    } finally {
      if (options?.runId) this.runningBackends.delete(options.runId);
      client.release();
    }
  }

  /** Record which backend is serving a run, so cancelQuery can signal it. */
  private async registerBackend(
    client: PoolClient,
    runId?: string,
  ): Promise<void> {
    if (!runId) return;
    try {
      const result = await client.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const pid = result.rows[0]?.pid;
      if (typeof pid === "number") this.runningBackends.set(runId, pid);
    } catch {
      // Not fatal — the query still runs, it just cannot be cancelled.
    }
  }

  /**
   * Cancel an in-flight query.
   *
   * `pg_cancel_backend` requests a graceful abort of the current statement; the
   * connection survives, unlike pg_terminate_backend. Sent over a *different*
   * pooled connection, because the one running the query is blocked waiting on
   * it.
   */
  async cancelQuery(runId: string): Promise<boolean> {
    const pid = this.runningBackends.get(runId);
    if (pid === undefined) return false;

    try {
      const result = await this.getPool().query<{ cancelled: boolean }>(
        "SELECT pg_cancel_backend($1) AS cancelled",
        [pid],
      );
      return result.rows[0]?.cancelled === true;
    } catch {
      return false;
    }
  }

  /**
   * Run a query inside a transaction PostgreSQL itself marks read-only, then
   * roll back.
   *
   * This — not keyword matching on the query text — is what makes read-only mode
   * a guarantee. The server rejects every write with `ERROR: cannot execute
   * <verb> in a read-only transaction`, and that holds for constructs no parser
   * of ours would catch: writes inside VOLATILE functions, `DO $$ ... $$` blocks,
   * data-modifying CTEs, `CALL`ed procedures, and any second statement smuggled
   * into a multi-statement batch.
   *
   * The trailing ROLLBACK is not a safety mechanism (nothing could have been
   * written); it just avoids leaving an idle-in-transaction connection behind.
   */
  private async executeReadOnlyQuery(
    query: string,
    runId?: string,
  ): Promise<QueryResult> {
    const pool = this.getPool();
    const startTime = Date.now();
    const client = await pool.connect();

    try {
      await this.registerBackend(client, runId);
      await client.query("BEGIN");
      await client.query("SET TRANSACTION READ ONLY");

      const result = await client.query(query);
      await client.query("ROLLBACK");

      return {
        rows: result.rows,
        columns: result.fields?.map((f) => f.name) || [],
        rowCount: result.rowCount ?? result.rows.length,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {
        /* connection may already be aborted */
      });

      return {
        rows: [],
        columns: [],
        rowCount: 0,
        executionTimeMs: Date.now() - startTime,
        error:
          error instanceof Error ? error.message : "Query execution failed",
      };
    } finally {
      if (runId) this.runningBackends.delete(runId);
      client.release();
    }
  }

  async getTableStats(table: string): Promise<TableStats> {
    const pool = this.getPool();

    // Parse schema.table format
    const [schema, tableName] = table.includes(".")
      ? table.split(".")
      : ["public", table];

    try {
      const query = `
        SELECT
          pg_total_relation_size(quote_ident($1) || '.' || quote_ident($2)) as size_bytes,
          (SELECT reltuples::bigint FROM pg_class c
           JOIN pg_namespace n ON c.relnamespace = n.oid
           WHERE c.relname = $2 AND n.nspname = $1) as row_count,
          (SELECT COUNT(*) FROM pg_indexes WHERE schemaname = $1 AND tablename = $2) as index_count
      `;

      const result = await pool.query(query, [schema, tableName]);
      const row = result.rows[0];

      return {
        rowCount: parseInt(row.row_count) || 0,
        sizeBytes: parseInt(row.size_bytes) || 0,
        indexCount: parseInt(row.index_count) || 0,
      };
    } catch (error) {
      console.error("Error getting table stats:", error);
      return {
        rowCount: 0,
        sizeBytes: 0,
        indexCount: 0,
      };
    }
  }

  async getIndexInfo(table: string): Promise<IndexInfo[]> {
    const pool = this.getPool();

    // Parse schema.table format
    const [schema, tableName] = table.includes(".")
      ? table.split(".")
      : ["public", table];

    // Columns come from pg_get_indexdef per key position, not from a join on
    // pg_attribute. Two reasons: a join ordered by attnum returns the table's
    // column order rather than the index's key order — so an index on (b, a)
    // would be reported as (a, b), which is a different index and would defeat
    // any prefix-redundancy analysis — and an expression index like
    // lower(email) has no pg_attribute row to join to at all.
    //
    // indnkeyatts excludes INCLUDE'd payload columns, which are stored in the
    // index but cannot be searched on.
    const query = `
      SELECT
        i.relname AS name,
        ix.indisunique AS is_unique,
        ix.indisprimary AS is_primary,
        am.amname AS type,
        pg_relation_size(i.oid) AS size_bytes,
        s.idx_scan AS scans,
        pg_get_indexdef(i.oid) AS definition,
        ix.indpred IS NOT NULL AS is_partial,
        (
          SELECT array_agg(pg_get_indexdef(i.oid, k.ord::int, true) ORDER BY k.ord)
          FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
          WHERE k.ord <= ix.indnkeyatts
        ) AS columns
      FROM pg_class t
      JOIN pg_namespace n ON t.relnamespace = n.oid
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_am am ON i.relam = am.oid
      LEFT JOIN pg_stat_all_indexes s ON s.indexrelid = i.oid
      WHERE t.relname = $1 AND n.nspname = $2
      ORDER BY i.relname
    `;

    const result = await pool.query(query, [tableName, schema]);

    return result.rows.map((row) => ({
      name: row.name,
      columns: (row.columns as string[] | null) ?? [],
      isUnique: row.is_unique,
      isPrimary: row.is_primary,
      type: row.type,
      sizeBytes: Number(row.size_bytes) || 0,
      // idx_scan is null when the stats collector has no entry yet; that is
      // "unknown", not zero, and the health analysis distinguishes the two.
      scans: row.scans === null ? undefined : Number(row.scans),
      definition: row.definition ?? undefined,
      isPartial: row.is_partial ?? false,
    }));
  }

  /**
   * Index access methods this adapter will build.
   *
   * An allowlist rather than validation, because the method name goes into the
   * statement as an identifier and cannot be parameterized.
   */
  private static readonly INDEX_METHODS = [
    "btree",
    "hash",
    "gin",
    "gist",
    "spgist",
    "brin",
  ] as const;

  async createIndex(
    table: string,
    options: CreateIndexOptions
  ): Promise<IndexInfo> {
    const pool = this.getPool();
    const quotedTable = this.quoteIdentifier(table);

    this.validateColumnName(options.name);

    if (options.columns.length === 0) {
      throw new Error("An index needs at least one column");
    }
    options.columns.forEach((column) => this.validateColumnName(column));

    const method = (options.method ?? "btree").toLowerCase();
    if (!(PostgresAdapter.INDEX_METHODS as readonly string[]).includes(method)) {
      throw new Error(
        `Unsupported index method: ${options.method}. Expected one of ${PostgresAdapter.INDEX_METHODS.join(", ")}.`
      );
    }

    const columnList = options.columns.map((c) => `"${c}"`).join(", ");
    const statement = [
      "CREATE",
      options.unique ? "UNIQUE" : "",
      "INDEX",
      options.concurrent ? "CONCURRENTLY" : "",
      `"${options.name}"`,
      `ON ${quotedTable}`,
      `USING ${method}`,
      `(${columnList})`,
      options.where ? `WHERE ${options.where}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    // A partial index's predicate is arbitrary SQL that cannot be
    // parameterized, so it is the one part of this statement built from
    // uninspected user text. `pool.query` with no bind parameters uses the
    // simple query protocol, which would happily run
    // `WHERE true; DROP TABLE users` as a batch — turning "create an index"
    // into arbitrary DDL that never passes the confirmation gate. Splitting the
    // assembled statement with the same scanner read-only mode uses (it
    // understands strings, comments and dollar-quoting, so it cannot be fooled
    // by `--` or `$$`) and requiring exactly one is what closes that.
    if (splitSqlStatements(statement).length !== 1) {
      throw new Error(
        "Index predicate must be a single expression and cannot contain multiple statements"
      );
    }

    // CREATE INDEX CONCURRENTLY cannot run inside a transaction block, so this
    // deliberately goes through the pool rather than a managed client.
    await pool.query(statement);

    const created = (await this.getIndexInfo(table)).find(
      (index) => index.name === options.name
    );

    if (!created) {
      // The statement succeeded, so the index exists; only the read-back failed.
      throw new Error(
        `Index ${options.name} was created but could not be read back`
      );
    }

    return created;
  }

  async dropIndex(table: string, indexName: string): Promise<boolean> {
    const pool = this.getPool();
    this.validateColumnName(indexName);

    // PostgreSQL index names are schema-scoped, not table-scoped, so DROP INDEX
    // alone would happily drop an index belonging to a different table. Looking
    // it up against this table first is what keeps the caller's table argument
    // meaningful rather than decorative.
    const existing = (await this.getIndexInfo(table)).find(
      (index) => index.name === indexName
    );

    if (!existing) return false;

    if (existing.isPrimary) {
      throw new Error(
        `${indexName} implements the primary key and cannot be dropped on its own. Drop the constraint instead.`
      );
    }

    const [schema] = table.includes(".") ? table.split(".") : ["public"];
    await pool.query(
      `DROP INDEX ${this.quoteIdentifier(`${schema}.${indexName}`)}`
    );

    return true;
  }

  async getDatabaseStats(): Promise<{
    totalSize: number;
    tableCount: number;
    version: string;
  }> {
    const pool = this.getPool();

    const sizeQuery = `SELECT pg_database_size(current_database()) as size`;
    const countQuery = `
      SELECT COUNT(*) as count
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    `;
    const versionQuery = `SELECT version()`;

    const [sizeResult, countResult, versionResult] = await Promise.all([
      pool.query(sizeQuery),
      pool.query(countQuery),
      pool.query(versionQuery),
    ]);

    return {
      totalSize: parseInt(sizeResult.rows[0].size) || 0,
      tableCount: parseInt(countResult.rows[0].count) || 0,
      version: versionResult.rows[0].version,
    };
  }
}
