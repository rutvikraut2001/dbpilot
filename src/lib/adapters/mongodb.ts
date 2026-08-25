import {
  MongoClient,
  Db,
  ObjectId,
  Document,
  IndexDirection,
} from 'mongodb';
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
  CreateIndexOptions,
  AdapterCapabilities,
  ExecuteQueryOptions,
  QueryDialect,
} from './types';
import { isWriteMongoQuery } from '../query-guard';
import { parseMongoQuery } from '../mongo-query';

export class MongoDBAdapter extends BaseAdapter {
  readonly dialect: QueryDialect = 'mongodb';

  readonly capabilities: AdapterCapabilities = {
    supportsUpdate: true,
    supportsDelete: true,
    // MongoDB has multi-document transactions only on a replica set, which a
    // standalone development server is not.
    supportsTransactions: false,
    supportsIndexManagement: true,
  };

  private client: MongoClient | null = null;
  private db: Db | null = null;

  async connect(): Promise<void> {
    try {
      this.client = new MongoClient(this.connectionString, {
        // Production-ready connection pool settings
        maxPoolSize: 20, // Max connections for high traffic
        minPoolSize: 2, // Keep minimum connections ready
        maxIdleTimeMS: 30000, // Close idle connections after 30s
        serverSelectionTimeoutMS: 10000, // Server selection timeout
        socketTimeoutMS: 30000, // Socket timeout for operations
        // Keep connections alive
        heartbeatFrequencyMS: 10000,
        // Compression for large data transfers
        compressors: ["zlib"],
      });
      await this.client.connect();

      // Extract database name from connection string or use default
      const dbName = this.extractDatabaseName();
      this.db = this.client.db(dbName);
      this.connected = true;
    } catch (error) {
      this.connected = false;
      throw error;
    }
  }

