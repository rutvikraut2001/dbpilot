import { NextRequest, NextResponse } from 'next/server';
import { getCachedAdapter } from '@/lib/adapters/factory';

// Execute a query
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { connectionId, query, readOnly } = body;

    if (!connectionId || !query) {
      return NextResponse.json(
        { error: 'Missing required fields: connectionId and query' },
        { status: 400 }
      );
    }

    // In read-only mode, only allow SELECT/find queries
    if (readOnly) {
      const normalizedQuery = query.trim().toUpperCase();

      // Check for PostgreSQL write operations
      const writeKeywords = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE', 'GRANT', 'REVOKE'];
      const isWriteQuery = writeKeywords.some((keyword) =>
        normalizedQuery.startsWith(keyword)
      );

      // Check for MongoDB write operations
      const mongoWriteOps = ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'drop', 'createIndex', 'dropIndex'];
      const isMongoWrite = mongoWriteOps.some((op) =>
        query.includes(`.${op}(`)
      );

      if (isWriteQuery || isMongoWrite) {
        return NextResponse.json(
          { error: 'Write operations are not allowed in read-only mode' },
          { status: 403 }
        );
      }
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

    const result = await adapter.executeQuery(query);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Query execution error:', error);
    return NextResponse.json(
      {
        rows: [],
        columns: [],
        rowCount: 0,
        executionTimeMs: 0,
        error: error instanceof Error ? error.message : 'Query execution failed',
      },
      { status: 500 }
    );
  }
}
