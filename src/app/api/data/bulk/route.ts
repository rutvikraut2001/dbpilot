import { NextRequest, NextResponse } from "next/server";
import { getCachedAdapter } from "@/lib/adapters/factory";
import { isReadOnlyMode } from "@/lib/server-state";
import { audit } from "@/lib/audit";
import { schemaCache, cacheKey } from "@/lib/cache";
import {
  sanitizeError,
  TableNameSchema,
  ConnectionIdSchema,
} from "@/lib/validation";
import { z } from "zod";

/**
 * Bulk delete.
 *
 * The data grid previously issued one DELETE request per selected row, awaited
 * serially — 100 selected rows meant 100 sequential round trips, each acquiring
 * a connection of its own. This collapses that to a single request, and for
 * adapters that override `deleteRows` (PostgreSQL) a single statement.
 */
const MAX_BULK_DELETE = 1000;

const BulkDeleteSchema = z.object({
  connectionId: ConnectionIdSchema,
  table: TableNameSchema,
  primaryKeys: z
    .array(z.record(z.string(), z.unknown()))
    .min(1, "At least one primary key is required")
    .max(MAX_BULK_DELETE, `At most ${MAX_BULK_DELETE} rows can be deleted at once`),
});

export async function POST(request: NextRequest) {
  let connectionId: string | undefined;
  let table: string | undefined;

  try {
    const body = await request.json();
    const parsed = BulkDeleteSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }

    ({ connectionId, table } = parsed.data);
    const { primaryKeys } = parsed.data;

    // SERVER-SIDE read-only check - cannot be bypassed by client
    if (isReadOnlyMode(connectionId)) {
      audit("data.delete", {
        connectionId,
        details: { table, rows: primaryKeys.length, bulk: true },
        success: false,
        error: "Read-only mode",
      });

      return NextResponse.json(
        { error: "Cannot delete data in read-only mode" },
        { status: 403 }
      );
    }

    const adapter = getCachedAdapter(connectionId);

    if (!adapter) {
      return NextResponse.json(
        { error: "Connection not found. Please reconnect." },
        { status: 404 }
      );
    }

    if (!adapter.isConnected()) {
      await adapter.connect();
    }

    const result = await adapter.deleteRows(table, primaryKeys);

    schemaCache.deleteByPrefix(cacheKey.rowCountPrefix(connectionId, table));

    audit("data.delete", {
      connectionId,
      details: {
        table,
        bulk: true,
        requested: primaryKeys.length,
        deleted: result.deleted,
        failed: result.failed,
      },
      success: result.failed === 0,
      error: result.error,
    });

    return NextResponse.json({
      success: result.failed === 0,
      deleted: result.deleted,
      failed: result.failed,
      error: result.error ? sanitizeError(new Error(result.error)) : undefined,
    });
  } catch (error) {
    console.error("Bulk delete error:", error);

    audit("data.delete", {
      connectionId,
      details: { table, bulk: true },
      success: false,
      error: sanitizeError(error),
    });

    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