  private extractDatabaseName(): string {
    // Try to extract database name from connection string
    const url = new URL(this.connectionString);
    const dbName = url.pathname.slice(1); // Remove leading slash
    return dbName || 'test';
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      this.connected = false;
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const testClient = new MongoClient(this.connectionString, {
        serverSelectionTimeoutMS: 5000,
      });

      await testClient.connect();
      const admin = testClient.db().admin();
      const serverInfo = await admin.serverStatus();
      await testClient.close();

      return {
        success: true,
        message: `Connected successfully. MongoDB ${serverInfo.version}`,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  /**
   * Lightweight health check using existing connection (no new connections).
   * Use this for reconnect checks instead of testConnection.
   */
  async ping(): Promise<boolean> {
    if (!this.client || !this.db) return false;
    try {
      await this.db.command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }

  private getDb(): Db {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.db;
  }

  async getTables(): Promise<TableInfo[]> {
    const db = this.getDb();

    const collections = await db.listCollections().toArray();
    const tableInfos: TableInfo[] = [];

    for (const collection of collections) {
      try {
        const count = await db.collection(collection.name).estimatedDocumentCount();
        tableInfos.push({
          name: collection.name,
          type: 'collection',
          rowCount: count,
        });
      } catch {
        // If count fails, still include the collection
        tableInfos.push({
          name: collection.name,
          type: 'collection',
        });
      }
    }

    return tableInfos.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getTableSchema(tableName: string): Promise<ColumnInfo[]> {
    const db = this.getDb();
    const collection = db.collection(tableName);

    // Sample documents to infer schema
    const sampleSize = 100;
    const samples = await collection.find().limit(sampleSize).toArray();

    if (samples.length === 0) {
      return [];
    }

    // Analyze field frequency and types
    const fieldStats = new Map<string, { count: number; types: Set<string> }>();

    const analyzeDocument = (doc: Document, prefix = '') => {
      for (const [key, value] of Object.entries(doc)) {
        const fieldName = prefix ? `${prefix}.${key}` : key;

        if (!fieldStats.has(fieldName)) {
          fieldStats.set(fieldName, { count: 0, types: new Set() });
        }

        const stats = fieldStats.get(fieldName)!;
        stats.count++;
        stats.types.add(this.getMongoType(value));

        // Recursively analyze nested objects (but not arrays or ObjectId)
        if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof ObjectId)) {
          analyzeDocument(value, fieldName);
        }
      }
    };

    for (const doc of samples) {
      analyzeDocument(doc);
    }

    // Convert to ColumnInfo format
    const columns: ColumnInfo[] = [];
    for (const [name, stats] of fieldStats) {
      const types = Array.from(stats.types);
      columns.push({
        name,
        type: types.length === 1 ? types[0] : `mixed(${types.join(', ')})`,
        nullable: stats.count < samples.length,
        isPrimaryKey: name === '_id',
        isForeignKey: false, // MongoDB doesn't have foreign keys
        frequency: stats.count / samples.length,
      });
    }

    // Sort by frequency (most common first), then by name
    columns.sort((a, b) => {
      if (a.name === '_id') return -1;
      if (b.name === '_id') return 1;
      if ((b.frequency || 0) !== (a.frequency || 0)) {
        return (b.frequency || 0) - (a.frequency || 0);
      }
      return a.name.localeCompare(b.name);
    });

    return columns;
  }

  private getMongoType(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (value instanceof ObjectId) return 'ObjectId';
    if (value instanceof Date) return 'Date';
    if (Array.isArray(value)) return 'Array';
    if (typeof value === 'object') return 'Object';
    return typeof value;
  }

  async getRelationships(): Promise<Relationship[]> {
    // MongoDB doesn't have formal relationships like SQL databases
    // We could potentially analyze $lookup patterns or naming conventions
    // but for now return empty array
    return [];
  }

  async getRows(table: string, options: QueryOptions): Promise<PaginatedResult> {
    const db = this.getDb();
    const collection = db.collection(table);
    const {
      page,
      pageSize,
      sortBy,
      sortOrder,
      filters,
      includeTotal = true,
      orderBy,
    } = options;

    const skip = (page - 1) * pageSize;
    const query = filters || {};

    // Build sort object. An explicit orderBy wins — skip/limit over an unsorted
    // cursor has no stable order, so a full walk would repeat and skip docs.
    const sort: Record<string, 1 | -1> = {};
    if (orderBy && orderBy.length > 0) {
      for (const col of orderBy) sort[col] = 1;
    } else if (sortBy) {
      sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
    }

    // countDocuments scans; skip it when the caller already has a cached total.
    const [data, total] = await Promise.all([
      collection.find(query).sort(sort).skip(skip).limit(pageSize).toArray(),
      includeTotal ? collection.countDocuments(query) : Promise.resolve(0),
    ]);

    // Convert ObjectId to string for JSON serialization
    const serializedData = data.map((doc) => this.serializeDocument(doc));

    return {
      data: serializedData,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  private serializeDocument(doc: Document): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(doc)) {
      if (value instanceof ObjectId) {
        result[key] = value.toHexString();
      } else if (value instanceof Date) {
        result[key] = value.toISOString();
      } else if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          item instanceof ObjectId
            ? item.toHexString()
            : typeof item === 'object' && item !== null
            ? this.serializeDocument(item as Document)
            : item
        );
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.serializeDocument(value as Document);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  async insertRow(table: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const db = this.getDb();
    const collection = db.collection(table);

    const result = await collection.insertOne(data as Document);

    return {
      ...data,
      _id: result.insertedId.toHexString(),
    };
  }

  async updateRow(
    table: string,
    primaryKey: Record<string, unknown>,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const db = this.getDb();
    const collection = db.collection(table);

    // Convert string _id to ObjectId if needed
    const filter: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(primaryKey)) {
      if (key === '_id' && typeof value === 'string') {
        filter[key] = new ObjectId(value);
      } else {
        filter[key] = value;
      }
    }

    // Remove _id from update data if present
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _id, ...updateData } = data;

    await collection.updateOne(filter, { $set: updateData });

    const updated = await collection.findOne(filter);
    return updated ? this.serializeDocument(updated) : { ...data, ...primaryKey };
  }

  async deleteRow(table: string, primaryKey: Record<string, unknown>): Promise<boolean> {
    const db = this.getDb();
    const collection = db.collection(table);

    // Convert string _id to ObjectId if needed
    const filter: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(primaryKey)) {
      if (key === '_id' && typeof value === 'string') {
        filter[key] = new ObjectId(value);
      } else {
        filter[key] = value;
      }
    }

    const result = await collection.deleteOne(filter);
    return result.deletedCount > 0;
  }

