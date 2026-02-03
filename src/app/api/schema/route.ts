import { NextRequest, NextResponse } from 'next/server';
import { getCachedAdapter } from '@/lib/adapters/factory';
import { schemaCache, CACHE_TTL, cacheKey } from '@/lib/cache';

// Get schema for a specific table/collection
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');
    const tableName = searchParams.get('table');
    const noCache = searchParams.get('noCache') === 'true';

    if (!connectionId) {
      return NextResponse.json(
        { error: 'Missing connectionId parameter' },
        { status: 400 }
      );
    }

    const adapter = getCachedAdapter(connectionId);

    if (!adapter) {
      return NextResponse.json(
        { error: 'Connection not found. Please reconnect.' },
        { status: 404 }
      );
    }

    if (!adapter.isConnected()) {
      await adapter.connect();
    }

    // If table specified, get that table's schema
    if (tableName) {
      // Check cache first (unless noCache is requested)
      const schemaCacheKey = cacheKey.schema(connectionId, tableName);
      if (!noCache) {
        const cached = schemaCache.get<{
          schema: unknown;
          stats: unknown;
          indexes: unknown;
        }>(schemaCacheKey);
        if (cached) {
          return NextResponse.json(cached);
        }
      }

      const [schema, stats, indexes] = await Promise.all([
        adapter.getTableSchema(tableName),
        adapter.getTableStats(tableName),
        adapter.getIndexInfo(tableName),
      ]);

      const result = { schema, stats, indexes };
      schemaCache.set(schemaCacheKey, result, CACHE_TTL.SCHEMA);

      return NextResponse.json(result);
    }

    // Otherwise get relationships (for ER diagram)
    const relationshipsCacheKey = cacheKey.relationships(connectionId);
    if (!noCache) {
      const cached = schemaCache.get<{
        relationships: unknown;
        dbStats: unknown;
      }>(relationshipsCacheKey);
      if (cached) {
        return NextResponse.json(cached);
      }
    }

    const [relationships, dbStats] = await Promise.all([
      adapter.getRelationships(),
      adapter.getDatabaseStats(),
    ]);

    const result = { relationships, dbStats };
    schemaCache.set(relationshipsCacheKey, result, CACHE_TTL.RELATIONSHIPS);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Get schema error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get schema' },
      { status: 500 }
    );
  }
}
