import { NextRequest, NextResponse } from "next/server";
import { getCachedAdapter } from "@/lib/adapters/factory";
import { isReadOnlyMode } from "@/lib/server-state";
import { audit } from "@/lib/audit";
import { schemaCache, cacheKey } from "@/lib/cache";
import { analyzeIndexHealth } from "@/lib/index-health";
import {
  ConnectionIdSchema,
  CreateIndexSchema,
  IndexNameSchema,
  TableNameSchema,
  sanitizeError,
} from "@/lib/validation";
import type { DatabaseAdapter } from "@/lib/adapters/types";

/**
 * Index management.
 *
 * Listing is available for every adapter — `getIndexInfo` returns an empty list
 * where the concept does not apply. Creating and dropping are gated twice: on
 * read-only mode, exactly like every other write endpoint, and on the adapter
 * declaring `supportsIndexManagement`, so an engine that cannot add an index
 * after the fact returns a reason rather than a driver error.
 */

/**
 * Drop the cached schema payload for a table.
 *
 * The schema cache holds `{ schema, stats, indexes }` under one key, and
 * `stats.indexCount` moves with the index list, so both entries go. Without
 * this the panel would show the index it just created as absent for up to the
 * five-minute schema TTL.
 */
function invalidateIndexCaches(connectionId: string, table: string): void {
  schemaCache.delete(cacheKey.schema(connectionId, table));
  schemaCache.delete(cacheKey.stats(connectionId, table));
}

function supportsIndexManagement(adapter: DatabaseAdapter): boolean {
  // Both halves matter: the capability flag is what the UI reads, and the
  // method's presence is what actually gets called.
  return (
    adapter.capabilities?.supportsIndexManagement !== false &&
    typeof adapter.createIndex === "function" &&
    typeof adapter.dropIndex === "function"
  );
}

/**
 * Resolve the adapter for a request, connecting it if the session dropped.
 * Returns a response instead when the connection is unusable.
 */
async function resolveAdapter(
  connectionId: string
): Promise<{ adapter: DatabaseAdapter } | { error: NextResponse }> {
  const adapter = getCachedAdapter(connectionId);

  if (!adapter) {
    return {
      error: NextResponse.json(
        { error: "Connection not found. Please reconnect." },
        { status: 404 }
      ),
    };
  }

  if (!adapter.isConnected()) {
    await adapter.connect();
  }

  return { adapter };
}

// List a table's indexes, with health findings.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get("connectionId");
    const table = searchParams.get("table");

    const connectionIdResult = ConnectionIdSchema.safeParse(connectionId);
    const tableResult = TableNameSchema.safeParse(table);

    if (!connectionIdResult.success || !tableResult.success) {
      return NextResponse.json(
        { error: "Missing or invalid parameters: connectionId and table" },
        { status: 400 }
      );
    }

    const resolved = await resolveAdapter(connectionIdResult.data);
    if ("error" in resolved) return resolved.error;
    const { adapter } = resolved;

    const indexes = await adapter.getIndexInfo(tableResult.data);

    // The size rule needs the table's own size to compare against. A failure
    // here must not cost the whole listing, so the analysis simply runs without
    // it and reports the rules that need no table context.
    let tableSizeBytes: number | undefined;
    try {
      tableSizeBytes = (await adapter.getTableStats(tableResult.data)).sizeBytes;
    } catch {
      tableSizeBytes = undefined;
    }

    return NextResponse.json({
      indexes,
      issues: analyzeIndexHealth(indexes, { tableSizeBytes }),
      canManage: supportsIndexManagement(adapter),
    });
  } catch (error) {
    console.error("Get indexes error:", error);
    return NextResponse.json(
      { error: sanitizeError(error) },
      { status: 500 }
    );
  }
}

