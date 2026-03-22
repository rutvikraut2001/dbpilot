import { NextRequest, NextResponse } from "next/server";
import {
  createAdapter,
  getOrCreateAdapter,
  getCachedAdapter,
  removeAdapter,
} from "@/lib/adapters/factory";
import { DatabaseType, SSHTunnelConfig } from "@/lib/adapters/types";
import { SSHTunnel } from "@/lib/adapters/tunnel";
import {
  DB_DEFAULT_PORTS,
  parseHostname,
  parsePort,
  redirectToTunnel,
} from "@/lib/utils/connection-string";
import { buildConnectionStrategies, diagnoseConnectionError } from "@/lib/utils/connection-diagnostics";
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

/**
 * Test a connection with multi-strategy fallback (localhost, IPv4, Docker host, etc.).
 * Returns the effective connection string that worked (may differ from input).
 */
async function testWithStrategies(
  type: DatabaseType,
  connectionString: string
): Promise<{
  success: boolean;
  message: string;
  effectiveConnectionString: string;
  diagnostics?: { suggestions: string[] };
}> {
  const strategies = buildConnectionStrategies(type, connectionString);
  let lastError: unknown = null;
  let lastDiagnostics: ReturnType<typeof diagnoseConnectionError> | null = null;

  for (const strategy of strategies) {
    try {
      const adapter = createAdapter(type, strategy.connectionString);
      const result = await adapter.testConnection();

      if (result.success) {
        const switched = strategy.connectionString !== connectionString;
        return {
          success: true,
          message: switched
            ? `${result.message} (connected via ${strategy.label})`
            : result.message,
          effectiveConnectionString: strategy.connectionString,
        };
      }

      // Test returned success=false with a message
      lastError = new Error(result.message);
      lastDiagnostics = diagnoseConnectionError(lastError, type, strategy.connectionString);
    } catch (error) {
      lastError = error;
      lastDiagnostics = diagnoseConnectionError(error, type, strategy.connectionString);

      // Don't retry auth errors with different hosts
      if (lastDiagnostics.category === 'auth') break;
    }
  }

  return {
    success: false,
    message: lastDiagnostics?.userMessage ?? sanitizeError(lastError),
    effectiveConnectionString: connectionString,
    diagnostics: lastDiagnostics
      ? { suggestions: lastDiagnostics.suggestions }
      : undefined,
  };
}

// Test or establish a database connection
export async function POST(request: NextRequest) {
  let connectionId: string | undefined;

  try {
    const body = await request.json();
    const { type, connectionString, readOnly, sshTunnel } = body as {
      type: DatabaseType;
      connectionString: string;
      connectionId?: string;
      readOnly?: boolean;
      sshTunnel?: SSHTunnelConfig;
    };
    connectionId = body.connectionId;

    if (!type || !connectionString) {
      return NextResponse.json(
        { error: "Missing required fields: type and connectionString" },
        { status: 400 }
      );
    }

    let result: { success: boolean; message: string };
    let effectiveConnectionString = connectionString;
    let diagnostics: { suggestions: string[] } | undefined;

    if (sshTunnel?.enabled) {
      // SSH tunnel: set up a temporary tunnel for testing
      const remoteHost = sshTunnel.remoteHost || parseHostname(connectionString);
      const remotePort = sshTunnel.remotePort || parsePort(connectionString, DB_DEFAULT_PORTS[type] ?? 5432);
      const tempTunnel = new SSHTunnel({ ...sshTunnel, remoteHost, remotePort });

      try {
        const localPort = await tempTunnel.connect();
        const tunneledConnectionString = redirectToTunnel(connectionString, localPort);

        const adapter = createAdapter(type, tunneledConnectionString);
        result = await adapter.testConnection();
        effectiveConnectionString = connectionString; // keep original for storage

        await tempTunnel.close();
      } catch (tunnelError) {
        await tempTunnel.close().catch(() => {});
        result = {
          success: false,
          message: `SSH tunnel failed: ${sanitizeError(tunnelError)}`,
        };
      }
    } else {
      // Direct connection with multi-strategy fallback
      const testResult = await testWithStrategies(type, connectionString);
      result = { success: testResult.success, message: testResult.message };
      effectiveConnectionString = testResult.effectiveConnectionString;
      diagnostics = testResult.diagnostics;
    }

    // If test successful and connectionId provided, cache the adapter for the session
    if (result.success && connectionId) {
      const cachedAdapter = await getOrCreateAdapter(
        connectionId,
        type,
        effectiveConnectionString,
        sshTunnel
      );
      await cachedAdapter.connect();

      // Initialize server-side read-only state
      setReadOnlyMode(connectionId, readOnly ?? false);

      audit("connection.create", {
        connectionId,
        details: { type },
        success: true,
      });

      // Return the effective connection string so client can store it
      return NextResponse.json({
        ...result,
        effectiveConnectionString:
          effectiveConnectionString !== connectionString
            ? effectiveConnectionString
            : undefined,
      });
    } else if (!result.success) {
      audit("connection.test", {
        connectionId,
        details: { type },
        success: false,
        error: result.message,
      });
    }

    return NextResponse.json({ ...result, diagnostics });
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
