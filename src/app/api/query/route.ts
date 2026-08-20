import { NextRequest, NextResponse } from "next/server";
import { getCachedAdapter } from "@/lib/adapters/factory";
import { isReadOnlyMode } from "@/lib/server-state";
import { audit } from "@/lib/audit";
import {
  sanitizeError,
  ConnectionIdSchema,
} from "@/lib/validation";
import {
  hasMultipleStatements,
  isWriteSql,
  isWriteMongoQuery,
  isWriteRedisCommand,
} from "@/lib/query-guard";
import { QueryDialect } from "@/lib/adapters/types";

/**
 * Rows returned to the browser for an ad-hoc query.
 *
 * `SELECT * FROM big_table` has no LIMIT of its own, and the result previously
 * went to the client whole — a multi-hundred-megabyte JSON payload that the
 * grid then tried to render. Capping the response keeps the tab responsive and
 * the payload bounded.
 *
 * Caveat: this bounds what crosses the wire, not what the driver buffers
 * server-side — `pool.query` still materializes the full result. Streaming that
 * properly needs a server-side cursor, which is a larger change.
 */
const MAX_QUERY_ROWS = 5000;

/**
 * Decide whether a query writes, using the inspection appropriate to the
 * adapter's dialect.
 *
 * This is a pre-flight for clear error messages and for MongoDB/Redis, which
 * have no engine-level read-only switch. For SQL adapters it is NOT the
 * security boundary — PostgreSQL runs read-only queries inside a
 * `SET TRANSACTION READ ONLY` transaction and ClickHouse applies `readonly=1`,
 * so a write that slips past this check is still refused by the database.
 */
function looksLikeWrite(query: string, dialect: QueryDialect): boolean {
  switch (dialect) {
    case "sql":
      return isWriteSql(query);
    case "mongodb":
      return isWriteMongoQuery(query);
    case "redis":
      return isWriteRedisCommand(query);
  }
}

// Execute a query
export async function POST(request: NextRequest) {
  let connectionId: string | undefined;
  let query: string | undefined;

  try {
    const body = await request.json();
    connectionId = body.connectionId;
    query = body.query;
    // Optional handle so the client can cancel this run while it is in flight.
    const runId = typeof body.runId === "string" ? body.runId : undefined;

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

    const adapter = getCachedAdapter(connectionId!);

    if (!adapter) {
      return NextResponse.json(
        { error: "Connection not found. Please reconnect." },
        { status: 404 }
      );
    }

    // SERVER-SIDE read-only check. Sourced from server state only — the client
    // cannot assert it, and FORCE_READ_ONLY overrides it.
    const readOnly = isReadOnlyMode(connectionId!);

    if (readOnly) {
      // Reject multi-statement SQL outright. `pool.query(sql)` with no bind
      // parameters uses the simple query protocol, which executes
      // `SELECT 1; DROP TABLE users;` as a batch — so a harmless leading
      // statement must not be able to carry a second one in behind it.
      if (adapter.dialect === "sql" && hasMultipleStatements(query)) {
        audit("query.execute", {
          connectionId,
          details: { queryLength: query.length, blocked: true },
          success: false,
          error: "Multi-statement query blocked in read-only mode",
        });

        return NextResponse.json(
          {
            error:
              "Only a single statement may be executed in read-only mode. Remove the extra statements or disable read-only mode.",
          },
          { status: 403 }
        );
      }

      if (looksLikeWrite(query, adapter.dialect)) {
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

    if (!adapter.isConnected()) {
      await adapter.connect();
    }

    // Pass read-only down so the adapter enforces it at the engine level; the
    // checks above are only a fast pre-flight.
    const result = await adapter.executeQuery(query, { readOnly, runId });

    if (result.rows.length > MAX_QUERY_ROWS) {
      result.totalRows = result.rows.length;
      result.rows = result.rows.slice(0, MAX_QUERY_ROWS);
      result.truncated = true;
    }

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
