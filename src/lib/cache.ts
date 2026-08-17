import "server-only";

/**
 * Simple in-memory cache with TTL for production use.
 * Used to cache schema metadata that doesn't change frequently.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class MemoryCache {
  private cache = new Map<string, CacheEntry<unknown>>();

  constructor() {
    // Cleanup expired entries every 60 seconds
    setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Get a cached value if it exists and hasn't expired.
   */
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.data as T;
  }

  /**
   * Set a value in the cache with a TTL in milliseconds.
   */
  set<T>(key: string, data: T, ttlMs: number): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Delete a specific key from the cache.
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Delete all keys matching a prefix.
   */
  deleteByPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cached data for a connection.
   */
  clearConnection(connectionId: string): void {
    this.deleteByPrefix(`${connectionId}:`);
  }

  /**
   * Clear all cached data.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Remove expired entries.
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics.
   */
  stats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

// Persist cache on globalThis so it survives HMR recompilation in dev mode.
const globalForCache = globalThis as unknown as { __schemaCache?: MemoryCache };
export const schemaCache = (globalForCache.__schemaCache ??= new MemoryCache());

// Cache TTL constants (in milliseconds)
export const CACHE_TTL = {
  TABLES: 60 * 1000, // 1 minute for table list
  SCHEMA: 5 * 60 * 1000, // 5 minutes for table schema
  RELATIONSHIPS: 5 * 60 * 1000, // 5 minutes for relationships
  STATS: 30 * 1000, // 30 seconds for stats
  // Row counts back the pagination footer. Short-lived because a stale total
  // only mis-renders the page count, and writes invalidate it explicitly.
  ROW_COUNT: 30 * 1000,
} as const;

/**
 * Stable key for a filter object — same filters must produce the same string
 * regardless of property order, or the count cache would miss on every request.
 */
export function filtersCacheKey(filters?: Record<string, unknown>): string {
  if (!filters) return "";
  const keys = Object.keys(filters).sort();
  if (keys.length === 0) return "";
  return JSON.stringify(keys.map((key) => [key, filters[key]]));
}

// Cache key generators
export const cacheKey = {
  tables: (connectionId: string) => `${connectionId}:tables`,
  schema: (connectionId: string, table: string) =>
    `${connectionId}:schema:${table}`,
  relationships: (connectionId: string) => `${connectionId}:relationships`,
  stats: (connectionId: string, table: string) =>
    `${connectionId}:stats:${table}`,
  dbStats: (connectionId: string) => `${connectionId}:dbStats`,
  rowCount: (connectionId: string, table: string, filters: string) =>
    `${connectionId}:rowCount:${table}:${filters}`,
  /** Prefix covering every cached count for a table, for invalidation. */
  rowCountPrefix: (connectionId: string, table: string) =>
    `${connectionId}:rowCount:${table}:`,
};