  async executeQuery(
    query: string,
    options?: ExecuteQueryOptions,
  ): Promise<QueryResult> {
    const db = this.getDb();
    const startTime = Date.now();

    try {
      // MongoDB has no session-level read-only equivalent to PostgreSQL's
      // `SET TRANSACTION READ ONLY`, so operation inspection is the enforcement
      // point here. Re-checked inside the adapter as well as in the API route so
      // the guarantee doesn't depend on every caller remembering to check.
      if (options?.readOnly && isWriteMongoQuery(query)) {
        throw new Error(
          'Write operations are not allowed in read-only mode',
        );
      }

      // Parse the query - expected format: db.collection.method(args)
      // or just a JSON query for find operations
      const parsed = parseMongoQuery(query);

      if (!parsed) {
        throw new Error(
          'Could not read that as a MongoDB statement. Expected something like db.users.find({}) — the collection name goes directly after db.',
        );
      }

      const { collectionName, operation, args } = parsed;
      const collection = db.collection(collectionName);

      let rows: Record<string, unknown>[] = [];
      let rowCount = 0;

      switch (operation) {
        case 'find': {
          const cursor = collection.find(args[0] || {});
          if (args[1]) {
            cursor.project(args[1]);
          }
          const docs = await cursor.limit(1000).toArray();
          rows = docs.map((doc) => this.serializeDocument(doc));
          rowCount = rows.length;
          break;
        }
        case 'findOne': {
          const doc = await collection.findOne(args[0] || {});
          if (doc) {
            rows = [this.serializeDocument(doc)];
            rowCount = 1;
          }
          break;
        }
        case 'count':
        case 'countDocuments': {
          const count = await collection.countDocuments(args[0] || {});
          rows = [{ count }];
          rowCount = 1;
          break;
        }
        case 'aggregate': {
          const pipeline = (args[0] as Document[]) || [];
          const docs = await collection.aggregate(pipeline).toArray();
          rows = docs.map((doc) => this.serializeDocument(doc));
          rowCount = rows.length;
          break;
        }
        case 'distinct': {
          const field = args[0] as string;
          const values = await collection.distinct(field, (args[1] as Document) || {});
          rows = values.map((v) => ({ value: v }));
          rowCount = rows.length;
          break;
        }
        default:
          throw new Error(`Unsupported operation: ${operation}`);
      }

      const executionTimeMs = Date.now() - startTime;
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

      return {
        rows,
        columns,
        rowCount,
        executionTimeMs,
      };
    } catch (error) {
      return {
        rows: [],
        columns: [],
        rowCount: 0,
        executionTimeMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Query execution failed',
      };
    }
  }


  async getTableStats(table: string): Promise<TableStats> {
    const db = this.getDb();
    const collection = db.collection(table);

    try {
      const [count, indexes] = await Promise.all([
        collection.estimatedDocumentCount(),
        collection.indexes(),
      ]);

      return {
        rowCount: count,
        sizeBytes: 0, // Size info not available without deprecated stats()
        indexCount: indexes.length,
      };
    } catch {
      const count = await collection.countDocuments();
      return {
        rowCount: count,
        sizeBytes: 0,
        indexCount: 0,
      };
    }
  }

  async getIndexInfo(table: string): Promise<IndexInfo[]> {
    const db = this.getDb();
    const collection = db.collection(table);

    const [indexes, sizes, scans] = await Promise.all([
      collection.indexes(),
      this.getIndexSizes(table),
      this.getIndexScans(table),
    ]);

    return indexes.map((index) => {
      const name = index.name || 'unknown';
      return {
        name,
        columns: Object.keys(index.key),
        isUnique: index.unique || false,
        isPrimary: name === '_id_',
        type: this.getIndexType(index),
        sizeBytes: sizes.get(name),
        scans: scans.get(name),
        // A partial index carries a filter; a sparse index is the older
        // equivalent, skipping documents that lack the field. Both cover a
        // subset of the collection, which is what the health analysis needs to
        // know before calling anything redundant.
        isPartial:
          index.partialFilterExpression !== undefined || index.sparse === true,
        definition: this.buildIndexDefinition(table, index),
      };
    });
  }

  private getIndexType(index: Document): string {
    const keyValues = Object.values(index.key);
    if (keyValues.includes('text')) return 'text';
    if (keyValues.includes('2d') || keyValues.includes('2dsphere')) return 'geo';
    if (keyValues.includes('hashed')) return 'hashed';
    return 'btree';
  }

  /**
   * Bytes per index, from `collStats`.
   *
   * Runs as a command rather than the driver's removed `stats()` helper. A view
   * or a missing collection makes this fail, which leaves sizes undefined rather
   * than zero — an index of unknown size must not render as an empty one.
   */
  private async getIndexSizes(table: string): Promise<Map<string, number>> {
    const sizes = new Map<string, number>();

    try {
      const stats = await this.getDb().command({ collStats: table });
      const indexSizes = stats.indexSizes as Record<string, number> | undefined;
      for (const [name, bytes] of Object.entries(indexSizes ?? {})) {
        if (Number.isFinite(bytes)) sizes.set(name, Number(bytes));
      }
    } catch {
      /* collStats unavailable (view, or a restricted role) */
    }

    return sizes;
  }

