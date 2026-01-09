import { NextRequest, NextResponse } from 'next/server';
import { getCachedAdapter } from '@/lib/adapters/factory';

// Get all tables/collections for a connection
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');

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

    const tables = await adapter.getTables();

    return NextResponse.json({ tables });
  } catch (error) {
    console.error('Get tables error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get tables' },
      { status: 500 }
    );
  }
}
