import { NextRequest, NextResponse } from "next/server";
import { getCachedAdapter } from "@/lib/adapters/factory";
import { isReadOnlyMode } from "@/lib/server-state";
import { audit } from "@/lib/audit";
import { schemaCache } from "@/lib/cache";
import { InvalidDatabaseNameError } from "@/lib/database-name";
import {
  ConnectionIdSchema,
  CreateDatabaseSchema,
  DatabaseNameSchema,
  sanitizeError,
} from "@/lib/validation";
import type { DatabaseAdapter } from "@/lib/adapters/types";

/**
 * Server-level database operations: list, switch, create.
 *
 * The level above tables. A connection string that names no database is
 * legitimate — it connects to the server and leaves the database unselected —
 * and this route is what lets the user choose one rather than being dropped into
 * whichever database the driver defaulted to.
 *
 * Listing and switching are reads as far as the *data* is concerned and stay
 * available in read-only mode; creating is a write and is gated like any other.
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

/**
 * Turn a name the engine rejected into a 400 rather than a 500.
 *
 * `InvalidDatabaseNameError` means the user typed something unusable; anything
 * else coming out of the driver is still usually about the request (a duplicate
 * name, a permission the role lacks) and its own message is the useful one.
 */
function nameErrorStatus(error: unknown): number {
  return error instanceof InvalidDatabaseNameError ? 400 : 400;
}

// List the databases on this server.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = ConnectionIdSchema.safeParse(
      searchParams.get("connectionId")
    );

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Missing or invalid connectionId" },
        { status: 400 }
      );
    }

    const resolved = await resolveAdapter(parsed.data);
    if ("error" in resolved) return resolved.error;
    const { adapter } = resolved;

    const databases = await adapter.listDatabases();

    return NextResponse.json({
      databases,
      current: adapter.getCurrentDatabase(),
      canCreate:
        adapter.capabilities?.supportsDatabaseCreate !== false &&
        typeof adapter.createDatabase === "function",
    });
  } catch (error) {
    console.error("List databases error:", error);
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

// Switch the connection to a different database.
export async function PUT(request: NextRequest) {
  let connectionId: string | undefined;

  try {
    const body = await request.json();
    const connectionIdResult = ConnectionIdSchema.safeParse(body.connectionId);
    const nameResult = DatabaseNameSchema.safeParse(body.name);

    if (!connectionIdResult.success || !nameResult.success) {
      return NextResponse.json(
        { error: "Missing or invalid fields: connectionId and name" },
        { status: 400 }
      );
    }

    connectionId = connectionIdResult.data;

    const resolved = await resolveAdapter(connectionId);
    if ("error" in resolved) return resolved.error;
    const { adapter } = resolved;

    await adapter.useDatabase(nameResult.data);

    // Everything cached for this connection describes the *previous* database:
    // its table list, every table's schema and stats, every cached row count.
    // None of it is valid now, and a stale table list is worse than a slow one
    // because it offers tables that do not exist here.
    schemaCache.clearConnection(connectionId);

    return NextResponse.json({
      success: true,
      current: adapter.getCurrentDatabase(),
    });
  } catch (error) {
    console.error("Switch database error:", error);
    return NextResponse.json(
      { error: sanitizeError(error) },
      { status: nameErrorStatus(error) }
    );
  }
}

// Create a database.
export async function POST(request: NextRequest) {
  let connectionId: string | undefined;
  let name: string | undefined;

  try {
    const body = await request.json();
    const parsed = CreateDatabaseSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }

    connectionId = parsed.data.connectionId;
    name = parsed.data.name;
    const { initialCollection } = parsed.data;

    // SERVER-SIDE read-only check — cannot be bypassed by the client.
    if (isReadOnlyMode(connectionId)) {
      audit("database.create", {
        connectionId,
        details: { database: name },
        success: false,
        error: "Read-only mode",
      });

      return NextResponse.json(
        { error: "Cannot create a database in read-only mode" },
        { status: 403 }
      );
    }

    const resolved = await resolveAdapter(connectionId);
    if ("error" in resolved) return resolved.error;
    const { adapter } = resolved;

    if (
      adapter.capabilities?.supportsDatabaseCreate === false ||
      typeof adapter.createDatabase !== "function"
    ) {
      return NextResponse.json(
        {
          error:
            "This database engine does not support creating databases through DBPilot.",
        },
        { status: 400 }
      );
    }

    await adapter.createDatabase(name, { initialCollection });

    audit("database.create", {
      connectionId,
      details: { database: name },
      success: true,
    });

    return NextResponse.json({ success: true, name });
  } catch (error) {
    console.error("Create database error:", error);

    audit("database.create", {
      connectionId,
      details: { database: name },
      success: false,
      error: sanitizeError(error),
    });

    return NextResponse.json(
      { error: sanitizeError(error) },
      { status: nameErrorStatus(error) }
    );
  }
}
