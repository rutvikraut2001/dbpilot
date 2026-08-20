import { NextRequest, NextResponse } from "next/server";
import { getCachedAdapter } from "@/lib/adapters/factory";
import { audit } from "@/lib/audit";
import { sanitizeError, ConnectionIdSchema } from "@/lib/validation";
import { z } from "zod";

/**
 * Cancel an in-flight query.
 *
 * Read-only with respect to data: it asks the engine to abort a statement, which
 * is allowed regardless of read-only mode — stopping work is never destructive.
 */
const CancelSchema = z.object({
  connectionId: ConnectionIdSchema,
  runId: z.string().min(1).max(200),
});

export async function POST(request: NextRequest) {
  let connectionId: string | undefined;

  try {
    const body = await request.json();
    const parsed = CancelSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request: connectionId and runId are required" },
        { status: 400 }
      );
    }

    connectionId = parsed.data.connectionId;
    const { runId } = parsed.data;

    const adapter = getCachedAdapter(connectionId);
    if (!adapter) {
      return NextResponse.json(
        { error: "Connection not found. Please reconnect." },
        { status: 404 }
      );
    }

    if (!adapter.cancelQuery) {
      return NextResponse.json(
        { error: "This database does not support cancelling a running query." },
        { status: 501 }
      );
    }

    const cancelled = await adapter.cancelQuery(runId);

    audit("query.execute", {
      connectionId,
      details: { cancelled, runId },
      success: true,
    });

    // `cancelled: false` is a normal outcome — the query most likely finished
    // before the request arrived — so it is not an error status.
    return NextResponse.json({ cancelled });
  } catch (error) {
    console.error("Query cancel error:", error);
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
