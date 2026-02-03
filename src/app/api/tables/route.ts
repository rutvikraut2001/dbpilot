import { NextRequest, NextResponse } from 'next/server';
import { getCachedAdapter } from '@/lib/adapters/factory';
import { schemaCache, CACHE_TTL, cacheKey } from '@/lib/cache';
import { TableInfo } from '@/lib/adapters/types';

// Get all tables/collections for a connection
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');
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

    // Check cache first (unless noCache is requested)
    const tablesCacheKey = cacheKey.tables(connectionId);
    if (!noCache) {
      const cached = schemaCache.get<TableInfo[]>(tablesCacheKey);
      if (cached) {
        return NextResponse.json({ tables: cached });
      }
    }

    const tables = await adapter.getTables();

    // Cache the result
    schemaCache.set(tablesCacheKey, tables, CACHE_TTL.TABLES);

    return NextResponse.json({ tables });
  } catch (error) {
    console.error('Get tables error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get tables' },
      { status: 500 }
    );
  }
}
