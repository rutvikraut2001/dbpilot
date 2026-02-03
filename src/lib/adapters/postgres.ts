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
} from "./types";

export class PostgresAdapter extends BaseAdapter {
  private pool: Pool | null = null;

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

      // Test the connection
      const client = await this.pool.connect();
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

    return result.rows.map((row) => ({
      name: row.name,
      type: row.type,
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
    const { page, pageSize, sortBy, sortOrder, filters } = options;

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

    // Build ORDER BY clause with validated column name
    let orderClause = "";
    if (sortBy) {
      this.validateColumnName(sortBy);
      orderClause = `ORDER BY "${sortBy}" ${sortOrder === "desc" ? "DESC" : "ASC"}`;
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM ${quotedTable} ${whereClause}`;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    // Get paginated data
    params.push(pageSize, offset);
    const dataQuery = `
      SELECT * FROM ${quotedTable}
      ${whereClause}
      ${orderClause}
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `;
    const dataResult = await pool.query(dataQuery, params);

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

    const values = Object.values(data);
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

    const values = [...Object.values(data), ...Object.values(primaryKey)];

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

  async executeQuery(query: string): Promise<QueryResult> {
    const pool = this.getPool();
    const startTime = Date.now();

    try {
      const result = await pool.query(query);
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

    const query = `
      SELECT
        i.relname as name,
        a.attname as column_name,
        ix.indisunique as is_unique,
        ix.indisprimary as is_primary,
        am.amname as type
      FROM pg_class t
      JOIN pg_namespace n ON t.relnamespace = n.oid
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_am am ON i.relam = am.oid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE t.relname = $1 AND n.nspname = $2
      ORDER BY i.relname, a.attnum
    `;

    const result = await pool.query(query, [tableName, schema]);

    // Group columns by index name
    const indexMap = new Map<string, IndexInfo>();
    for (const row of result.rows) {
      if (!indexMap.has(row.name)) {
        indexMap.set(row.name, {
          name: row.name,
          columns: [],
          isUnique: row.is_unique,
          isPrimary: row.is_primary,
          type: row.type,
        });
      }
      indexMap.get(row.name)!.columns.push(row.column_name);
    }

    return Array.from(indexMap.values());
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