// Create an index.
export async function POST(request: NextRequest) {
  let connectionId: string | undefined;
  let indexName: string | undefined;

  try {
    const body = await request.json();
    const parsed = CreateIndexSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }

    const { table, name, columns, unique, method, where, concurrent } =
      parsed.data;
    connectionId = parsed.data.connectionId;
    indexName = name;

    // SERVER-SIDE read-only check — cannot be bypassed by the client. An index
    // build rewrites table storage and takes locks; it is a write.
    if (isReadOnlyMode(connectionId)) {
      audit("index.create", {
        connectionId,
        details: { table, index: name },
        success: false,
        error: "Read-only mode",
      });

      return NextResponse.json(
        { error: "Cannot create an index in read-only mode" },
        { status: 403 }
      );
    }

    const resolved = await resolveAdapter(connectionId);
    if ("error" in resolved) return resolved.error;
    const { adapter } = resolved;

    if (!supportsIndexManagement(adapter)) {
      return NextResponse.json(
        {
          error:
            "This database does not support creating indexes through DBPilot.",
        },
        { status: 400 }
      );
    }

    const created = await adapter.createIndex!(table, {
      name,
      columns,
      unique,
      method,
      where,
      concurrent,
    });

    invalidateIndexCaches(connectionId, table);

    audit("index.create", {
      connectionId,
      details: { table, index: name, columns, unique, method },
      success: true,
    });

    return NextResponse.json({ success: true, index: created });
  } catch (error) {
    console.error("Create index error:", error);

    audit("index.create", {
      connectionId,
      details: { index: indexName },
      success: false,
      error: sanitizeError(error),
    });

    // The engine's own complaint — a duplicate name, a column that does not
    // exist, a unique index on non-unique data — is the useful message here, so
    // it is surfaced as a 400 rather than flattened into a 500.
    return NextResponse.json(
      { error: sanitizeError(error) },
      { status: 400 }
    );
  }
}

// Drop an index.
export async function DELETE(request: NextRequest) {
  let connectionId: string | null = null;
  let name: string | null = null;

  try {
    const { searchParams } = new URL(request.url);
    connectionId = searchParams.get("connectionId");
    const table = searchParams.get("table");
    name = searchParams.get("name");

    const connectionIdResult = ConnectionIdSchema.safeParse(connectionId);
    const tableResult = TableNameSchema.safeParse(table);
    const nameResult = IndexNameSchema.safeParse(name);

    if (!connectionIdResult.success || !tableResult.success || !nameResult.success) {
      return NextResponse.json(
        {
          error:
            "Missing or invalid parameters: connectionId, table and name",
        },
        { status: 400 }
      );
    }

    if (isReadOnlyMode(connectionIdResult.data)) {
      audit("index.drop", {
        connectionId: connectionIdResult.data,
        details: { table: tableResult.data, index: nameResult.data },
        success: false,
        error: "Read-only mode",
      });

      return NextResponse.json(
        { error: "Cannot drop an index in read-only mode" },
        { status: 403 }
      );
    }

    const resolved = await resolveAdapter(connectionIdResult.data);
    if ("error" in resolved) return resolved.error;
    const { adapter } = resolved;

    if (!supportsIndexManagement(adapter)) {
      return NextResponse.json(
        {
          error:
            "This database does not support dropping indexes through DBPilot.",
        },
        { status: 400 }
      );
    }

    const dropped = await adapter.dropIndex!(
      tableResult.data,
      nameResult.data
    );

    if (!dropped) {
      // Nothing was removed, so nothing is stale — but reporting success would
      // make the panel hide an index that is still there.
      return NextResponse.json(
        { error: `No index named ${nameResult.data} on ${tableResult.data}` },
        { status: 404 }
      );
    }

    invalidateIndexCaches(connectionIdResult.data, tableResult.data);

    audit("index.drop", {
      connectionId: connectionIdResult.data,
      details: { table: tableResult.data, index: nameResult.data },
      success: true,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Drop index error:", error);

    audit("index.drop", {
      connectionId: connectionId ?? undefined,
      details: { index: name ?? undefined },
      success: false,
      error: sanitizeError(error),
    });

    return NextResponse.json(
      { error: sanitizeError(error) },
      { status: 400 }
    );
  }
}
