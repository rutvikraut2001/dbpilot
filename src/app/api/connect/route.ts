import { NextRequest, NextResponse } from 'next/server';
import { createAdapter, getOrCreateAdapter, removeAdapter } from '@/lib/adapters/factory';
import { DatabaseType } from '@/lib/adapters/types';

// Test a database connection
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, connectionString, connectionId } = body as {
      type: DatabaseType;
      connectionString: string;
      connectionId?: string;
    };

    if (!type || !connectionString) {
      return NextResponse.json(
        { error: 'Missing required fields: type and connectionString' },
        { status: 400 }
      );
    }

    // Create a temporary adapter to test connection
    const adapter = createAdapter(type, connectionString);
    const result = await adapter.testConnection();

    // If test successful and connectionId provided, cache the adapter
    if (result.success && connectionId) {
      const cachedAdapter = getOrCreateAdapter(connectionId, type, connectionString);
      await cachedAdapter.connect();
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Connection error:', error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Connection failed',
      },
      { status: 500 }
    );
  }
}

// Disconnect from a database
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');

    if (!connectionId) {
      return NextResponse.json(
        { error: 'Missing connectionId parameter' },
        { status: 400 }
      );
    }

    await removeAdapter(connectionId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Disconnect error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Disconnect failed' },
      { status: 500 }
    );
  }
}
