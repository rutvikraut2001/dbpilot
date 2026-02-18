import Redis from "ioredis";
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

export class RedisAdapter extends BaseAdapter {
  private client: Redis | null = null;
  private currentDb: number = 0;

  readonly capabilities: AdapterCapabilities = {
    supportsUpdate: true,
    supportsDelete: true,
    supportsTransactions: false,
  };

  async connect(): Promise<void> {
    try {
      const parsedUrl = new URL(this.connectionString);
      const pathname = parsedUrl.pathname.slice(1);
      this.currentDb = pathname ? parseInt(pathname, 10) : 0;

      if (this.currentDb < 0 || this.currentDb > 15) {
        throw new Error("Redis database must be between 0 and 15");
      }

      this.client = new Redis({
        host: parsedUrl.hostname || "localhost",
        port: parseInt(parsedUrl.port || "6379", 10),
        username: parsedUrl.username || undefined,
        password: parsedUrl.password
          ? decodeURIComponent(parsedUrl.password)
          : undefined,
        db: this.currentDb,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) return null;
          return Math.min(times * 50, 2000);
        },
        connectionName: "db-studio",
        lazyConnect: false,
        enableReadyCheck: true,
        connectTimeout: 10000,
      });

      await this.client.ping();
      this.connected = true;
    } catch (error) {
      this.connected = false;
      if (this.client) {
        this.client.disconnect();
        this.client = null;
      }
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.connected = false;
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    let testClient: Redis | null = null;
    try {
      const parsedUrl = new URL(this.connectionString);
      const db = parsedUrl.pathname.slice(1);
      const dbNum = db ? parseInt(db, 10) : 0;

      testClient = new Redis({
        host: parsedUrl.hostname || "localhost",
        port: parseInt(parsedUrl.port || "6379", 10),
        username: parsedUrl.username || undefined,
        password: parsedUrl.password
          ? decodeURIComponent(parsedUrl.password)
          : undefined,
        db: dbNum,
        connectTimeout: 5000,
        lazyConnect: false,
      });

      const info = await testClient.info("server");
      const versionMatch = info.match(/redis_version:([^\r\n]+)/);
      const version = versionMatch ? versionMatch[1] : "unknown";

      await testClient.quit();

      return {
        success: true,
        message: `Connected successfully. Redis ${version} (DB ${dbNum})`,
      };
    } catch (error) {
      if (testClient) {
        testClient.disconnect();
      }
      return {
        success: false,
        message: error instanceof Error ? error.message : "Connection failed",
      };
    }
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  private getClient(): Redis {
    if (!this.client) {
      throw new Error("Database not connected. Call connect() first.");
    }
    return this.client;
  }

  // ── Redis-specific operations ───────────────────────────────────────

  async flushDb(): Promise<void> {
    const client = this.getClient();
    await client.flushdb();
  }

  async flushAll(): Promise<void> {
    const client = this.getClient();
    await client.flushall();
  }

  // ── Schema operations ──────────────────────────────────────────────

  async getTables(): Promise<TableInfo[]> {
    const client = this.getClient();
    const dbSize = await client.dbsize();

    if (dbSize === 0) {
      return [];
    }

    // Scan keys and group by prefix pattern
    const patternCounts = new Map<string, number>();
    let cursor = "0";
    const maxScan = 10000;
    let scannedCount = 0;

    do {
      const [newCursor, keys] = await client.scan(cursor, "COUNT", 200);
      cursor = newCursor;

      for (const key of keys) {
        scannedCount++;
        const pattern = this.extractPattern(key);

        patternCounts.set(pattern, (patternCounts.get(pattern) || 0) + 1);

        if (scannedCount >= maxScan) break;
      }

      if (scannedCount >= maxScan) break;
    } while (cursor !== "0");

    const tables: TableInfo[] = [];

    for (const [pattern, count] of patternCounts) {
      tables.push({
        name: pattern,
        type: "keyspace" as TableInfo["type"],
        rowCount: count,
      });
    }

    // Sort by key count descending
    tables.sort((a, b) => (b.rowCount || 0) - (a.rowCount || 0));

    return tables;
  }

  /**
   * Extract a pattern from a Redis key.
   * "user:123" -> "user:*", "session:abc:data" -> "session:*", "simple" -> "simple"
   */
  private extractPattern(key: string): string {
    if (key.includes(":")) {
      const prefix = key.split(":")[0];
      return prefix + ":*";
    }
    return key;
  }

  async getTableSchema(tableName: string): Promise<ColumnInfo[]> {
    const client = this.getClient();

    // Sample keys matching the pattern to discover types
    const sampleKeys: string[] = [];
    const isPattern = tableName.includes("*");
    const scanPattern = isPattern ? tableName : tableName;

    if (isPattern) {
      let cursor = "0";
      do {
        const [newCursor, keys] = await client.scan(
          cursor,
          "MATCH",
          scanPattern,
          "COUNT",
          100
        );
        cursor = newCursor;
        sampleKeys.push(...keys);
        if (sampleKeys.length >= 50) break;
      } while (cursor !== "0");
    } else {
      // Single key (non-pattern table)
      const exists = await client.exists(tableName);
      if (exists) {
        sampleKeys.push(tableName);
      }
    }

    // Determine types present
    const types = new Set<string>();
    for (const key of sampleKeys.slice(0, 50)) {
      try {
        const type = await client.type(key);
        types.add(type);
      } catch {
        // skip
      }
    }

    const columns: ColumnInfo[] = [
      {
        name: "key",
        type: "string",
        nullable: false,
        isPrimaryKey: true,
        isForeignKey: false,
      },
      {
        name: "type",
        type: types.size > 0 ? Array.from(types).join(" | ") : "string",
        nullable: false,
        isPrimaryKey: false,
        isForeignKey: false,
      },
      {
        name: "value",
        type: "mixed",
        nullable: false,
        isPrimaryKey: false,
        isForeignKey: false,
      },
      {
        name: "ttl",
        type: "integer",
        nullable: true,
        isPrimaryKey: false,
        isForeignKey: false,
        defaultValue: "-1",
      },
      {
        name: "memory",
        type: "integer (bytes)",
        nullable: true,
        isPrimaryKey: false,
        isForeignKey: false,
      },
    ];

    return columns;
  }

  async getRelationships(): Promise<Relationship[]> {
    return [];
  }

  // ── Data operations ────────────────────────────────────────────────

  async getRows(
    table: string,
    options: QueryOptions
  ): Promise<PaginatedResult> {
    const client = this.getClient();
    const { page, pageSize, sortBy, sortOrder } = options;

    // Collect keys matching the pattern
    const isPattern = table.includes("*");
    const allKeys: string[] = [];

    if (isPattern) {
      let cursor = "0";
      do {
        const [newCursor, keys] = await client.scan(
          cursor,
          "MATCH",
          table,
          "COUNT",
          1000
        );
        cursor = newCursor;
        allKeys.push(...keys);
      } while (cursor !== "0");
    } else {
      // Single key
      const exists = await client.exists(table);
      if (exists) {
        allKeys.push(table);
      }
    }

    const total = allKeys.length;

    // Sort keys
    let sortedKeys = [...allKeys];
    if (sortBy === "key" || !sortBy) {
      sortedKeys.sort((a, b) =>
        sortOrder === "desc" ? b.localeCompare(a) : a.localeCompare(b)
      );
    }

    // Paginate
    const offset = (page - 1) * pageSize;
    const pageKeys = sortedKeys.slice(offset, offset + pageSize);

    // Fetch data for each key using pipeline for efficiency
    const rows = await Promise.all(
      pageKeys.map(async (key) => {
        try {
          const [type, ttl] = await Promise.all([
            client.type(key),
            client.ttl(key),
          ]);

          let memory: number | null = null;
          try {
            memory = await client.call("MEMORY", "USAGE", key) as number | null;
          } catch {
            // MEMORY USAGE might not be available
          }

          const value = await this.fetchValue(client, key, type);

          return {
            key,
            type,
            value: typeof value === "object" ? JSON.stringify(value) : value,
            ttl: ttl === -1 ? null : ttl,
            memory,
          };
        } catch (error) {
          return {
            key,
            type: "error",
            value:
              error instanceof Error ? error.message : "Failed to read key",
            ttl: null,
            memory: null,
          };
        }
      })
    );

    return {
      data: rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Fetch value based on Redis data type.
   */
  private async fetchValue(
    client: Redis,
    key: string,
    type: string
  ): Promise<unknown> {
    switch (type) {
      case "string":
        return await client.get(key);

      case "list":
        return await client.lrange(key, 0, 99);

      case "set":
        return await client.smembers(key);

      case "zset": {
        const members = await client.zrange(key, 0, 99, "WITHSCORES");
        const result: Array<{ member: string; score: string }> = [];
        for (let i = 0; i < members.length; i += 2) {
          result.push({ member: members[i], score: members[i + 1] });
        }
        return result;
      }

      case "hash":
        return await client.hgetall(key);

      case "stream": {
        const entries = await client.xrange(key, "-", "+", "COUNT", 100);
        return entries;
      }

      default:
        return null;
    }
  }

  async insertRow(
    _table: string,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const client = this.getClient();

    const key = data.key as string;
    const type = (data.type as string) || "string";
    const value = data.value;
    const ttl = data.ttl as number | null | undefined;

    if (!key) {
      throw new Error("Key is required");
    }

    // Check if key already exists
    const exists = await client.exists(key);
    if (exists) {
      throw new Error(`Key already exists: ${key}. Use update to modify it.`);
    }

    await this.setValue(client, key, type, value);

    if (ttl && ttl > 0) {
      await client.expire(key, ttl);
    }

    return data;
  }

  async updateRow(
    _table: string,
    primaryKey: Record<string, unknown>,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const client = this.getClient();

    const key = primaryKey.key as string;
    if (!key) {
      throw new Error("Key is required for update");
    }

    const exists = await client.exists(key);
    if (!exists) {
      throw new Error(`Key not found: ${key}`);
    }

    if ("value" in data) {
      const type = await client.type(key);
      await this.setValue(client, key, type, data.value);
    }

    if ("ttl" in data) {
      const ttl = data.ttl as number | null;
      if (ttl && ttl > 0) {
        await client.expire(key, ttl);
      } else if (ttl === null || ttl === -1) {
        await client.persist(key);
      }
    }

    // Return updated state
    const type = await client.type(key);
    const updatedValue = await this.fetchValue(client, key, type);
    const updatedTtl = await client.ttl(key);

    return {
      key,
      type,
      value:
        typeof updatedValue === "object"
          ? JSON.stringify(updatedValue)
          : updatedValue,
      ttl: updatedTtl === -1 ? null : updatedTtl,
    };
  }

  async deleteRow(
    _table: string,
    primaryKey: Record<string, unknown>
  ): Promise<boolean> {
    const client = this.getClient();

    const key = primaryKey.key as string;
    if (!key) {
      throw new Error("Key is required for delete");
    }

    const result = await client.del(key);
    return result > 0;
  }

  /**
   * Set a Redis key value based on data type.
   */
  private async setValue(
    client: Redis,
    key: string,
    type: string,
    value: unknown
  ): Promise<void> {
    switch (type) {
      case "string":
        await client.set(key, String(value));
        break;

      case "list": {
        const listItems = this.parseArrayValue(value);
        await client.del(key);
        if (listItems.length > 0) {
          await client.rpush(key, ...listItems);
        }
        break;
      }

      case "set": {
        const setItems = this.parseArrayValue(value);
        await client.del(key);
        if (setItems.length > 0) {
          await client.sadd(key, ...setItems);
        }
        break;
      }

      case "zset": {
        const parsed = typeof value === "string" ? JSON.parse(value) : value;
        if (Array.isArray(parsed)) {
          await client.del(key);
          const args: (string | number)[] = [];
          for (const item of parsed) {
            if (
              typeof item === "object" &&
              item !== null &&
              "score" in item &&
              ("member" in item || "value" in item)
            ) {
              args.push(
                Number(item.score),
                String(item.member || item.value)
              );
            }
          }
          if (args.length > 0) {
            await (client as unknown as { zadd: (key: string, ...args: (string | number)[]) => Promise<number> }).zadd(key, ...args);
          }
        }
        break;
      }

      case "hash": {
        const hashData =
          typeof value === "string" ? JSON.parse(value) : value;
        if (typeof hashData === "object" && hashData !== null) {
          await client.del(key);
          const entries = Object.entries(
            hashData as Record<string, unknown>
          );
          if (entries.length > 0) {
            const flat: string[] = [];
            for (const [field, val] of entries) {
              flat.push(field, String(val));
            }
            await client.hset(key, ...flat);
          }
        }
        break;
      }

      default:
        await client.set(key, String(value));
        break;
    }
  }

  private parseArrayValue(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map(String);
    }
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed.map(String);
        }
      } catch {
        // Not JSON, treat as single value
        return [value];
      }
    }
    return [String(value)];
  }

  // ── Query execution ────────────────────────────────────────────────

  async executeQuery(query: string): Promise<QueryResult> {
    const client = this.getClient();
    const startTime = Date.now();

    try {
      // Parse Redis command: "GET mykey", "HGETALL myhash", etc.
      const parts = this.parseRedisCommand(query.trim());
      if (parts.length === 0) {
        throw new Error("Empty command");
      }

      const command = parts[0].toUpperCase();
      const args = parts.slice(1);

      // Execute command using call()
      const result = await client.call(command, ...args);

      // Format result into rows/columns
      const { rows, columns } = this.formatCommandResult(command, result);

      return {
        rows,
        columns,
        rowCount: rows.length,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        rows: [],
        columns: [],
        rowCount: 0,
        executionTimeMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : "Command execution failed",
      };
    }
  }

  /**
   * Parse a Redis command string, handling quoted arguments.
   */
  private parseRedisCommand(input: string): string[] {
    const parts: string[] = [];
    let current = "";
    let inSingle = false;
    let inDouble = false;

    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      if (char === "'" && !inDouble) {
        inSingle = !inSingle;
        continue;
      }
      if (char === '"' && !inSingle) {
        inDouble = !inDouble;
        continue;
      }
      if (char === " " && !inSingle && !inDouble) {
        if (current.length > 0) {
          parts.push(current);
          current = "";
        }
        continue;
      }

      current += char;
    }

    if (current.length > 0) {
      parts.push(current);
    }

    return parts;
  }

  /**
   * Format raw Redis command results into rows/columns for display.
   */
  private formatCommandResult(
    command: string,
    result: unknown
  ): { rows: Record<string, unknown>[]; columns: string[] } {
    if (result === null || result === undefined) {
      return { rows: [{ result: "(nil)" }], columns: ["result"] };
    }

    // Integer result (INCR, DEL, EXISTS, etc.)
    if (typeof result === "number") {
      return { rows: [{ result }], columns: ["result"] };
    }

    // String result (GET, SET OK, etc.)
    if (typeof result === "string" || Buffer.isBuffer(result)) {
      const val = Buffer.isBuffer(result) ? result.toString() : result;
      return { rows: [{ result: val }], columns: ["result"] };
    }

    // Array result
    if (Array.isArray(result)) {
      // HGETALL returns alternating field/value
      const hashCommands = ["HGETALL"];
      if (hashCommands.includes(command) && result.length % 2 === 0) {
        const rows: Record<string, unknown>[] = [];
        for (let i = 0; i < result.length; i += 2) {
          rows.push({
            field: String(result[i]),
            value: String(result[i + 1]),
          });
        }
        return { rows, columns: ["field", "value"] };
      }

      // ZRANGE WITHSCORES
      const zsetCommands = ["ZRANGEBYSCORE", "ZREVRANGEBYSCORE"];
      if (
        (command === "ZRANGE" || zsetCommands.includes(command)) &&
        result.length % 2 === 0 &&
        result.length > 0
      ) {
        // Check if it looks like score pairs
        const mightBeScores = result.length >= 2 && !isNaN(Number(result[1]));
        if (mightBeScores) {
          const rows: Record<string, unknown>[] = [];
          for (let i = 0; i < result.length; i += 2) {
            rows.push({
              member: String(result[i]),
              score: String(result[i + 1]),
            });
          }
          return { rows, columns: ["member", "score"] };
        }
      }

      // XRANGE / XREVRANGE stream entries
      if (
        (command === "XRANGE" || command === "XREVRANGE") &&
        result.length > 0 &&
        Array.isArray(result[0])
      ) {
        const rows: Record<string, unknown>[] = result.map(
          (entry: unknown) => {
            if (Array.isArray(entry) && entry.length === 2) {
              const [id, fields] = entry;
              const data: Record<string, unknown> = { id: String(id) };
              if (Array.isArray(fields)) {
                for (let i = 0; i < fields.length; i += 2) {
                  data[String(fields[i])] = String(fields[i + 1]);
                }
              }
              return data;
            }
            return { value: String(entry) };
          }
        );
        const columns =
          rows.length > 0 ? Object.keys(rows[0]) : ["id"];
        return { rows, columns };
      }

      // Generic array: KEYS, SMEMBERS, LRANGE, etc.
      const rows = result.map((item, index) => ({
        index: index + 1,
        value: Buffer.isBuffer(item) ? item.toString() : String(item),
      }));
      return {
        rows: rows.length > 0 ? rows : [{ result: "(empty array)" }],
        columns: rows.length > 0 ? ["index", "value"] : ["result"],
      };
    }

    // Fallback
    return { rows: [{ result: String(result) }], columns: ["result"] };
  }

  // ── Analytics ──────────────────────────────────────────────────────

  async getTableStats(table: string): Promise<TableStats> {
    const client = this.getClient();
    const isPattern = table.includes("*");

    let count = 0;
    let totalMemory = 0;
    let sampledForMemory = 0;

    if (isPattern) {
      let cursor = "0";
      do {
        const [newCursor, keys] = await client.scan(
          cursor,
          "MATCH",
          table,
          "COUNT",
          200
        );
        cursor = newCursor;
        count += keys.length;

        // Sample memory usage from first batch
        if (sampledForMemory < 20) {
          for (const key of keys.slice(0, 20 - sampledForMemory)) {
            try {
              const mem = (await client.memory("USAGE", key)) as number | null;
              if (mem) {
                totalMemory += mem;
                sampledForMemory++;
              }
            } catch {
              break; // MEMORY USAGE not supported
            }
          }
        }
      } while (cursor !== "0");
    } else {
      const exists = await client.exists(table);
      count = exists ? 1 : 0;
      if (exists) {
        try {
          const mem = (await client.call("MEMORY", "USAGE", table)) as number | null;
          if (mem) totalMemory = mem;
        } catch {
          // ignore
        }
      }
    }

    // Estimate total memory
    const avgMemory =
      sampledForMemory > 0 ? totalMemory / sampledForMemory : 0;
    const estimatedSize =
      sampledForMemory > 0 ? Math.round(avgMemory * count) : totalMemory;

    return {
      rowCount: count,
      sizeBytes: estimatedSize,
      indexCount: 0,
    };
  }

  async getIndexInfo(): Promise<IndexInfo[]> {
    // Redis doesn't have traditional indexes
    return [];
  }

  async getDatabaseStats(): Promise<{
    totalSize: number;
    tableCount: number;
    version: string;
  }> {
    const client = this.getClient();

    const [dbSize, serverInfo, memoryInfo] = await Promise.all([
      client.dbsize(),
      client.info("server"),
      client.info("memory"),
    ]);

    const versionMatch = serverInfo.match(/redis_version:([^\r\n]+)/);
    const version = versionMatch ? `Redis ${versionMatch[1]}` : "Redis";

    const memoryMatch = memoryInfo.match(/used_memory:(\d+)/);
    const totalSize = memoryMatch ? parseInt(memoryMatch[1], 10) : 0;

    return {
      totalSize,
      tableCount: dbSize,
      version,
    };
  }
}
