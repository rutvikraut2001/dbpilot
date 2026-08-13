import { NextRequest, NextResponse } from "next/server";
import { getCachedAdapter } from "@/lib/adapters/factory";
import { QueryOptions } from "@/lib/adapters/types";
import { isReadOnlyMode } from "@/lib/server-state";
import { audit } from "@/lib/audit";
import {
  schemaCache,
  cacheKey,
  CACHE_TTL,
  filtersCacheKey,
} from "@/lib/cache";
import {
  sanitizeError,
  TableNameSchema,
  ConnectionIdSchema,
} from "@/lib/validation";

// Rows per page the API will serve. Raised from 100 now that the grid
// virtualizes: rendering cost no longer scales with page size, so fewer, larger
// pages mean fewer round trips while browsing.
const MAX_PAGE_SIZE = 500;

/**
 * Drop cached row counts for a table after it is written to, so the pagination
 * footer doesn't keep reporting a stale total.
 */
function invalidateRowCount(connectionId: string, table: string): void {
  schemaCache.deleteByPrefix(cacheKey.rowCountPrefix(connectionId, table));
}

// Get paginated data from a table
export async function GET(request: NextRequest) {
  let connectionId: string | null = null;
  let tableName: string | null = null;

  try {
    const { searchParams } = new URL(request.url);
    connectionId = searchParams.get("connectionId");
    tableName = searchParams.get("table");
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("pageSize") || "50");
    const sortBy = searchParams.get("sortBy") || undefined;
    const sortOrder =
      (searchParams.get("sortOrder") as "asc" | "desc") || undefined;
    const filtersJson = searchParams.get("filters");

    // Validate required parameters
    const connectionIdResult = ConnectionIdSchema.safeParse(connectionId);
    const tableResult = TableNameSchema.safeParse(tableName);

    if (!connectionIdResult.success || !tableResult.success) {
      return NextResponse.json(
        { error: "Missing or invalid required parameters: connectionId and table" },
        { status: 400 }
      );
    }

    const adapter = getCachedAdapter(connectionId!);

    if (!adapter) {
      return NextResponse.json(
        { error: "Connection not found. Please reconnect." },
        { status: 404 }
      );
    }

    if (!adapter.isConnected()) {
      await adapter.connect();
    }

    // Parse filters safely
    let filters: Record<string, unknown> | undefined;
    if (filtersJson) {
      try {
        filters = JSON.parse(filtersJson);
      } catch {
        return NextResponse.json(
          { error: "Invalid filters format" },
          { status: 400 }
        );
      }
    }

    const effectivePageSize = Math.min(pageSize, MAX_PAGE_SIZE);

    // COUNT(*) scans where the page fetch does not, and on a large table it
    // dominates the cost of paging. The total only changes when the data does,
    // so cache it per (connection, table, filters) and let subsequent pages skip
    // the count entirely. Writes to the table invalidate it.
    const countKey = cacheKey.rowCount(
      connectionId!,
      tableName!,
      filtersCacheKey(filters)
    );
    const cachedTotal = schemaCache.get<number>(countKey);

    const options: QueryOptions = {
      page,
      pageSize: effectivePageSize,
      sortBy,
      sortOrder,
      filters,
      includeTotal: cachedTotal === undefined,
    };

    const result = await adapter.getRows(tableName!, options);

    let total: number;
    if (cachedTotal === undefined) {
      total = result.total;
      schemaCache.set(countKey, total, CACHE_TTL.ROW_COUNT);
    } else {
      total = cachedTotal;
    }

    audit("data.read", {
      connectionId: connectionId!,
      details: { table: tableName, page, pageSize: effectivePageSize },
      success: true,
    });

    return NextResponse.json({
      ...result,
      total,
      totalPages: Math.ceil(total / effectivePageSize),
    });
  } catch (error) {
    console.error("Get data error:", error);

    audit("data.read", {
      connectionId: connectionId ?? undefined,
      details: { table: tableName },
      success: false,
      error: sanitizeError(error),
    });

    return NextResponse.json(
      { error: sanitizeError(error) },
      { status: 500 }
    );
  }
}

