import { NextRequest, NextResponse } from "next/server";
import {
  createAdapter,
  getOrCreateAdapter,
  getCachedAdapter,
  removeAdapter,
} from "@/lib/adapters/factory";
import { DatabaseType } from "@/lib/adapters/types";
import {
  setReadOnlyMode,
  clearReadOnlyState,
} from "@/lib/server-state";
import { audit } from "@/lib/audit";
import { sanitizeError } from "@/lib/validation";

// Check if a connection exists and is healthy (lightweight check)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get("connectionId");

    if (!connectionId) {
      return NextResponse.json(
        { error: "Missing connectionId parameter" },
        { status: 400 }
      );
    }

    // Check if adapter exists in cache
    const adapter = getCachedAdapter(connectionId);
    if (!adapter) {
      return NextResponse.json({ exists: false, healthy: false });
    }

    // Lightweight health check using ping (no new connections created)
    try {
      const healthy = await adapter.ping();
      return NextResponse.json({
        exists: true,
        healthy,
      });
    } catch {
      return NextResponse.json({ exists: true, healthy: false });
    }
  } catch (error) {
    console.error("Health check error:", error);
    return NextResponse.json(
      { exists: false, healthy: false, error: sanitizeError(error) },
      { status: 500 }
    );
  }
}

// Test a database connection
export async function POST(request: NextRequest) {
  let connectionId: string | undefined;

  try {
    const body = await request.json();
    const { type, connectionString, readOnly } = body as {
      type: DatabaseType;
      connectionString: string;
      connectionId?: string;
      readOnly?: boolean;
    };
    connectionId = body.connectionId;

    if (!type || !connectionString) {
      return NextResponse.json(
        { error: "Missing required fields: type and connectionString" },
        { status: 400 }
      );
    }

    // Create a temporary adapter to test connection
    const adapter = createAdapter(type, connectionString);
    const result = await adapter.testConnection();

    // If test successful and connectionId provided, cache the adapter
    if (result.success && connectionId) {
      const cachedAdapter = getOrCreateAdapter(
        connectionId,
        type,
        connectionString
      );
      await cachedAdapter.connect();

      // Initialize server-side read-only state
      // Default to false (write enabled) unless explicitly set
      setReadOnlyMode(connectionId, readOnly ?? false);

      audit("connection.create", {
        connectionId,
        details: { type },
        success: true,
      });
    } else if (!result.success) {
      audit("connection.test", {
        connectionId,
        details: { type },
        success: false,
        error: result.message,
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Connection error:", error);

    audit("connection.create", {
      connectionId,
      success: false,
      error: sanitizeError(error),
    });

    return NextResponse.json(
      {
        success: false,
        message: sanitizeError(error),
      },
      { status: 500 }
    );
  }
}

// Disconnect from a database
export async function DELETE(request: NextRequest) {
  let connectionId: string | null = null;

  try {
    const { searchParams } = new URL(request.url);
    connectionId = searchParams.get("connectionId");

    if (!connectionId) {
      return NextResponse.json(
        { error: "Missing connectionId parameter" },
        { status: 400 }
      );
    }

    await removeAdapter(connectionId);

    // Clear server-side state
    clearReadOnlyState(connectionId);

    audit("connection.delete", {
      connectionId,
      success: true,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Disconnect error:", error);

    audit("connection.delete", {
      connectionId: connectionId ?? undefined,
      success: false,
      error: sanitizeError(error),
    });

    return NextResponse.json(
      { error: sanitizeError(error) },
      { status: 500 }
    );
  }
}
