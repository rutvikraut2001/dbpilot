import { NextRequest, NextResponse } from 'next/server';
import { getCachedAdapter } from '@/lib/adapters/factory';

// Get schema for a specific table/collection
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');
    const tableName = searchParams.get('table');

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
      const schema = await adapter.getTableSchema(tableName);
      const stats = await adapter.getTableStats(tableName);
      const indexes = await adapter.getIndexInfo(tableName);

      return NextResponse.json({ schema, stats, indexes });
    }

    // Otherwise get relationships (for ER diagram)
    const relationships = await adapter.getRelationships();
    const dbStats = await adapter.getDatabaseStats();

    return NextResponse.json({ relationships, dbStats });
  } catch (error) {
    console.error('Get schema error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get schema' },
      { status: 500 }
    );
  }
}
