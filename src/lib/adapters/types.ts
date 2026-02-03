// Database Adapter Types - Unified interface for all database types

export type DatabaseType = 'postgresql' | 'mongodb' | 'clickhouse';

export interface AdapterCapabilities {
  supportsUpdate: boolean;
  supportsDelete: boolean;
  supportsTransactions: boolean;
}

export interface ConnectionConfig {
  type: DatabaseType;
  connectionString: string;
  name: string;
  id: string;
}

export interface TableInfo {
  name: string;
  type: 'table' | 'collection' | 'view';
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

  // Query execution
  executeQuery(query: string): Promise<QueryResult>;

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
  abstract executeQuery(query: string): Promise<QueryResult>;
  abstract getTableStats(table: string): Promise<TableStats>;
  abstract getIndexInfo(table: string): Promise<IndexInfo[]>;
  abstract getDatabaseStats(): Promise<{ totalSize: number; tableCount: number; version: string }>;
}