  /**
   * Operations served per index, from `$indexStats`.
   *
   * MongoDB's counterpart to PostgreSQL's `idx_scan`. The counter resets when
   * the server restarts, so a zero here means "not used since startup" rather
   * than "never used" — which is why the health analysis words its finding as a
   * prompt to check rather than a verdict.
   */
  private async getIndexScans(table: string): Promise<Map<string, number>> {
    const scans = new Map<string, number>();

    try {
      const results = await this.getDb()
        .collection(table)
        .aggregate([{ $indexStats: {} }])
        .toArray();

      for (const entry of results) {
        const ops = entry.accesses?.ops;
        if (ops !== undefined && Number.isFinite(Number(ops))) {
          scans.set(entry.name as string, Number(ops));
        }
      }
    } catch {
      /* $indexStats needs the indexStats privilege */
    }

    return scans;
  }

  /** A shell-style `createIndex` call describing the index, for display. */
  private buildIndexDefinition(table: string, index: Document): string {
    const keys = JSON.stringify(index.key);
    const options: Record<string, unknown> = {};
    if (index.unique) options.unique = true;
    if (index.sparse) options.sparse = true;
    if (index.partialFilterExpression) {
      options.partialFilterExpression = index.partialFilterExpression;
    }

    const optionText = Object.keys(options).length
      ? `, ${JSON.stringify(options)}`
      : '';

    return `db.${table}.createIndex(${keys}${optionText})`;
  }

  /**
   * Index directions and types this adapter will build.
   *
   * MongoDB takes the "method" per field as the key's *value* rather than as a
   * separate clause, so these are the permitted values, not access methods.
   */
  private static readonly INDEX_METHODS = [
    '1',
    '-1',
    'text',
    'hashed',
    '2d',
    '2dsphere',
  ] as const;

  async createIndex(
    table: string,
    options: CreateIndexOptions
  ): Promise<IndexInfo> {
    const collection = this.getDb().collection(table);

    if (options.columns.length === 0) {
      throw new Error('An index needs at least one field');
    }

    const method = (options.method ?? '1').toLowerCase();
    if (!(MongoDBAdapter.INDEX_METHODS as readonly string[]).includes(method)) {
      throw new Error(
        `Unsupported index type: ${options.method}. Expected one of ${MongoDBAdapter.INDEX_METHODS.join(', ')}.`
      );
    }

    // Ascending and descending are numbers; every other type is its own string.
    // IndexDirection covers both, so the key map needs no cast.
    let direction: IndexDirection;
    if (method === '1') {
      direction = 1;
    } else if (method === '-1') {
      direction = -1;
    } else {
      direction = method as IndexDirection;
    }

    const keys: Record<string, IndexDirection> = {};
    for (const column of options.columns) {
      keys[column] = direction;
    }

    // `where` is a partialFilterExpression, and MongoDB takes it as a document
    // rather than a string — so unlike the SQL adapters there is no statement to
    // smuggle anything into, but it still has to parse as an object.
    let partialFilterExpression: Document | undefined;
    if (options.where) {
      try {
        const parsed = JSON.parse(options.where);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('not an object');
        }
        partialFilterExpression = parsed as Document;
      } catch {
        throw new Error(
          'A MongoDB partial index filter must be a JSON object, for example {"status":"active"}'
        );
      }
    }

    await collection.createIndex(keys, {
      name: options.name,
      unique: options.unique ?? false,
      ...(partialFilterExpression ? { partialFilterExpression } : {}),
    });

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
    const collection = this.getDb().collection(table);

    if (indexName === '_id_') {
      throw new Error(
        'The _id index is required by MongoDB and cannot be dropped.'
      );
    }

    const exists = (await this.getIndexInfo(table)).some(
      (index) => index.name === indexName
    );
    if (!exists) return false;

    await collection.dropIndex(indexName);
    return true;
  }

  async getDatabaseStats(): Promise<{ totalSize: number; tableCount: number; version: string }> {
    const db = this.getDb();

    try {
      const collections = await db.listCollections().toArray();
      const admin = this.client?.db().admin();
      let version = 'MongoDB';

      if (admin) {
        try {
          const serverInfo = await admin.serverStatus();
          version = `MongoDB ${serverInfo.version}`;
        } catch {
          // Server status might not be available
        }
      }

      return {
        totalSize: 0, // Size info not easily available without deprecated APIs
        tableCount: collections.length,
        version,
      };
    } catch {
      const collections = await db.listCollections().toArray();
      return {
        totalSize: 0,
        tableCount: collections.length,
        version: 'MongoDB',
      };
    }
  }
}
