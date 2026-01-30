import { NextRequest, NextResponse } from "next/server";
import { getCachedAdapter } from "@/lib/adapters/factory";
import { isReadOnlyMode } from "@/lib/server-state";
import { audit } from "@/lib/audit";
import {
  sanitizeError,
  ConnectionIdSchema,
} from "@/lib/validation";

/**
 * Check if a query is a write operation.
 * Strips SQL comments to prevent bypass attacks.
 */
function isWriteQuery(query: string): boolean {
  // Remove SQL comments to prevent bypass
  const stripped = query
    .replace(/--.*$/gm, "") // Single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, "") // Block comments
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim()
    .toUpperCase();

  // PostgreSQL/ClickHouse write keywords
  const writeKeywords = [
    "INSERT",
    "UPDATE",
    "DELETE",
    "DROP",
    "CREATE",
    "ALTER",
    "TRUNCATE",
    "GRANT",
    "REVOKE",
    "COPY",
    "VACUUM",
    "REINDEX",
    "CLUSTER",
    "DISCARD",
    "LOCK",
  ];

  // Check if query starts with any write keyword
  const startsWithWrite = writeKeywords.some(
    (keyword) =>
      stripped.startsWith(keyword + " ") || stripped === keyword
  );

  // Also check for write operations in CTEs (WITH ... INSERT/UPDATE/DELETE)
  const containsWriteInCTE = writeKeywords.some((keyword) =>
    new RegExp(`\\)\\s*${keyword}\\s+`, "i").test(stripped)
  );

  return startsWithWrite || containsWriteInCTE;
}

/**
 * Check if a MongoDB query contains write operations.
 */
function isMongoWriteQuery(query: string): boolean {
  const mongoWriteOps = [
    "insertOne",
    "insertMany",
    "updateOne",
    "updateMany",
    "deleteOne",
    "deleteMany",
    "drop",
    "createIndex",
    "dropIndex",
    "dropIndexes",
    "renameCollection",
    "replaceOne",
    "bulkWrite",
  ];

  return mongoWriteOps.some((op) => query.includes(`.${op}(`));
}

// Execute a query
export async function POST(request: NextRequest) {
  let connectionId: string | undefined;
  let query: string | undefined;

  try {
    const body = await request.json();
    connectionId = body.connectionId;
    query = body.query;

    // Validate required fields
    const connectionIdResult = ConnectionIdSchema.safeParse(connectionId);

    if (!connectionIdResult.success || !query || typeof query !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid required fields: connectionId and query" },
        { status: 400 }
      );
    }

    // Limit query length to prevent abuse
    if (query.length > 100000) {
      return NextResponse.json(
        { error: "Query too long (max 100KB)" },
        { status: 400 }
      );
    }

    // SERVER-SIDE read-only check - cannot be bypassed by client
    if (isReadOnlyMode(connectionId!)) {
      const isWrite = isWriteQuery(query) || isMongoWriteQuery(query);

      if (isWrite) {
        audit("query.execute", {
          connectionId,
          details: { queryLength: query.length, blocked: true },
          success: false,
          error: "Write query blocked in read-only mode",
        });

        return NextResponse.json(
          { error: "Write operations are not allowed in read-only mode" },
          { status: 403 }
        );
      }
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

    const result = await adapter.executeQuery(query);

    audit("query.execute", {
      connectionId,
      details: {
        queryLength: query.length,
        rowCount: result.rowCount,
        executionTimeMs: result.executionTimeMs,
      },
      success: !result.error,
      error: result.error,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Query execution error:", error);

    audit("query.execute", {
      connectionId,
      details: { queryLength: query?.length },
      success: false,
      error: sanitizeError(error),
    });

    return NextResponse.json(
      {
        rows: [],
        columns: [],
        rowCount: 0,
        executionTimeMs: 0,
        error: sanitizeError(error),
      },
      { status: 500 }
    );
  }
}
