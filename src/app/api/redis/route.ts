import { NextRequest, NextResponse } from "next/server";
import { getCachedAdapter } from "@/lib/adapters/factory";
import { isReadOnlyMode } from "@/lib/server-state";
import { audit } from "@/lib/audit";
import { sanitizeError, ConnectionIdSchema } from "@/lib/validation";
import { RedisAdapter } from "@/lib/adapters/redis";

// Redis-specific operations (FLUSHDB, FLUSHALL)
export async function POST(request: NextRequest) {
  let connectionId: string | undefined;
  let action: string | undefined;

  try {
    const body = await request.json();
    connectionId = body.connectionId;
    action = body.action;

    const connectionIdResult = ConnectionIdSchema.safeParse(connectionId);

    if (!connectionIdResult.success || !action) {
      return NextResponse.json(
        { error: "Missing required fields: connectionId and action" },
        { status: 400 }
      );
    }

    if (!["flushdb", "flushall"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action. Supported: flushdb, flushall" },
        { status: 400 }
      );
    }

    // Server-side read-only check
    if (isReadOnlyMode(connectionId!)) {
      audit("redis.flush", {
        connectionId,
        details: { action, blocked: true },
        success: false,
        error: "Blocked in read-only mode",
      });

      return NextResponse.json(
        { error: "Flush operations are not allowed in read-only mode" },
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

    if (!(adapter instanceof RedisAdapter)) {
      return NextResponse.json(
        { error: "This operation is only supported for Redis connections" },
        { status: 400 }
      );
    }

    if (!adapter.isConnected()) {
      await adapter.connect();
    }

    if (action === "flushdb") {
      await adapter.flushDb();
    } else {
      await adapter.flushAll();
    }

    audit("redis.flush", {
      connectionId,
      details: { action },
      success: true,
    });

    return NextResponse.json({ success: true, action });
  } catch (error) {
    console.error("Redis operation error:", error);

    audit("redis.flush", {
      connectionId,
      details: { action },
      success: false,
      error: sanitizeError(error),
    });

    return NextResponse.json(
      { error: sanitizeError(error) },
      { status: 500 }
    );
  }
}
