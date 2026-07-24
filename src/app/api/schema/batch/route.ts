import { NextRequest, NextResponse } from "next/server";
import { getCachedAdapter } from "@/lib/adapters/factory";
import { schemaCache, CACHE_TTL, cacheKey } from "@/lib/cache";
import { ColumnInfo } from "@/lib/adapters/types";
import { sanitizeError } from "@/lib/validation";

// Batch-load column schemas for many tables in one request, replacing the
// 1-request-per-table fan-out the ER diagram used to do.
// GET /api/schema/batch?connectionId=...&tables=a,b,c  (omit `tables` to load all)
const CONCURRENCY = 8;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get("connectionId");
    const tablesParam = searchParams.get("tables");

    if (!connectionId) {
      return NextResponse.json(
        { error: "Missing connectionId parameter" },
        { status: 400 }
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

    const tableNames = tablesParam
      ? tablesParam.split(",").map((t) => t.trim()).filter(Boolean)
      : (await adapter.getTables()).map((t) => t.name);

    const schemas: Record<string, ColumnInfo[]> = {};

    // Resolve each table's columns with bounded concurrency, using the shared cache.
    const loadOne = async (name: string) => {
      const key = cacheKey.schema(connectionId, name);
      const cached = schemaCache.get<{ schema: ColumnInfo[] }>(key);
      if (cached) {
        schemas[name] = cached.schema;
        return;
      }
      try {
        const [schema, stats, indexes] = await Promise.all([
          adapter.getTableSchema(name),
          adapter.getTableStats(name),
          adapter.getIndexInfo(name),
        ]);
        schemaCache.set(key, { schema, stats, indexes }, CACHE_TTL.SCHEMA);
        schemas[name] = schema;
      } catch {
        // A single failing table shouldn't fail the whole diagram.
        schemas[name] = [];
      }
    };

    for (let i = 0; i < tableNames.length; i += CONCURRENCY) {
      await Promise.all(tableNames.slice(i, i + CONCURRENCY).map(loadOne));
    }

    return NextResponse.json({ schemas });
  } catch (error) {
    console.error("Batch schema error:", error);
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
