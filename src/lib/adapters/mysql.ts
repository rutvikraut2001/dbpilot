import mysql, { Pool, PoolConnection, RowDataPacket, ResultSetHeader, FieldPacket } from "mysql2/promise";
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
  SchemaChange,
  SchemaChangePlan,
  CreateIndexOptions,
  AdapterCapabilities,
  ExecuteQueryOptions,
  QueryDialect,
  BulkDeleteResult,
} from "./types";
import {
  quoteBackticked,
  withDatabase,
  databaseFromConnectionString,
} from "../database-name";

/**
 * Column types this adapter will build a statement from.
 *
 * Deliberately the types people reach for rather than everything MySQL knows;
 * anything else is better written by hand in the query editor.
 */
const MYSQL_TYPES = new Set([
  "tinyint", "smallint", "mediumint", "int", "integer", "bigint",
  "decimal", "numeric", "float", "double", "bit",
  "char", "varchar", "tinytext", "text", "mediumtext", "longtext",
  "binary", "varbinary", "tinyblob", "blob", "mediumblob", "longblob",
  "date", "datetime", "timestamp", "time", "year",
  "boolean", "bool", "json", "enum", "set",
  "geometry", "point", "linestring", "polygon",
]);

/** Schemas MySQL owns; never surfaced as user tables. */
const SYSTEM_SCHEMAS = [
  "information_schema",
  "performance_schema",
  "mysql",
  "sys",
] as const;

type Row = RowDataPacket & Record<string, unknown>;

/** Ceiling on a single SELECT, matching the PostgreSQL adapter's. */
const STATEMENT_TIMEOUT_MS = 30000;

/**
 * Set `max_execution_time` on a connection the pool has just opened.
 *
 * mysql2's promise pool forwards the *driver-level* connection through its
 * `connection` event, not the promise wrapper its types advertise — so the
 * object here takes a callback and has no `.then` to attach a handler to. Both
 * shapes are handled rather than assumed, because getting it wrong means either
 * a TypeError on every new pooled connection or an unhandled rejection.
 *
 * Failure is deliberately swallowed: MariaDB and MySQL before 5.7.8 have no
 * such variable, and a missing query ceiling must not stop the pool working.
 */
function applyStatementTimeout(connection: unknown, timeoutMs: number): void {
  const sql = `SET SESSION max_execution_time = ${timeoutMs}`;
  const candidate = connection as {
    promise?: () => { query: (sql: string) => Promise<unknown> };
    query?: (sql: string, callback: (error: unknown) => void) => void;
  };

  try {
    if (typeof candidate.promise === "function") {
      candidate.promise()
        .query(sql)
        .catch(() => {});
      return;
    }
    candidate.query?.(sql, () => {});
  } catch {
    /* nothing about a missing timeout is worth failing a connection over */
  }
}

/**
 * Read a plan node's `filtered` field as a percentage.
 *
 * MySQL renders it as a string ("100.00"), MariaDB as a number. Anything else
 * means the field is absent, and 100 — no filtering — is the safe reading: it
 * leaves a row estimate at the scan size rather than silently shrinking it.
 */
function parseFilteredPercentage(filtered: unknown): number {
  if (typeof filtered === "number") {
    return Number.isFinite(filtered) ? filtered : 100;
  }
  if (typeof filtered === "string") {
    const parsed = Number.parseFloat(filtered);
    return Number.isFinite(parsed) ? parsed : 100;
  }
  return 100;
}

/**
 * Members of an `enum('a','b')` / `set('a','b')` column type.
 *
 * MySQL stores these inline in COLUMN_TYPE rather than as a named type, so
 * there is no catalogue to join against as there is for a PostgreSQL enum — the
 * list has to be read out of the type itself. Members are single-quoted, with
 * `''` and `\'` both used for an embedded quote, so a split on commas would
 * break on any value containing one.
 */
function parseEnumMembers(columnType: string): string[] | undefined {
  const match = /^(?:enum|set)\((.*)\)$/i.exec(columnType.trim());
  if (!match) return undefined;

  const members: string[] = [];
  const body = match[1];
  let current = "";
  let inQuote = false;
  let i = 0;

  while (i < body.length) {
    const char = body[i];

    if (!inQuote) {
      if (char === "'") inQuote = true;
      i++;
      continue;
    }

    if (char === "\\" && i + 1 < body.length) {
      current += body[i + 1];
      i += 2;
      continue;
    }

    if (char !== "'") {
      current += char;
      i++;
      continue;
    }

    // A doubled quote is an escaped one, not the end of the member.
    if (body[i + 1] === "'") {
      current += "'";
      i += 2;
      continue;
    }

    members.push(current);
    current = "";
    inQuote = false;
    i++;
  }

  return members.length > 0 ? members : undefined;
}

/** Whether a column type is MySQL's stand-in for a boolean. */
function isBooleanColumn(type: string): boolean {
  return (
    type.startsWith("tinyint(1)") || type === "bool" || type === "boolean"
  );
}

/**
 * Coerce a value bound for a `tinyint(1)` column.
 *
 * The grid's cells are text inputs, so an unchecked box arrives as the string
 * `"false"` — truthy, and stored as 1 without this, inverting what the user
 * chose. Anything unrecognized passes through for the server to judge.
 */
function toMySQLBoolean(value: unknown): unknown {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value !== "string") return value;

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return 1;
  if (normalized === "false" || normalized === "0") return 0;
  return value;
}

/**
 * Coerce a value bound for a `json` column.
 *
 * An object has to be stringified or the driver sends "[object Object]". A
 * string that already parses as JSON is passed through untouched — re-encoding
 * it would store the document as a quoted string instead. A string that does
 * not parse is left alone so MySQL reports the syntax error itself.
 */
function toJsonColumnValue(value: unknown): unknown {
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value !== "string") return value;

  try {
    JSON.parse(value);
    return value;
  } catch {
    return value;
  }
}

export class MySQLAdapter extends BaseAdapter {
  readonly dialect: QueryDialect = "sql";

  readonly capabilities: AdapterCapabilities = {
    supportsUpdate: true,
    supportsDelete: true,
    supportsTransactions: true,
    supportsIndexManagement: true,
    supportsDatabaseCreate: true,
    supportsSchemaEdit: true,
  };

  private pool: Pool | null = null;

  /**
   * Database the connection string points at. MySQL has no schema/table split
   * of PostgreSQL's kind — a "schema" *is* a database — so this stands in for
   * PostgreSQL's `public` when an unqualified table name is resolved.
   */
  private database: string | null = databaseFromConnectionString(
    this.connectionString
  );

  /**
   * Pool options derived from the connection string.
   *
   * `multipleStatements` is deliberately left at the driver default of false.
   * That is what makes `SELECT 1; DROP TABLE users` a syntax error rather than a
   * batch, so a harmless leading statement cannot carry a second one in behind
   * it. The API route rejects multi-statement input too; this is the layer below
   * that, and it holds even when the route is bypassed.
   */
  private poolOptions(): mysql.PoolOptions {
    const { host, port, user, password, database, socketPath, ssl } =
      this.parseConnectionString(this.connectionString);

    this.database = database;

    return {
      host,
      port,
      user,
      password,
      ...(database ? { database } : {}),
      ...(socketPath ? { socketPath } : {}),
      ...(ssl ? { ssl } : {}),
      waitForConnections: true,
      connectionLimit: 20,
      queueLimit: 0,
      connectTimeout: 10000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      // Return DECIMAL/BIGINT as strings rather than lossy JS numbers. A
      // bigint primary key silently rounded past 2^53 would send an edit to the
      // wrong row.
      decimalNumbers: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
      // DATE/DATETIME as strings: the driver would otherwise build a local-time
      // Date, shifting every timestamp by the server's offset.
      dateStrings: true,
    };
  }