// Insert a new row
export async function POST(request: NextRequest) {
  let connectionId: string | undefined;
  let table: string | undefined;

  try {
    const body = await request.json();
    connectionId = body.connectionId;
    table = body.table;
    const data = body.data;

    // Validate required fields
    const connectionIdResult = ConnectionIdSchema.safeParse(connectionId);
    const tableResult = TableNameSchema.safeParse(table);

    if (!connectionIdResult.success || !tableResult.success || !data) {
      return NextResponse.json(
        { error: "Missing or invalid required fields: connectionId, table, and data" },
        { status: 400 }
      );
    }

    // SERVER-SIDE read-only check - cannot be bypassed by client
    if (isReadOnlyMode(connectionId!)) {
      audit("data.insert", {
        connectionId,
        details: { table },
        success: false,
        error: "Read-only mode",
      });

      return NextResponse.json(
        { error: "Cannot insert data in read-only mode" },
        { status: 403 }
      );
    }

    const adapter = getCachedAdapter(connectionId!);

    if (!adapter) {
      return NextResponse.json(
        { error: "Connection not found. Please reconnect." },
        { status: 404 }
      );
    }

    if (!adapter.isConnected()) {
      await adapter.connect();
    }

    const result = await adapter.insertRow(table!, data);

    invalidateRowCount(connectionId!, table!);

    audit("data.insert", {
      connectionId,
      details: { table },
      success: true,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("Insert error:", error);

    audit("data.insert", {
      connectionId,
      details: { table },
      success: false,
      error: sanitizeError(error),
    });

    return NextResponse.json(
      { error: sanitizeError(error) },
      { status: 500 }
    );
  }
}

// Update an existing row
export async function PUT(request: NextRequest) {
  let connectionId: string | undefined;
  let table: string | undefined;

  try {
    const body = await request.json();
    connectionId = body.connectionId;
    table = body.table;
    const primaryKey = body.primaryKey;
    const data = body.data;

    // Validate required fields
    const connectionIdResult = ConnectionIdSchema.safeParse(connectionId);
    const tableResult = TableNameSchema.safeParse(table);

    if (
      !connectionIdResult.success ||
      !tableResult.success ||
      !primaryKey ||
      !data
    ) {
      return NextResponse.json(
        {
          error:
            "Missing or invalid required fields: connectionId, table, primaryKey, and data",
        },
        { status: 400 }
      );
    }

    // SERVER-SIDE read-only check - cannot be bypassed by client
    if (isReadOnlyMode(connectionId!)) {
      audit("data.update", {
        connectionId,
        details: { table },
        success: false,
        error: "Read-only mode",
      });

      return NextResponse.json(
        { error: "Cannot update data in read-only mode" },
        { status: 403 }
      );
    }

    const adapter = getCachedAdapter(connectionId!);

    if (!adapter) {
      return NextResponse.json(
        { error: "Connection not found. Please reconnect." },
        { status: 404 }
      );
    }

    if (!adapter.isConnected()) {
      await adapter.connect();
    }

    // Filter out primary key columns from the data to update (don't update PK)
    const pkColumns = new Set(Object.keys(primaryKey));
    const updateData: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      if (!pkColumns.has(key)) {
        updateData[key] = value;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        {
          error: "No fields to update (only primary key fields were provided)",
        },
        { status: 400 }
      );
    }

    const result = await adapter.updateRow(table!, primaryKey, updateData);

    invalidateRowCount(connectionId!, table!);

    audit("data.update", {
      connectionId,
      details: { table },
      success: true,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("Update error:", error);

    audit("data.update", {
      connectionId,
      details: { table },
      success: false,
      error: sanitizeError(error),
    });

    return NextResponse.json(
      { error: sanitizeError(error) },
      { status: 500 }
    );
  }
}

// Delete a row
export async function DELETE(request: NextRequest) {
  let connectionId: string | null = null;
  let table: string | null = null;

  try {
    const { searchParams } = new URL(request.url);
    connectionId = searchParams.get("connectionId");
    table = searchParams.get("table");
    const primaryKeyJson = searchParams.get("primaryKey");

    // Validate required parameters
    const connectionIdResult = ConnectionIdSchema.safeParse(connectionId);
    const tableResult = TableNameSchema.safeParse(table);

    if (!connectionIdResult.success || !tableResult.success || !primaryKeyJson) {
      return NextResponse.json(
        {
          error:
            "Missing or invalid required parameters: connectionId, table, and primaryKey",
        },
        { status: 400 }
      );
    }

    // SERVER-SIDE read-only check - cannot be bypassed by client
    if (isReadOnlyMode(connectionId!)) {
      audit("data.delete", {
        connectionId: connectionId!,
        details: { table },
        success: false,
        error: "Read-only mode",
      });

      return NextResponse.json(
        { error: "Cannot delete data in read-only mode" },
        { status: 403 }
      );
    }

    const adapter = getCachedAdapter(connectionId!);

    if (!adapter) {
      return NextResponse.json(
        { error: "Connection not found. Please reconnect." },
        { status: 404 }
      );
    }

    if (!adapter.isConnected()) {
      await adapter.connect();
    }

    let primaryKey: Record<string, unknown>;
    try {
      primaryKey = JSON.parse(primaryKeyJson);
    } catch {
      return NextResponse.json(
        { error: "Invalid primaryKey format" },
        { status: 400 }
      );
    }

    const success = await adapter.deleteRow(table!, primaryKey);

    invalidateRowCount(connectionId!, table!);

    audit("data.delete", {
      connectionId: connectionId!,
      details: { table },
      success: true,
    });

    return NextResponse.json({ success });
  } catch (error) {
    console.error("Delete error:", error);

    audit("data.delete", {
      connectionId: connectionId ?? undefined,
      details: { table },
      success: false,
      error: sanitizeError(error),
    });

    return NextResponse.json(
      { error: sanitizeError(error) },
      { status: 500 }
    );
  }
}
