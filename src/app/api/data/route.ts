import { NextRequest, NextResponse } from 'next/server';
import { getCachedAdapter } from '@/lib/adapters/factory';
import { QueryOptions } from '@/lib/adapters/types';

// Get paginated data from a table
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');
    const tableName = searchParams.get('table');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '50');
    const sortBy = searchParams.get('sortBy') || undefined;
    const sortOrder = (searchParams.get('sortOrder') as 'asc' | 'desc') || undefined;
    const filtersJson = searchParams.get('filters');

    if (!connectionId || !tableName) {
      return NextResponse.json(
        { error: 'Missing required parameters: connectionId and table' },
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

    const options: QueryOptions = {
      page,
      pageSize: Math.min(pageSize, 100), // Max 100 rows per page
      sortBy,
      sortOrder,
      filters: filtersJson ? JSON.parse(filtersJson) : undefined,
    };

    const result = await adapter.getRows(tableName, options);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Get data error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get data' },
      { status: 500 }
    );
  }
}

// Insert a new row
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { connectionId, table, data, readOnly } = body;

    if (readOnly) {
      return NextResponse.json(
        { error: 'Cannot insert data in read-only mode' },
        { status: 403 }
      );
    }

    if (!connectionId || !table || !data) {
      return NextResponse.json(
        { error: 'Missing required fields: connectionId, table, and data' },
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

    const result = await adapter.insertRow(table, data);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('Insert error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to insert row' },
      { status: 500 }
    );
  }
}

// Update an existing row
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { connectionId, table, primaryKey, data, readOnly } = body;

    if (readOnly) {
      return NextResponse.json(
        { error: 'Cannot update data in read-only mode' },
        { status: 403 }
      );
    }

    if (!connectionId || !table || !primaryKey || !data) {
      return NextResponse.json(
        { error: 'Missing required fields: connectionId, table, primaryKey, and data' },
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

    const result = await adapter.updateRow(table, primaryKey, data);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('Update error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update row' },
      { status: 500 }
    );
  }
}

// Delete a row
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');
    const table = searchParams.get('table');
    const primaryKeyJson = searchParams.get('primaryKey');
    const readOnly = searchParams.get('readOnly') === 'true';

    if (readOnly) {
      return NextResponse.json(
        { error: 'Cannot delete data in read-only mode' },
        { status: 403 }
      );
    }

    if (!connectionId || !table || !primaryKeyJson) {
      return NextResponse.json(
        { error: 'Missing required parameters: connectionId, table, and primaryKey' },
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

    const primaryKey = JSON.parse(primaryKeyJson);
    const success = await adapter.deleteRow(table, primaryKey);

    return NextResponse.json({ success });
  } catch (error) {
    console.error('Delete error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete row' },
      { status: 500 }
    );
  }
}