  /**
   * Split a `mysql://` (or `mariadb://`) URI into driver options.
   *
   * Written by hand rather than handed to the driver's own URI parsing so the
   * database name, which unqualified table lookups depend on, is known here.
   */
  private parseConnectionString(connectionString: string): {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string | null;
    socketPath?: string;
    ssl?: mysql.PoolOptions["ssl"];
  } {
    // MariaDB speaks the MySQL protocol; accept its scheme as an alias.
    const normalized = connectionString.replace(/^mariadb:\/\//i, "mysql://");

    let url: URL;
    try {
      url = new URL(normalized);
    } catch {
      throw new Error(
        "Invalid MySQL connection string. Expected mysql://user:password@host:port/database"
      );
    }

    // A connection string with no database is valid: it connects to the server
    // and leaves the database unselected, which is what lets the user pick one
    // from the list instead of having to know the name up front.
    const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || null;

    // `?ssl-mode=REQUIRED` / `?sslmode=require` — the common spellings. Only the
    // enable/disable distinction is honoured; certificate material belongs in
    // configuration, not a URL.
    const sslMode = (
      url.searchParams.get("ssl-mode") ??
      url.searchParams.get("sslmode") ??
      ""
    ).toUpperCase();
    const sslEnabled = ["REQUIRED", "REQUIRE", "PREFERRED", "TRUE", "1"].includes(
      sslMode
    );

    // `?socket=/var/run/mysqld/mysqld.sock` — a local MySQL that listens only
    // on its Unix socket, which is the default on several distributions. When
    // set, the driver ignores host and port entirely.
    const socketPath =
      url.searchParams.get("socket") ??
      url.searchParams.get("socketPath") ??
      undefined;

    return {
      host: url.hostname || "localhost",
      port: url.port ? Number.parseInt(url.port, 10) : 3306,
      user: decodeURIComponent(url.username) || "root",
      password: decodeURIComponent(url.password),
      database,
      socketPath,
      ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
    };
  }

  async connect(): Promise<void> {
    try {
      this.pool = mysql.createPool(this.poolOptions());

      // Cap runaway queries the same way the PostgreSQL adapter does. MySQL
      // spells it in milliseconds and only applies it to SELECTs; there is no
      // portable session-level equivalent for writes.
      this.pool.on("connection", (connection) => {
        applyStatementTimeout(connection, STATEMENT_TIMEOUT_MS);
      });

      const connection = await this.pool.getConnection();
      connection.release();
      this.connected = true;
    } catch (error) {
      this.connected = false;
      // A half-built pool would keep its sockets and timers alive.
      if (this.pool) {
        await this.pool.end().catch(() => {});
        this.pool = null;
      }
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
    let connection: mysql.Connection | null = null;
    try {
      connection = await mysql.createConnection({
        ...this.poolOptions(),
        connectionLimit: undefined,
        waitForConnections: undefined,
        queueLimit: undefined,
      } as mysql.ConnectionOptions);

      const [rows] = await connection.query<Row[]>(
        "SELECT VERSION() AS version"
      );

      return {
        success: true,
        message: `Connected successfully. MySQL ${rows[0]?.version ?? "unknown"}`,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Connection failed",
      };
    } finally {
      await connection?.end().catch(() => {});
    }
  }

  /**
   * Lightweight health check over the existing pool (no new connections).
   */
  async ping(): Promise<boolean> {
    if (!this.pool) return false;
    try {
      const connection = await this.pool.getConnection();
      try {
        await connection.ping();
        return true;
      } finally {
        connection.release();
      }
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
   * Allows `database.table` as a single dotted identifier.
   */
  private validateIdentifier(name: string): void {
    if (!/^[a-zA-Z_][a-zA-Z0-9_$]*(\.[a-zA-Z_][a-zA-Z0-9_$]*)?$/.test(name)) {
      throw new Error(`Invalid identifier: ${name}`);
    }
  }

  private validateColumnName(name: string): void {
    if (!/^[a-zA-Z_][a-zA-Z0-9_$]*$/.test(name)) {
      throw new Error(`Invalid column name: ${name}`);
    }
  }

  /**
   * Quote an identifier with backticks after validating it.
   *
   * Validation runs first and is what actually prevents injection: backticks
   * alone can be escaped out of with a backtick in the name, and the regex
   * above admits no backtick at all.
   */
  private quoteIdentifier(name: string): string {
    this.validateIdentifier(name);
    return name
      .split(".")
      .map((part) => `\`${part}\``)
      .join(".");
  }

  /** Split `db.table` into its parts, defaulting to the connected database. */
  private splitTableName(table: string): { schema: string; table: string } {
    this.validateIdentifier(table);
    if (table.includes(".")) {
      const [schema, name] = table.split(".");
      return { schema, table: name };
    }
    return { schema: this.database ?? "", table };
  }

  private async query<T = Row>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const [rows] = await this.getPool().query<Row[]>(sql, params);
    return rows as unknown as T[];
  }

  getCurrentDatabase(): string | null {
    return this.database;
  }

  async listDatabases(): Promise<DatabaseInfo[]> {
    const placeholders = SYSTEM_SCHEMAS.map(() => "?").join(", ");

    // Sizes come from one grouped scan of TABLES rather than a correlated
    // subquery per schema, which on a server with many databases is the
    // difference between one pass and one pass each.
    const rows = await this.query(
      `
      SELECT
        s.SCHEMA_NAME AS name,
        COALESCE(t.size_bytes, 0) AS size_bytes,
        s.SCHEMA_NAME IN (${placeholders}) AS is_system
      FROM information_schema.SCHEMATA s
      LEFT JOIN (
        SELECT
          TABLE_SCHEMA,
          SUM(COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0)) AS size_bytes
        FROM information_schema.TABLES
        GROUP BY TABLE_SCHEMA
      ) t ON t.TABLE_SCHEMA = s.SCHEMA_NAME
      ORDER BY s.SCHEMA_NAME
      `,
      [...SYSTEM_SCHEMAS]
    );

    return rows.map((row) => ({
      name: row.name as string,
      sizeBytes: Number(row.size_bytes) || 0,
      isCurrent: row.name === this.database,
      isSystem: Boolean(Number(row.is_system)),
    }));
  }

  /**
   * Reconnect the pool against another database.
   *
   * `USE db` would only affect whichever pooled connection happened to run it,
   * leaving the rest of the pool on the old database — so the pool is rebuilt
   * instead. The previous pool is ended only once the new one is up, so a failed
   * switch leaves the adapter where it was.
   */
  async useDatabase(name: string): Promise<void> {
    if (name === this.database) return;

    const target = withDatabase(this.connectionString, name);
    const previousPool = this.pool;
    const previousConnectionString = this.connectionString;

    this.pool = null;
    this.connectionString = target;

    try {
      await this.connect();
    } catch (error) {
      this.connectionString = previousConnectionString;
      this.pool = previousPool;
      this.database = databaseFromConnectionString(previousConnectionString);
      this.connected = previousPool !== null;
      throw error;
    }

    await previousPool?.end().catch(() => {});
  }

  async createDatabase(name: string): Promise<void> {
    const pool = this.getPool();
    await pool.query(`CREATE DATABASE ${quoteBackticked(name)}`);
  }

  /**
   * Type names this adapter will put in a statement.
   *
   * A type cannot be parameterized, so it is interpolated, and an allowlist is
   * what keeps that safe. Parameters and the unsigned/zerofill modifiers are
   * matched separately so `varchar(64)` and `decimal(10, 2) unsigned` work
   * without admitting arbitrary text.
   */
  private validateColumnType(type: string): string {
    const normalized = type.trim().replace(/\s+/g, " ");

    const match =
      /^([a-z][a-z0-9_ ]*?)\s*(\(\s*\d+\s*(?:,\s*\d+\s*)?\))?((?:\s+(?:unsigned|zerofill))*)$/i.exec(
        normalized
      );

    if (!match) {
      throw new Error(`Invalid column type: ${type}`);
    }

    const base = match[1].toLowerCase().trim();
    if (!MYSQL_TYPES.has(base)) {
      throw new Error(
        `Unsupported column type: ${type}. Use one of ${[...MYSQL_TYPES].slice(0, 12).join(", ")}, or run the ALTER statement yourself in the query editor.`
      );
    }

    return `${base}${match[2] ?? ""}${match[3].toLowerCase()}`;
  }

  /**
   * Render a column's full definition, preserving what MODIFY would otherwise
   * discard.
   *
   * This is the MySQL trap the plan exists to avoid: `MODIFY COLUMN c BIGINT`
   * does not narrow the change to the type — it *replaces the whole definition*,
   * silently dropping NOT NULL and DEFAULT unless they are restated. A user
   * changing an int to a bigint would quietly lose a not-null constraint.
   */
  private renderColumnDefinition(
    type: string,
    nullable: boolean,
    defaultValue: string | null | undefined
  ): string {
    const parts = [type];
    parts.push(nullable ? "NULL" : "NOT NULL");

    if (defaultValue !== undefined && defaultValue !== null) {
      parts.push(`DEFAULT ${defaultValue}`);
    }

    return parts.join(" ");
  }

  async planSchemaChanges(
    table: string,
    changes: SchemaChange[]
  ): Promise<SchemaChangePlan> {
    const quotedTable = this.quoteIdentifier(table);
    const statements: string[] = [];
    const warnings: string[] = [];

    // Read once: MODIFY needs the column's current nullability and default, and
    // querying per change would be a round trip each.
    const existing = new Map(
      (await this.getTableSchema(table)).map((column) => [column.name, column])
    );

    for (const change of changes) {
      switch (change.kind) {
        case "addColumn": {
          this.validateColumnName(change.column.name);
          const type = this.validateColumnType(change.column.type);
          const definition = this.renderColumnDefinition(
            type,
            change.column.nullable !== false,
            change.column.defaultValue
          );

          statements.push(
            `ALTER TABLE ${quotedTable} ADD COLUMN ${this.backtick(change.column.name)} ${definition}`
          );

          if (
            change.column.nullable === false &&
            (change.column.defaultValue === undefined ||
              change.column.defaultValue === null)
          ) {
            warnings.push(
              `Adding "${change.column.name}" as NOT NULL without a default gives existing rows an implicit zero or empty string rather than failing.`
            );
          }
          break;
        }

        case "dropColumn": {
          this.validateColumnName(change.name);
          statements.push(
            `ALTER TABLE ${quotedTable} DROP COLUMN ${this.backtick(change.name)}`
          );
          warnings.push(
            `Dropping "${change.name}" discards its data permanently.`
          );
          break;
        }

        case "renameColumn": {
          this.validateColumnName(change.from);
          this.validateColumnName(change.to);
          // RENAME COLUMN needs MySQL 8.0 / MariaDB 10.5.2. Older servers need
          // CHANGE with the whole definition restated, which is exactly the
          // footgun above — so this reports the version requirement instead.
          statements.push(
            `ALTER TABLE ${quotedTable} RENAME COLUMN ${this.backtick(change.from)} TO ${this.backtick(change.to)}`
          );
          warnings.push(
            `Renaming "${change.from}" breaks any query, view or application code still using the old name.`
          );
          break;
        }

        case "setType": {
          this.validateColumnName(change.name);
          const type = this.validateColumnType(change.type);
          const current = existing.get(change.name);

          if (!current) {
            throw new Error(
              `No column named ${change.name} on ${table}`
            );
          }

          statements.push(
            `ALTER TABLE ${quotedTable} MODIFY COLUMN ${this.backtick(change.name)} ${this.renderColumnDefinition(type, current.nullable, current.defaultValue)}`
          );
          warnings.push(
            `Changing the type of "${change.name}" rebuilds the table; on a large one this takes time and may block writes.`
          );
          break;
        }

        case "setNullable": {
          this.validateColumnName(change.name);
          const current = existing.get(change.name);

          if (!current) {
            throw new Error(`No column named ${change.name} on ${table}`);
          }

          // Same trap: nullability can only be changed by restating the whole
          // definition, so the existing type and default are carried over.
          statements.push(
            `ALTER TABLE ${quotedTable} MODIFY COLUMN ${this.backtick(change.name)} ${this.renderColumnDefinition(current.type, change.nullable, current.defaultValue)}`
          );

          if (!change.nullable) {
            warnings.push(
              `Setting "${change.name}" NOT NULL replaces existing nulls with an implicit default rather than failing.`
            );
          }
          break;
        }

        case "setDefault": {
          this.validateColumnName(change.name);
          statements.push(
            change.defaultValue === null
              ? `ALTER TABLE ${quotedTable} ALTER COLUMN ${this.backtick(change.name)} DROP DEFAULT`
              : `ALTER TABLE ${quotedTable} ALTER COLUMN ${this.backtick(change.name)} SET DEFAULT ${change.defaultValue}`
          );
          break;
        }
      }
    }

    if (statements.length > 1) {
      warnings.push(
        "MySQL commits each statement as it runs. If one fails, the changes before it stay applied."
      );
    }

    // Not atomic: unlike PostgreSQL, MySQL implicitly commits at each DDL
    // statement, so a batch cannot be rolled back as a unit.
    return { statements, atomic: false, warnings };
  }

  async alterTable(table: string, changes: SchemaChange[]): Promise<void> {
    const { statements } = await this.planSchemaChanges(table, changes);
    const pool = this.getPool();

    for (const statement of statements) {
      await pool.query(statement);
    }
  }

  async getTables(): Promise<TableInfo[]> {
    const placeholders = SYSTEM_SCHEMAS.map(() => "?").join(", ");

    // Restricted to the connected database: the credentials may see others, but
    // the studio's table names are unqualified and would be ambiguous across
    // databases.
    const rows = await this.query(
      `
      SELECT
        TABLE_SCHEMA AS \`schema\`,
        TABLE_NAME AS name,
        TABLE_TYPE AS type,
        TABLE_ROWS AS row_count,
        COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0) AS size_bytes
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = COALESCE(?, DATABASE())
        AND TABLE_SCHEMA NOT IN (${placeholders})
      ORDER BY TABLE_NAME
      `,
      [this.database, ...SYSTEM_SCHEMAS]
    );

    return rows.map((row) => ({
      name: row.name as string,
      schema: row.schema as string,
      // TABLE_ROWS is an InnoDB estimate from the statistics, not a count —
      // same contract as PostgreSQL's reltuples, which this mirrors.
      type: row.type === "VIEW" ? ("view" as const) : ("table" as const),
      rowCount: Number(row.row_count) || 0,
      sizeBytes: Number(row.size_bytes) || 0,
    }));
  }

  /**
   * Foreign key targets for a table, keyed by local column.
   *
   * A column can belong to more than one foreign key, and the column list has
   * room for exactly one reference — so the first is kept rather than the column
   * being emitted twice. Unlike PostgreSQL, MySQL already pairs each local
   * column with its own referenced column in KEY_COLUMN_USAGE, so no ordinal
   * matching is needed here.
   */
  private async getForeignKeyColumns(
    schema: string,
    table: string
  ): Promise<Map<string, { table: string; column: string }>> {
    const rows = await this.query(
      `
      SELECT
        COLUMN_NAME AS name,
        REFERENCED_TABLE_NAME AS foreign_table,
        REFERENCED_COLUMN_NAME AS foreign_column
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = COALESCE(?, DATABASE())
        AND TABLE_NAME = ?
        AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION
      `,
      [schema || null, table]
    );

    const foreignKeys = new Map<string, { table: string; column: string }>();

    for (const row of rows) {
      const name = row.name as string;
      if (!foreignKeys.has(name)) {
        foreignKeys.set(name, {
          table: row.foreign_table as string,
          column: row.foreign_column as string,
        });
      }
    }

    return foreignKeys;
  }

  async getTableSchema(tableName: string): Promise<ColumnInfo[]> {
    const { schema, table } = this.splitTableName(tableName);

    // The foreign keys are read separately and keyed by column rather than
    // joined in. Joining duplicates the *column* when it belongs to more than
    // one foreign key — legal in MySQL, and enough to hand React two list items
    // with the same key and show the column twice in the diagram.
    const [rows, foreignKeys] = await Promise.all([
      this.query(
        `
        SELECT
          c.COLUMN_NAME AS name,
          c.DATA_TYPE AS type,
          c.COLUMN_TYPE AS column_type,
          c.IS_NULLABLE = 'YES' AS nullable,
          c.COLUMN_DEFAULT AS default_value,
          c.EXTRA AS extra,
          c.COLUMN_KEY = 'PRI' AS is_primary_key
        FROM information_schema.COLUMNS c
        WHERE c.TABLE_SCHEMA = COALESCE(?, DATABASE()) AND c.TABLE_NAME = ?
        ORDER BY c.ORDINAL_POSITION
        `,
        [schema || null, table]
      ),
      this.getForeignKeyColumns(schema, table),
    ]);

    return rows.map((row) => {
      const columnType = (row.column_type as string) ?? "";
      const defaultValue = row.default_value as string | null;

      return {
        name: row.name as string,
        // COLUMN_TYPE carries the detail DATA_TYPE drops — `varchar(255)`,
        // `int unsigned`, the enum member list — which is what a user reading
        // the column list needs.
        type: columnType || (row.type as string),
        nullable: Boolean(Number(row.nullable)),
        isPrimaryKey: Boolean(Number(row.is_primary_key)),
        isForeignKey: foreignKeys.has(row.name as string),
        defaultValue:
          defaultValue ??
          // AUTO_INCREMENT is a default in every sense the editor cares about,
          // but MySQL reports it in EXTRA with COLUMN_DEFAULT null.
          (String(row.extra ?? "").includes("auto_increment")
            ? "auto_increment"
            : undefined),
        foreignKeyRef: foreignKeys.get(row.name as string),
        enumValues: parseEnumMembers(columnType),
      };
    });
  }


  async getRelationships(): Promise<Relationship[]> {
    const rows = await this.query(
      `
      SELECT
        TABLE_NAME AS source_table,
        COLUMN_NAME AS source_column,
        REFERENCED_TABLE_NAME AS target_table,
        REFERENCED_COLUMN_NAME AS target_column
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = COALESCE(?, DATABASE())
        AND REFERENCED_TABLE_NAME IS NOT NULL
      `,
      [this.database]
    );

    return rows.map((row) => ({
      sourceTable: row.source_table as string,
      sourceColumn: row.source_column as string,
      targetTable: row.target_table as string,
      targetColumn: row.target_column as string,
      type: "one-to-many" as const,
    }));
  }

  async getRows(table: string, options: QueryOptions): Promise<PaginatedResult> {
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

    const quotedTable = this.quoteIdentifier(table);
    const offset = (page - 1) * pageSize;
    const params: unknown[] = [];

    let whereClause = "";
    if (filters && Object.keys(filters).length > 0) {
      const conditions = Object.entries(filters).map(([key, value]) => {
        this.validateColumnName(key);
        params.push(value);
        return `\`${key}\` = ?`;
      });
      whereClause = `WHERE ${conditions.join(" AND ")}`;
    }

    // An explicit multi-column orderBy wins: LIMIT/OFFSET over an unordered
    // query has no stability guarantee, so paging a whole table would repeat
    // and skip rows.
    let orderClause = "";
    if (orderBy && orderBy.length > 0) {
      const columns = orderBy.map((col) => {
        this.validateColumnName(col);
        return `\`${col}\``;
      });
      orderClause = `ORDER BY ${columns.join(", ")}`;
    } else if (sortBy) {
      this.validateColumnName(sortBy);
      orderClause = `ORDER BY \`${sortBy}\` ${sortOrder === "desc" ? "DESC" : "ASC"}`;
    }

    // Count and page fetch are independent; running them together keeps the
    // page from waiting on a scan it doesn't need. Skipped entirely when the
    // caller already holds a cached total.
    const countSql = `SELECT COUNT(*) AS total FROM ${quotedTable} ${whereClause}`;
    const dataSql = `
      SELECT * FROM ${quotedTable}
      ${whereClause}
      ${orderClause}
      LIMIT ? OFFSET ?
    `;

    const [dataRows, countRows] = await Promise.all([
      pool.query<Row[]>(dataSql, [...params, pageSize, offset]),
      includeTotal
        ? pool.query<Row[]>(countSql, params)
        : Promise.resolve(null),
    ]);

    const total = countRows ? Number(countRows[0][0]?.total) || 0 : 0;

    return {
      data: dataRows[0] as unknown as Record<string, unknown>[],
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /** Column data types for a table, keyed by column name and lowercased. */
  private async getColumnTypes(table: string): Promise<Record<string, string>> {
    const { schema, table: name } = this.splitTableName(table);

    const rows = await this.query(
      `
      SELECT COLUMN_NAME AS name, DATA_TYPE AS type, COLUMN_TYPE AS column_type
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = COALESCE(?, DATABASE()) AND TABLE_NAME = ?
      `,
      [schema || null, name]
    );

    const types: Record<string, string> = {};
    for (const row of rows) {
      // tinyint(1) is how MySQL stores a boolean; the distinction matters for
      // coercion below, and DATA_TYPE alone loses it.
      types[row.name as string] = String(
        row.column_type ?? row.type ?? ""
      ).toLowerCase();
    }
    return types;
  }

  /**
   * Coerce a value from the editor into what the driver should send.
   *
   * The grid hands back strings — every cell is a text input — so a boolean
   * column receives `"false"`, which is truthy, and a JSON column receives text
   * the driver would otherwise quote as a string rather than store as JSON.
   */
  private serializeValue(columnType: string, value: unknown): unknown {
    if (value === null || value === undefined) return value;

    const type = columnType.toLowerCase();

    if (isBooleanColumn(type)) return toMySQLBoolean(value);
    if (type.startsWith("json")) return toJsonColumnValue(value);

    // Objects and arrays reaching any other column would be sent as
    // "[object Object]"; JSON text is at least inspectable.
    if (typeof value === "object") return JSON.stringify(value);

    return value;
  }

  /**
   * Fetch a single row by its key values.
   *
   * MySQL has no `RETURNING`, so insert and update read the row back to give
   * the caller the same shape the PostgreSQL adapter returns — server-side
   * defaults, generated columns and `ON UPDATE CURRENT_TIMESTAMP` included.
   */
  private async selectRowByKey(
    table: string,
    key: Record<string, unknown>
  ): Promise<Record<string, unknown> | undefined> {
    const columns = Object.keys(key);
    if (columns.length === 0) return undefined;

    const conditions = columns.map((col) => {
      this.validateColumnName(col);
      return `\`${col}\` = ?`;
    });

    const rows = await this.query(
      `SELECT * FROM ${this.quoteIdentifier(table)} WHERE ${conditions.join(" AND ")} LIMIT 1`,
      Object.values(key)
    );

    return rows[0] as Record<string, unknown> | undefined;
  }

  /** Primary key column names for a table, in key order. */
  private async getPrimaryKeyColumns(table: string): Promise<string[]> {
    const { schema, table: name } = this.splitTableName(table);

    const rows = await this.query(
      `
      SELECT COLUMN_NAME AS name
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = COALESCE(?, DATABASE())
        AND TABLE_NAME = ?
        AND CONSTRAINT_NAME = 'PRIMARY'
      ORDER BY ORDINAL_POSITION
      `,
      [schema || null, name]
    );

    return rows.map((row) => row.name as string);
  }

  async insertRow(
    table: string,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const pool = this.getPool();
    const quotedTable = this.quoteIdentifier(table);

    const columns = Object.keys(data);
    columns.forEach((col) => this.validateColumnName(col));

    if (columns.length === 0) {
      throw new Error("Cannot insert a row with no columns");
    }

    const columnTypes = await this.getColumnTypes(table);
    const values = columns.map((col) =>
      this.serializeValue(columnTypes[col] ?? "", data[col])
    );

    const columnList = columns.map((col) => `\`${col}\``).join(", ");
    const placeholders = columns.map(() => "?").join(", ");

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO ${quotedTable} (${columnList}) VALUES (${placeholders})`,
      values
    );

    // Read the row back so the caller sees server-generated values. Prefer the
    // AUTO_INCREMENT id the server just assigned; fall back to the supplied
    // primary key columns for a table that has none.
    const primaryKeyColumns = await this.getPrimaryKeyColumns(table);
    let lookup: Record<string, unknown> | null = null;

    if (result.insertId && primaryKeyColumns.length === 1) {
      lookup = { [primaryKeyColumns[0]]: result.insertId };
    } else if (
      primaryKeyColumns.length > 0 &&
      primaryKeyColumns.every((col) => col in data)
    ) {
      lookup = Object.fromEntries(
        primaryKeyColumns.map((col) => [col, data[col]])
      );
    }

    if (lookup) {
      const inserted = await this.selectRowByKey(table, lookup);
      if (inserted) return inserted;
    }

    // Nothing to look the row up by (keyless table): echo what was written.
    return data;
  }

  async updateRow(
    table: string,
    primaryKey: Record<string, unknown>,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const pool = this.getPool();
    const quotedTable = this.quoteIdentifier(table);

    const setColumns = Object.keys(data);
    const keyColumns = Object.keys(primaryKey);

    setColumns.forEach((col) => this.validateColumnName(col));
    keyColumns.forEach((col) => this.validateColumnName(col));

    if (setColumns.length === 0) {
      throw new Error("Cannot update a row with no columns");
    }
    if (keyColumns.length === 0) {
      throw new Error("Cannot update a row without primary key values");
    }

    const columnTypes = await this.getColumnTypes(table);

    const setClause = setColumns.map((col) => `\`${col}\` = ?`).join(", ");
    const whereClause = keyColumns.map((col) => `\`${col}\` = ?`).join(" AND ");

    const values = [
      ...setColumns.map((col) =>
        this.serializeValue(columnTypes[col] ?? "", data[col])
      ),
      ...keyColumns.map((col) =>
        this.serializeValue(columnTypes[col] ?? "", primaryKey[col])
      ),
    ];

    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE ${quotedTable} SET ${setClause} WHERE ${whereClause}`,
      values
    );

    // affectedRows is 0 only when no row matched. A row matched but unchanged
    // still reports 1 here (changedRows is what counts modifications), so this
    // does not misreport a no-op edit as a missing row.
    if (result.affectedRows === 0) {
      throw new Error(
        "No rows updated. The row may not exist or primary key values may be incorrect."
      );
    }

    // The primary key itself may have just changed; look the row up by its new
    // value where the update supplied one.
    const lookup = Object.fromEntries(
      keyColumns.map((col) => [col, col in data ? data[col] : primaryKey[col]])
    );

    const updated = await this.selectRowByKey(table, lookup);
    return updated ?? { ...primaryKey, ...data };
  }

  async deleteRow(
    table: string,
    primaryKey: Record<string, unknown>
  ): Promise<boolean> {
    const pool = this.getPool();
    const quotedTable = this.quoteIdentifier(table);

    const columns = Object.keys(primaryKey);
    if (columns.length === 0) {
      throw new Error("Cannot delete a row without primary key values");
    }
    columns.forEach((col) => this.validateColumnName(col));

    const whereClause = columns.map((col) => `\`${col}\` = ?`).join(" AND ");

    const [result] = await pool.query<ResultSetHeader>(
      `DELETE FROM ${quotedTable} WHERE ${whereClause}`,
      Object.values(primaryKey)
    );

    return result.affectedRows > 0;
  }

  /**
   * Delete many rows in a single statement.
   *
   * One DELETE with the primary keys OR'd together, fully parameterized:
   *   DELETE FROM t WHERE (`id` = ?) OR (`id` = ?) ...
   * Composite keys AND their columns within each group.
   *
   * Wrapped in an explicit transaction so a partial failure rolls back rather
   * than leaving half the selection deleted — unlike PostgreSQL, MySQL's
   * autocommit would otherwise keep whatever the statement managed to remove
   * before erroring.
   */
  async deleteRows(
    table: string,
    primaryKeys: Record<string, unknown>[]
  ): Promise<BulkDeleteResult> {
    if (primaryKeys.length === 0) return { deleted: 0, failed: 0 };

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
        return `\`${col}\` = ?`;
      });
      return `(${conditions.join(" AND ")})`;
    });

