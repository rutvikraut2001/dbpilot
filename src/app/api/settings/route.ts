import { NextRequest, NextResponse } from "next/server";
import { getCachedAdapter } from "@/lib/adapters/factory";
import {
  setReadOnlyMode,
  isReadOnlyMode,
  isForceReadOnly,
} from "@/lib/server-state";
import { audit } from "@/lib/audit";
import { ConnectionIdSchema, sanitizeError } from "@/lib/validation";
import { z } from "zod";

const UpdateSettingsSchema = z.object({
  connectionId: ConnectionIdSchema,
  readOnly: z.boolean(),
});

// Update settings (including read-only mode)
export async function POST(request: NextRequest) {
  let connectionId: string | undefined;

  try {
    const body = await request.json();
    const parsed = UpdateSettingsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request: connectionId and readOnly are required" },
        { status: 400 }
      );
    }

    connectionId = parsed.data.connectionId;
    const { readOnly } = parsed.data;

    // Verify connection exists
    const adapter = getCachedAdapter(connectionId);
    if (!adapter) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }

    // A deployment with FORCE_READ_ONLY=true cannot be talked out of it.
    if (isForceReadOnly() && !readOnly) {
      audit("settings.change", {
        connectionId,
        details: { readOnly, blocked: true },
        success: false,
        error: "FORCE_READ_ONLY is enabled",
      });

      return NextResponse.json(
        {
          error:
            "This instance is configured with FORCE_READ_ONLY=true. Write access cannot be enabled.",
          readOnly: true,
          forceReadOnly: true,
        },
        { status: 403 }
      );
    }

    // Update server-side read-only state. The returned value is what the server
    // will actually enforce.
    const effectiveReadOnly = setReadOnlyMode(connectionId, readOnly);

    audit("settings.change", {
      connectionId,
      details: { readOnly: effectiveReadOnly },
      success: true,
    });

    return NextResponse.json({
      success: true,
      readOnly: effectiveReadOnly,
      forceReadOnly: isForceReadOnly(),
    });
  } catch (error) {
    console.error("Settings update error:", error);

    audit("settings.change", {
      connectionId,
      success: false,
      error: sanitizeError(error),
    });

    return NextResponse.json(
      { error: sanitizeError(error) },
      { status: 500 }
    );
  }
}

// Get current settings
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get("connectionId");

    const connectionIdResult = ConnectionIdSchema.safeParse(connectionId);

    if (!connectionIdResult.success) {
      return NextResponse.json(
        { error: "Missing or invalid connectionId" },
        { status: 400 }
      );
    }

    // Verify connection exists
    const adapter = getCachedAdapter(connectionId!);
    if (!adapter) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }

    // Get adapter capabilities if available
    const capabilities = adapter.capabilities ?? {
      supportsUpdate: true,
      supportsDelete: true,
      supportsTransactions: true,
    };

    return NextResponse.json({
      readOnly: isReadOnlyMode(connectionId!),
      forceReadOnly: isForceReadOnly(),
      capabilities,
    });
  } catch (error) {
    console.error("Settings get error:", error);

    return NextResponse.json(
      { error: sanitizeError(error) },
      { status: 500 }
    );
  }
}
