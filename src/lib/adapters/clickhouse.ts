import { createClient, ClickHouseClient } from "@clickhouse/client";
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
  AdapterCapabilities,
} from "./types";

export class ClickHouseAdapter extends BaseAdapter {
  private client: ClickHouseClient | null = null;

  // ClickHouse is read-optimized; UPDATE/DELETE are expensive async mutations
  readonly capabilities: AdapterCapabilities = {
    supportsUpdate: false,
    supportsDelete: false,
    supportsTransactions: false,
  };

  async connect(): Promise<void> {
    const { url, username, password, database } =
      this.parseConnectionString(this.connectionString);

    this.client = createClient({
      url,
      username,
      password,
      database,
      // Production-ready settings
      request_timeout: 30000, // 30 second timeout
      max_open_connections: 20, // Connection pool size
      keep_alive: {
        enabled: true,
        idle_socket_ttl: 30000, // 30 seconds
      },
      compression: {
        request: true, // Compress requests
        response: true, // Decompress responses
      },
    });

    // Test connection
    await this.client.ping();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.connected = false;
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const { url, username, password, database } =
        this.parseConnectionString(this.connectionString);

      const testClient = createClient({
        url,
        username,
        password,
        database,
      });

      await testClient.ping();
      const result = await testClient.query({
        query: "SELECT version() as version",
        format: "JSONEachRow",
      });
      const data = (await result.json()) as { version: string }[];
      await testClient.close();

      const firstRow = data[0];
      const version = firstRow?.version || "unknown";
      return {
        success: true,
        message: `Connected to ClickHouse ${version}`,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Connection failed",
      };
    }
  }

  /**
   * Lightweight health check using existing connection (no new connections).
   */
  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  private parseConnectionString(connectionString: string): {
    url: string;
    username: string;
    password: string;
    database: string;
  } {
    // Handle both clickhouse:// and http:// formats
    let urlString = connectionString;
    if (urlString.startsWith("clickhouse://")) {
      urlString = urlString.replace("clickhouse://", "http://");
    }

    const url = new URL(urlString);
    const username = url.username || "default";
    const password = url.password || "";
    const database = url.pathname.slice(1) || "default";

    // Construct clean URL without credentials
    const cleanUrl = `${url.protocol}//${url.host}`;

    return { url: cleanUrl, username, password, database };
  }

  private getClient(): ClickHouseClient {
    if (!this.client) {
      throw new Error("Database not connected. Call connect() first.");
    }
    return this.client;
  }

  private validateIdentifier(name: string): void {
    // Allow alphanumeric, underscore, and dot (for database.table format)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/.test(name)) {
      throw new Error(`Invalid identifier: ${name}`);
    }
  }

  private quoteIdentifier(name: string): string {
    this.validateIdentifier(name);
    return name
      .split(".")
      .map((part) => `\`${part}\``)
      .join(".");
  }

  async getTables(): Promise<TableInfo[]> {
    const client = this.getClient();

    const result = await client.query({
      query: `
        SELECT
          name,
          engine,
          total_rows,
          total_bytes
        FROM system.tables
        WHERE database = currentDatabase()
          AND name NOT LIKE '.%'
        ORDER BY name
      `,
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as {
      name: string;
      engine: string;
      total_rows: string | number;
      total_bytes: string | number;
    }[];

    return rows.map((row) => ({
      name: row.name,
      type: row.engine.includes("View") ? ("view" as const) : ("table" as const),
      rowCount: Number(row.total_rows) || 0,
      sizeBytes: Number(row.total_bytes) || 0,
    }));
  }

  async getTableSchema(tableName: string): Promise<ColumnInfo[]> {
    const client = this.getClient();
    this.validateIdentifier(tableName);

    const result = await client.query({
      query: `
        SELECT
          name,
          type,
          is_in_primary_key,
          default_kind,
          default_expression
        FROM system.columns
        WHERE database = currentDatabase() AND table = {tableName:String}
        ORDER BY position
      `,
      query_params: { tableName },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as {
      name: string;
      type: string;
      is_in_primary_key: number;
      default_kind: string;
      default_expression: string;
    }[];

    return rows.map((row) => ({
      name: row.name,
      type: row.type,
      nullable: row.type.startsWith("Nullable"),
      isPrimaryKey: row.is_in_primary_key === 1,
      isForeignKey: false, // ClickHouse doesn't have foreign keys
      defaultValue: row.default_expression || undefined,
    }));
  }

  async getRelationships(): Promise<Relationship[]> {
    // ClickHouse doesn't have foreign key relationships
    return [];
  }

  async getRows(
    table: string,
    options: QueryOptions
  ): Promise<PaginatedResult> {
    const client = this.getClient();
    const { page, pageSize, sortBy, sortOrder, filters } = options;
    const offset = (page - 1) * pageSize;

    // Validate table name
    this.validateIdentifier(table);
    const quotedTable = this.quoteIdentifier(table);

    // Build WHERE clause
    let whereClause = "";
    const filterParams: Record<string, unknown> = {};
    if (filters && Object.keys(filters).length > 0) {
      const conditions = Object.entries(filters).map(([key, value], index) => {
        this.validateIdentifier(key);
        const paramName = `filter_${index}`;
        filterParams[paramName] = value;
        return `\`${key}\` = {${paramName}:String}`;
      });
      whereClause = `WHERE ${conditions.join(" AND ")}`;
    }

    // Get count
    const countResult = await client.query({
      query: `SELECT count() as total FROM ${quotedTable} ${whereClause}`,
      query_params: filterParams,
      format: "JSONEachRow",
    });
    const countData = (await countResult.json()) as { total: string | number }[];
    const total = Number(countData[0]?.total || 0);

    // Build ORDER BY clause
    let orderClause = "";
    if (sortBy) {
      this.validateIdentifier(sortBy);
      orderClause = `ORDER BY \`${sortBy}\` ${sortOrder === "desc" ? "DESC" : "ASC"}`;
    }

    // Get data with pagination
    const dataResult = await client.query({
      query: `
        SELECT * FROM ${quotedTable}
        ${whereClause}
        ${orderClause}
        LIMIT {limit:UInt32} OFFSET {offset:UInt32}
      `,
      query_params: { ...filterParams, limit: pageSize, offset },
      format: "JSONEachRow",
    });

    const data = (await dataResult.json()) as Record<string, unknown>[];

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async insertRow(
    table: string,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const client = this.getClient();
    this.validateIdentifier(table);

    await client.insert({
      table,
      values: [data],
      format: "JSONEachRow",
    });

    return data;
  }

  async updateRow(): Promise<Record<string, unknown>> {
    throw new Error(
      "ClickHouse does not support row-level UPDATE. Use ALTER TABLE ... UPDATE for bulk mutations, which are asynchronous operations."
    );
  }

  async deleteRow(): Promise<boolean> {
    throw new Error(
      "ClickHouse does not support row-level DELETE. Use ALTER TABLE ... DELETE for bulk mutations, which are asynchronous operations."
    );
  }

  async executeQuery(query: string): Promise<QueryResult> {
    const client = this.getClient();
    const startTime = Date.now();

    try {
      const result = await client.query({
        query,
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Record<string, unknown>[];
      const executionTimeMs = Date.now() - startTime;

      return {
        rows,
        columns: rows.length > 0 ? Object.keys(rows[0]) : [],
        rowCount: rows.length,
        executionTimeMs,
      };
    } catch (error) {
      return {
        rows: [],
        columns: [],
        rowCount: 0,
        executionTimeMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : "Query execution failed",
      };
    }
  }

  async getTableStats(table: string): Promise<TableStats> {
    const client = this.getClient();
    this.validateIdentifier(table);

    const result = await client.query({
      query: `
        SELECT
          total_rows as row_count,
          total_bytes as size_bytes
        FROM system.tables
        WHERE database = currentDatabase() AND name = {tableName:String}
      `,
      query_params: { tableName: table },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as {
      row_count: string | number;
      size_bytes: string | number;
    }[];

    const row = rows[0];
    return {
      rowCount: Number(row?.row_count || 0),
      sizeBytes: Number(row?.size_bytes || 0),
      indexCount: 0, // ClickHouse uses different indexing concepts
    };
  }

  async getIndexInfo(table: string): Promise<IndexInfo[]> {
    const client = this.getClient();
    this.validateIdentifier(table);

    // ClickHouse has data skipping indices, not traditional B-tree indexes
    const result = await client.query({
      query: `
        SELECT
          name,
          expr,
          type
        FROM system.data_skipping_indices
        WHERE database = currentDatabase() AND table = {tableName:String}
      `,
      query_params: { tableName: table },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as {
      name: string;
      expr: string;
      type: string;
    }[];

    return rows.map((row) => ({
      name: row.name,
      columns: [row.expr], // Expression-based
      isUnique: false,
      isPrimary: false,
      type: row.type,
    }));
  }

  async getDatabaseStats(): Promise<{
    totalSize: number;
    tableCount: number;
    version: string;
  }> {
    const client = this.getClient();

    const [sizeResult, versionResult] = await Promise.all([
      client.query({
        query: `
          SELECT
            sum(total_bytes) as total_size,
            count() as table_count
          FROM system.tables
          WHERE database = currentDatabase()
        `,
        format: "JSONEachRow",
      }),
      client.query({
        query: "SELECT version() as version",
        format: "JSONEachRow",
      }),
    ]);

    const sizeData = (await sizeResult.json()) as {
      total_size: string | number;
      table_count: string | number;
    }[];
    const versionData = (await versionResult.json()) as { version: string }[];

    return {
      totalSize: Number(sizeData[0]?.total_size || 0),
      tableCount: Number(sizeData[0]?.table_count || 0),
      version: `ClickHouse ${versionData[0]?.version || "unknown"}`,
    };
  }
}
