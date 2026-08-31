import { NextRequest, NextResponse } from "next/server";
import { getCachedAdapter } from "@/lib/adapters/factory";
import { isReadOnlyMode } from "@/lib/server-state";
import { audit } from "@/lib/audit";
import { schemaCache, cacheKey } from "@/lib/cache";
import { AlterTableSchema, sanitizeError } from "@/lib/validation";
import type { DatabaseAdapter, SchemaChange } from "@/lib/adapters/types";

/**
 * Structural changes to a table's columns.
 *
 * Two steps on purpose. POST renders the statements without running them, so the
 * user confirms SQL they can read rather than a description of it — for a change
 * that rewrites a table or discards a column, that difference is the whole point.
 * PUT applies them, gated on read-only like every other write.
 */

/** Changes that destroy data or break callers, and so need a typed confirmation. */
const DESTRUCTIVE: ReadonlySet<SchemaChange["kind"]> = new Set([
  "dropColumn",
  "setType",
  "renameColumn",
]);

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

function supportsSchemaEdit(adapter: DatabaseAdapter): boolean {
  return (
    adapter.capabilities?.supportsSchemaEdit !== false &&
    typeof adapter.alterTable === "function" &&
    typeof adapter.planSchemaChanges === "function"
  );
}

// Render the statements without running them.
export async function POST(request: NextRequest) {
  try {
    const parsed = AlterTableSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }

    const { connectionId, table, changes } = parsed.data;

    const resolved = await resolveAdapter(connectionId);
    if ("error" in resolved) return resolved.error;
    const { adapter } = resolved;

    if (!supportsSchemaEdit(adapter)) {
      return NextResponse.json(
        {
          error:
            "This database engine does not support editing table structure through DBPilot.",
        },
        { status: 400 }
      );
    }

    const plan = await adapter.planSchemaChanges!(table, changes);

    return NextResponse.json({
      ...plan,
      destructive: changes.some((change) => DESTRUCTIVE.has(change.kind)),
    });
  } catch (error) {
    console.error("Plan schema change error:", error);
    // An unsupported type or an unknown column is a problem with the request,
    // and the adapter's message names it precisely.
    return NextResponse.json({ error: sanitizeError(error) }, { status: 400 });
  }
}

// Apply the changes.
export async function PUT(request: NextRequest) {
  let connectionId: string | undefined;
  let table: string | undefined;

  try {
    const parsed = AlterTableSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }

    connectionId = parsed.data.connectionId;
    table = parsed.data.table;
    const { changes } = parsed.data;

    // SERVER-SIDE read-only check — cannot be bypassed by the client.
    if (isReadOnlyMode(connectionId)) {
      audit("schema.alter", {
        connectionId,
        details: { table, changes: changes.map((c) => c.kind) },
        success: false,
        error: "Read-only mode",
      });

      return NextResponse.json(
        { error: "Cannot change table structure in read-only mode" },
        { status: 403 }
      );
    }

    const resolved = await resolveAdapter(connectionId);
    if ("error" in resolved) return resolved.error;
    const { adapter } = resolved;

    if (!supportsSchemaEdit(adapter)) {
      return NextResponse.json(
        {
          error:
            "This database engine does not support editing table structure through DBPilot.",
        },
        { status: 400 }
      );
    }

    await adapter.alterTable!(table, changes);

    // The table's columns, stats and any cached row counts all describe the
    // shape it had a moment ago.
    schemaCache.delete(cacheKey.schema(connectionId, table));
    schemaCache.delete(cacheKey.stats(connectionId, table));
    schemaCache.delete(cacheKey.tables(connectionId));
    schemaCache.deleteByPrefix(cacheKey.rowCountPrefix(connectionId, table));

    audit("schema.alter", {
      connectionId,
      details: { table, changes: changes.map((c) => c.kind) },
      success: true,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Alter table error:", error);

    audit("schema.alter", {
      connectionId,
      details: { table },
      success: false,
      error: sanitizeError(error),
    });

    return NextResponse.json({ error: sanitizeError(error) }, { status: 400 });
  }
}