    const sql = `DELETE FROM ${quotedTable} WHERE ${groups.join(" OR ")}`;
    const connection = await this.getPool().getConnection();

    try {
      await connection.beginTransaction();
      const [result] = await connection.query<ResultSetHeader>(sql, params);
      await connection.commit();

      const deleted = result.affectedRows ?? 0;
      return { deleted, failed: Math.max(0, primaryKeys.length - deleted) };
    } catch (error) {
      await connection.rollback().catch(() => {});
      return {
        deleted: 0,
        failed: primaryKeys.length,
        error: error instanceof Error ? error.message : "Bulk delete failed",
      };
    } finally {
      connection.release();
    }
  }

  /**
   * Rows a statement would affect, without running it.
   *
   * The statement is planned with plain `EXPLAIN FORMAT=JSON`, never `EXPLAIN
   * ANALYZE`. That distinction is the whole point: ANALYZE *executes* the
   * statement to gather real timings, so using it to preview a DELETE would
   * delete the rows. Plain EXPLAIN only plans, for DML as well as SELECT.
   *
   * For an UPDATE or DELETE the plan alone is not usable — see
   * `countAffectedRows`, which counts the matching rows from the condition the
   * plan reports and is what answers this for DML. Everything else, and every
   * failure of that path, falls back to the plan's own row estimate.
   *
   * The transaction wrapper is defence in depth, not the mechanism — nothing
   * that runs here modifies anything for it to roll back.
   *
   * A plan-derived number comes from index statistics and can be off by orders
   * of magnitude on a table whose statistics are stale, so callers must present
   * the result as approximate even though the DML path is usually exact.
   */
  async estimateAffectedRows(statement: string): Promise<number | null> {
    const connection = await this.getPool().getConnection();

    try {
      await connection.beginTransaction();

      const plan = await this.explainPlan(connection, statement);
      const node = plan ? this.findPlanTableNode(plan) : null;

      const estimate = node
        ? ((await this.countAffectedRows(connection, node)) ??
          this.rowsFromPlanNode(node))
        : null;

      await connection.rollback();
      return estimate;
    } catch {
      await connection.rollback().catch(() => {
        /* transaction may already be gone */
      });
      return null;
    } finally {
      connection.release();
    }
  }

  /** Run EXPLAIN FORMAT=JSON and return the parsed plan, or null. */
  private async explainPlan(
    connection: PoolConnection,
    statement: string
  ): Promise<unknown> {
    const [rows] = await connection.query<Row[]>(
      `EXPLAIN FORMAT=JSON ${statement}`
    );

    // MySQL returns the plan as a JSON string; mysql2's JSON handling and
    // MariaDB can hand back an already-parsed object.
    const raw = rows[0]?.EXPLAIN;
    if (raw === undefined || raw === null) return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  }

  /**
   * The first node in a plan that describes a table access.
   *
   * The plan is a nested tree whose shape differs between a SELECT, a DELETE
   * and a statement carrying subqueries, so this walks it rather than assuming
   * a path. Depth-first order puts the outermost table first, which for DML is
   * the statement's target; for a join it is the outer table, so a joined
   * estimate describes the driving scan and not the final result size.
   */
  private findPlanTableNode(plan: unknown): Record<string, unknown> | null {
    let found: Record<string, unknown> | null = null;

    const visit = (node: unknown): void => {
      if (found) return;
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (!node || typeof node !== "object") return;

      const record = node as Record<string, unknown>;
      if (typeof record.table_name === "string") {
        found = record;
        return;
      }
      Object.values(record).forEach(visit);
    };

    visit(plan);
    return found;
  }

  /** Rows a plan node expects to handle, preferring the post-filter figure. */
  private rowsFromPlanNode(node: Record<string, unknown>): number | null {
    const produced = node.rows_produced_per_join;
    if (typeof produced === "number") return Math.round(produced);

    const examined = node.rows_examined_per_scan;
    if (typeof examined !== "number") return null;

    // MySQL reports `filtered` as a string percentage ("100.00"); MariaDB as a
    // number. Anything else means the field is missing, and no filtering is the
    // safe reading — it keeps the estimate at the scan size rather than
    // silently shrinking it.
    const filtered = parseFilteredPercentage(node.filtered);

    return Math.round(examined * (filtered / 100));
  }

  /**
   * How long the counting query below may run before MySQL abandons it.
   *
   * The number sits behind a confirmation dialog the user is waiting on, so a
   * slow answer is worth less than a fast approximate one.
   */
  private static readonly COUNT_TIMEOUT_MS = 2000;

  /**
   * Count the rows a scoped UPDATE or DELETE would touch, using the condition
   * MySQL attached to its own plan.
   *
   * MySQL computes no selectivity for a DML plan: `DELETE FROM t WHERE bucket =
   * 'even'` on a 250-row table reports 250 rows examined and
   * `filtered: "100.00"` whatever the predicate would actually match. Reading
   * the plan alone therefore tells the user every row is about to go for any
   * predicate that does not resolve through the primary key — precisely the case
   * where a real number matters. Explaining the condition as a SELECT instead
   * fixes the indexed case but replaces the over-estimate with the optimizer's
   * fixed 10% guess when there is no index: 25 reported against 125 deleted,
   * which is the one direction a safety preview must not err in.
   *
   * So this counts. `attached_condition` is the optimizer's own rendering of the
   * WHERE clause, fully qualified, and the count runs inside the caller's
   * rolled-back transaction under a hard `MAX_EXECUTION_TIME` — bounded, exact
   * where it completes, and strictly cheaper than the statement it is previewing.
   * Returning null on anything unexpected sends the caller back to the plan
   * estimate.
   *
   * Nothing here parses the user's SQL: the table name and the condition both
   * come from MySQL, and the table name is validated before interpolation. A
   * multi-table DELETE, or a condition naming a table this SELECT does not,
   * simply fails — as does a timeout, and both fall back.
   */
  private async countAffectedRows(
    connection: PoolConnection,
    node: Record<string, unknown>
  ): Promise<number | null> {
    if (node.delete !== true && node.update !== true) return null;

    const tableName = node.table_name;
    if (typeof tableName !== "string") return null;

    try {
      this.validateIdentifier(tableName);
    } catch {
      return null;
    }

    const condition = node.attached_condition;
    const where = typeof condition === "string" ? `WHERE ${condition}` : "";

    try {
      const [rows] = await connection.query<Row[]>(
        `SELECT /*+ MAX_EXECUTION_TIME(${MySQLAdapter.COUNT_TIMEOUT_MS}) */
           COUNT(*) AS affected
         FROM \`${tableName}\` ${where}`
      );

      const affected = Number(rows[0]?.affected);
      return Number.isFinite(affected) ? affected : null;
    } catch {
      // Timed out, or the condition does not stand alone as a WHERE clause.
      return null;
    }
  }

  async executeQuery(
    query: string,
    options?: ExecuteQueryOptions
  ): Promise<QueryResult> {
    if (options?.readOnly) {
      return this.executeReadOnlyQuery(query);
    }

    const pool = this.getPool();
    const startTime = Date.now();

    try {
      const [result, fields] = await pool.query(query);
      return this.toQueryResult(result, fields, startTime);
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

  /**
   * Run a query inside a transaction MySQL itself marks read-only, then roll
   * back.
   *
   * This — not keyword matching on the query text — is what makes read-only
   * mode a guarantee. The server refuses every write with
   * `ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION` ("Cannot execute statement in a
   * READ ONLY transaction"), and that holds for constructs no parser of ours
   * would catch: writes inside a `CALL`ed procedure or a trigger the statement
   * fires, DDL, and `LOAD DATA`.
   *
   * `SET SESSION TRANSACTION READ ONLY` is issued first so that any statement
   * causing an implicit commit — DDL does — starts its next transaction
   * read-only too, rather than escaping the one opened here. The session
   * variable is reset in the same breath as the rollback, and the connection is
   * released either way.
   *
   * The trailing ROLLBACK is not itself a safety mechanism (nothing could have
   * been written); it avoids leaving an idle open transaction on the pooled
   * connection.
   */
  private async executeReadOnlyQuery(query: string): Promise<QueryResult> {
    const startTime = Date.now();
    let connection: PoolConnection | null = null;

    try {
      connection = await this.getPool().getConnection();

      await connection.query("SET SESSION TRANSACTION READ ONLY");
      await connection.query("START TRANSACTION READ ONLY");

      const [result, fields] = await connection.query(query);
      await connection.rollback();

      return this.toQueryResult(result, fields, startTime);
    } catch (error) {
      await connection?.rollback().catch(() => {
        /* transaction may already be gone */
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
      if (connection) {
        // Undo the session default before the connection returns to the pool,
        // or every later write on it would be refused.
        await connection
          .query("SET SESSION TRANSACTION READ WRITE")
          .catch(() => {});
        connection.release();
      }
    }
  }

  /**
   * Normalize a mysql2 result into the shared QueryResult shape.
   *
   * A SELECT yields row objects and field metadata; an INSERT/UPDATE/DELETE
   * yields a ResultSetHeader with no rows, whose `affectedRows` is the only
   * meaningful count to report.
   */
  private toQueryResult(
    result: unknown,
    fields: FieldPacket[] | undefined,
    startTime: number
  ): QueryResult {
    const executionTimeMs = Date.now() - startTime;

    if (Array.isArray(result)) {
      // A multi-result set (a procedure call) comes back as an array of arrays;
      // report the first, which is what the grid can render.
      const rows = (Array.isArray(result[0]) ? result[0] : result) as Record<
        string,
        unknown
      >[];
      // Field metadata is preferred because it survives an empty result set —
      // without it a query matching nothing would render no column headers.
      let columns: string[] = [];
      if (fields && fields.length > 0) {
        columns = fields.map((f) => f.name);
      } else if (rows.length > 0) {
        columns = Object.keys(rows[0]);
      }

      return { rows, columns, rowCount: rows.length, executionTimeMs };
    }

    const header = result as ResultSetHeader;
    return {
      rows: [],
      columns: [],
      rowCount: header?.affectedRows ?? 0,
      executionTimeMs,
    };
  }

  async getTableStats(table: string): Promise<TableStats> {
    const { schema, table: name } = this.splitTableName(table);

    try {
      const rows = await this.query(
        `
        SELECT
          t.TABLE_ROWS AS row_count,
          COALESCE(t.DATA_LENGTH, 0) + COALESCE(t.INDEX_LENGTH, 0) AS size_bytes,
          t.UPDATE_TIME AS last_modified,
          (
            SELECT COUNT(DISTINCT s.INDEX_NAME)
            FROM information_schema.STATISTICS s
            WHERE s.TABLE_SCHEMA = t.TABLE_SCHEMA AND s.TABLE_NAME = t.TABLE_NAME
          ) AS index_count
        FROM information_schema.TABLES t
        WHERE t.TABLE_SCHEMA = COALESCE(?, DATABASE()) AND t.TABLE_NAME = ?
        `,
        [schema || null, name]
      );

      const row = rows[0];
      return {
        rowCount: Number(row?.row_count) || 0,
        sizeBytes: Number(row?.size_bytes) || 0,
        indexCount: Number(row?.index_count) || 0,
        lastModified: row?.last_modified
          ? new Date(row.last_modified as string)
          : undefined,
      };
    } catch (error) {
      console.error("Error getting table stats:", error);
      return { rowCount: 0, sizeBytes: 0, indexCount: 0 };
    }
  }

  async getIndexInfo(table: string): Promise<IndexInfo[]> {
    const { schema, table: name } = this.splitTableName(table);

    const [rows, sizes, scans] = await Promise.all([
      this.queryIndexKeyParts(schema, name),
      this.queryIndexSizes(schema, name),
      this.queryIndexScans(schema, name),
    ]);

    const indexes = new Map<string, IndexInfo>();
    for (const row of rows) {
      const indexName = row.name as string;
      if (!indexes.has(indexName)) {
        indexes.set(indexName, {
          name: indexName,
          columns: [],
          isUnique: Boolean(Number(row.is_unique)),
          // MySQL names the primary key index PRIMARY, with no separate flag.
          isPrimary: indexName === "PRIMARY",
          type: row.type as string,
          sizeBytes: sizes.get(indexName),
          scans: scans.get(indexName),
          // MySQL has no partial indexes: an index always covers every row.
          isPartial: false,
        });
      }
      indexes.get(indexName)!.columns.push(row.column_name as string);
    }

    // MySQL has no pg_get_indexdef, so the DDL is reconstructed from the key
    // parts. Built after the columns are collected, not per row.
    for (const index of indexes.values()) {
      index.definition = this.buildIndexDefinition(name, index);
    }

    return Array.from(indexes.values());
  }

  /**
   * One row per index key part, in key order.
   *
   * MySQL 8.0.13+ reports a functional key part with COLUMN_NAME null and the
   * expression in EXPRESSION. That column does not exist on older MySQL or on
   * MariaDB, so the richer query is tried first and the portable one is the
   * fallback — which loses nothing there, because neither has functional
   * indexes to describe.
   *
   * Getting this right matters beyond display: two functional indexes reduced to
   * the same placeholder would look like identical column lists, and the health
   * analysis would report one of them as a duplicate of the other.
   */
  private async queryIndexKeyParts(
    schema: string,
    name: string
  ): Promise<Row[]> {
    const select = (columnExpression: string) => `
      SELECT
        INDEX_NAME AS name,
        ${columnExpression} AS column_name,
        NON_UNIQUE = 0 AS is_unique,
        INDEX_TYPE AS type,
        SEQ_IN_INDEX AS seq
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = COALESCE(?, DATABASE()) AND TABLE_NAME = ?
      ORDER BY INDEX_NAME, SEQ_IN_INDEX
    `;

    const params = [schema || null, name];

    try {
      return await this.query(
        select("COALESCE(COLUMN_NAME, CONCAT('(', EXPRESSION, ')'))"),
        params
      );
    } catch {
      return await this.query(select("COLUMN_NAME"), params);
    }
  }

  /**
   * Bytes per index, from InnoDB's own page counts.
   *
   * Reading `mysql.innodb_index_stats` needs privileges on the `mysql` schema
   * that a restricted application user will not have, so failure is expected and
   * leaves the size undefined rather than reporting zero — an index of unknown
   * size must not be rendered as an empty one.
   */
  private async queryIndexSizes(
    schema: string,
    name: string
  ): Promise<Map<string, number>> {
    const sizes = new Map<string, number>();

    try {
      const rows = await this.query(
        `
        SELECT
          index_name AS name,
          SUM(stat_value) * @@innodb_page_size AS size_bytes
        FROM mysql.innodb_index_stats
        WHERE database_name = COALESCE(?, DATABASE())
          AND table_name = ?
          AND stat_name = 'size'
        GROUP BY index_name
        `,
        [schema || null, name]
      );

      for (const row of rows) {
        const bytes = Number(row.size_bytes);
        if (Number.isFinite(bytes)) sizes.set(row.name as string, bytes);
      }
    } catch {
      /* no privilege on mysql.*, or a non-InnoDB engine */
    }

    return sizes;
  }

  /**
   * Times each index has been read, from the Performance Schema.
   *
   * This is MySQL's nearest equivalent to PostgreSQL's `idx_scan`, and the same
   * source `sys.schema_unused_indexes` is built on. It can be disabled or
   * unavailable, in which case the count stays undefined — the health analysis
   * treats "unknown" and "zero" differently, and reporting zero here would
   * accuse every index of being unused.
   */
  private async queryIndexScans(
    schema: string,
    name: string
  ): Promise<Map<string, number>> {
    const scans = new Map<string, number>();

    try {
      const rows = await this.query(
        `
        SELECT INDEX_NAME AS name, COUNT_STAR AS scans
        FROM performance_schema.table_io_waits_summary_by_index_usage
        WHERE OBJECT_SCHEMA = COALESCE(?, DATABASE())
          AND OBJECT_NAME = ?
          AND INDEX_NAME IS NOT NULL
        `,
        [schema || null, name]
      );

      for (const row of rows) {
        const count = Number(row.scans);
        if (Number.isFinite(count)) scans.set(row.name as string, count);
      }
    } catch {
      /* performance_schema disabled or not readable */
    }

    return scans;
  }

  /** Wrap a name in MySQL's identifier quotes. Assumes it is already validated. */
  private backtick(name: string): string {
    return "`" + name + "`";
  }

  /** Reconstruct an index's DDL for display. */
  private buildIndexDefinition(table: string, index: IndexInfo): string {
    const columns = index.columns.map((column) =>
      // A functional key part is already parenthesised and must not be quoted
      // as if it were a column name.
      column.startsWith("(") ? column : this.backtick(column)
    );

    if (index.isPrimary) {
      return `PRIMARY KEY (${columns.join(", ")})`;
    }

    const type = index.type.toUpperCase();
    const prefix =
      type === "FULLTEXT" || type === "SPATIAL"
        ? `CREATE ${type} INDEX`
        : `CREATE ${index.isUnique ? "UNIQUE " : ""}INDEX`;
    const using =
      type === "FULLTEXT" || type === "SPATIAL" ? "" : ` USING ${type}`;

    const target = `${this.backtick(index.name)} ON ${this.backtick(table)}`;
    return `${prefix} ${target} (${columns.join(", ")})${using}`;
  }

  /**
   * Index types this adapter will build.
   *
   * FULLTEXT and SPATIAL are spelled as a prefix to CREATE rather than a USING
   * clause, which is why they are handled apart from the access methods below.
   */
  private static readonly INDEX_METHODS = [
    "btree",
    "hash",
    "fulltext",
    "spatial",
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

    // MySQL has no partial indexes. Building a full index instead would quietly
    // cost far more disk and write time than was asked for, so this refuses
    // rather than approximating.
    if (options.where) {
      throw new Error(
        "MySQL does not support partial indexes. Remove the WHERE predicate, or express the condition as a generated column and index that."
      );
    }

    const method = (options.method ?? "btree").toLowerCase();
    if (!(MySQLAdapter.INDEX_METHODS as readonly string[]).includes(method)) {
      throw new Error(
        `Unsupported index method: ${options.method}. Expected one of ${MySQLAdapter.INDEX_METHODS.join(", ")}.`
      );
    }

    const isSpecialType = method === "fulltext" || method === "spatial";
    if (isSpecialType && options.unique) {
      throw new Error(`A ${method.toUpperCase()} index cannot be UNIQUE.`);
    }

    const columnList = options.columns
      .map((column) => this.backtick(column))
      .join(", ");

    const statement = [
      "CREATE",
      isSpecialType ? method.toUpperCase() : options.unique ? "UNIQUE" : "",
      "INDEX",
      this.backtick(options.name),
      `ON ${quotedTable}`,
      `(${columnList})`,
      isSpecialType ? "" : `USING ${method.toUpperCase()}`,
      // MySQL's counterpart to PostgreSQL's CONCURRENTLY. Unlike PostgreSQL this
      // is the server's default for most index builds; asking explicitly makes
      // it an error rather than a silent table-copy when the storage engine
      // cannot do it online, which is the useful behaviour for a caller who
      // specifically asked not to block writes.
      // Space-separated, not comma-separated: the comma form belongs to ALTER
      // TABLE, and CREATE INDEX takes these as two independent clauses.
      options.concurrent ? "ALGORITHM=INPLACE LOCK=NONE" : "",
    ]
      .filter(Boolean)
      .join(" ");

    await pool.query(statement);

    const created = (await this.getIndexInfo(table)).find(
      (index) => index.name === options.name
    );

    if (!created) {
      throw new Error(
        `Index ${options.name} was created but could not be read back`
      );
    }

    return created;
  }

  async dropIndex(table: string, indexName: string): Promise<boolean> {
    const pool = this.getPool();
    this.validateColumnName(indexName);

    const existing = (await this.getIndexInfo(table)).find(
      (index) => index.name === indexName
    );

    if (!existing) return false;

    if (existing.isPrimary) {
      throw new Error(
        "PRIMARY implements the primary key and cannot be dropped on its own. Drop the constraint instead."
      );
    }

    await pool.query(
      `DROP INDEX ${this.backtick(indexName)} ON ${this.quoteIdentifier(table)}`
    );

    return true;
  }

  async getDatabaseStats(): Promise<{
    totalSize: number;
    tableCount: number;
    version: string;
  }> {
    const [sizeRows, versionRows] = await Promise.all([
      this.query(
        `
        SELECT
          COALESCE(SUM(COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0)), 0) AS total_size,
          COUNT(*) AS table_count
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = COALESCE(?, DATABASE())
        `,
        [this.database]
      ),
      this.query("SELECT VERSION() AS version"),
    ]);

    return {
      totalSize: Number(sizeRows[0]?.total_size) || 0,
      tableCount: Number(sizeRows[0]?.table_count) || 0,
      version: `MySQL ${versionRows[0]?.version ?? "unknown"}`,
    };
  }
}
