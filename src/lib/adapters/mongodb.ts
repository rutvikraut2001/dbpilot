import { MongoClient, Db, ObjectId, Document } from 'mongodb';
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
} from './types';

export class MongoDBAdapter extends BaseAdapter {
  private client: MongoClient | null = null;
  private db: Db | null = null;

  async connect(): Promise<void> {
    try {
      this.client = new MongoClient(this.connectionString);
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
    const { page, pageSize, sortBy, sortOrder, filters } = options;

    const skip = (page - 1) * pageSize;
    const query = filters || {};

    // Build sort object
    const sort: Record<string, 1 | -1> = {};
    if (sortBy) {
      sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
    }

    const [data, total] = await Promise.all([
      collection.find(query).sort(sort).skip(skip).limit(pageSize).toArray(),
      collection.countDocuments(query),
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

  async executeQuery(query: string): Promise<QueryResult> {
    const db = this.getDb();
    const startTime = Date.now();

    try {
      // Parse the query - expected format: db.collection.method(args)
      // or just a JSON query for find operations
      const parsed = this.parseMongoQuery(query);

      if (!parsed) {
        throw new Error('Invalid query format. Use: db.collectionName.find({}) or similar');
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

  private parseMongoQuery(query: string): { collectionName: string; operation: string; args: unknown[] } | null {
    // Match pattern: db.collectionName.operation({...})
    const match = query.match(/^db\.(\w+)\.(\w+)\(([\s\S]*)\)$/);

    if (!match) {
      return null;
    }

    const [, collectionName, operation, argsString] = match;

    try {
      // Parse arguments - they should be valid JSON objects/arrays
      const args = argsString.trim() ? this.parseArgs(argsString) : [];
      return { collectionName, operation, args };
    } catch {
      return null;
    }
  }

  private parseArgs(argsString: string): unknown[] {
    // Simple parsing - split by commas that aren't inside brackets
    const args: unknown[] = [];
    let depth = 0;
    let current = '';

    for (const char of argsString) {
      if (char === '{' || char === '[') depth++;
      if (char === '}' || char === ']') depth--;

      if (char === ',' && depth === 0) {
        if (current.trim()) {
          args.push(JSON.parse(current.trim()));
        }
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      args.push(JSON.parse(current.trim()));
    }

    return args;
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

    const indexes = await collection.indexes();

    return indexes.map((index) => ({
      name: index.name || 'unknown',
      columns: Object.keys(index.key),
      isUnique: index.unique || false,
      isPrimary: index.name === '_id_',
      type: this.getIndexType(index),
    }));
  }

  private getIndexType(index: Document): string {
    const keyValues = Object.values(index.key);
    if (keyValues.includes('text')) return 'text';
    if (keyValues.includes('2d') || keyValues.includes('2dsphere')) return 'geo';
    if (keyValues.includes('hashed')) return 'hashed';
    return 'btree';
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
