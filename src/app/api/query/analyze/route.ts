import { NextRequest, NextResponse } from "next/server";
import { getCachedAdapter } from "@/lib/adapters/factory";
import { assessRisk, hasMultipleStatements } from "@/lib/query-guard";
import { sanitizeError, ConnectionIdSchema } from "@/lib/validation";
import { z } from "zod";

/**
 * Describe what a statement would do, without doing it.
 *
 * Read-only by construction: the only thing sent to the database is a plain
 * `EXPLAIN`, which plans but never executes. `EXPLAIN ANALYZE` is deliberately
 * not used anywhere — it runs the statement to collect real timings, so using it
 * to preview a DELETE would delete the rows.
 */
const AnalyzeSchema = z.object({
  connectionId: ConnectionIdSchema,
  query: z.string().min(1, "Query required").max(100000, "Query too long"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = AnalyzeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }

    const { connectionId, query } = parsed.data;
    const adapter = getCachedAdapter(connectionId);

    if (!adapter) {
      return NextResponse.json(
        { error: "Connection not found. Please reconnect." },
        { status: 404 }
      );
    }

    const risk = assessRisk(query, adapter.dialect);

    let estimatedRows: number | null = null;

    // Only ask the planner about a single, scoped statement. Estimating one
    // statement of a batch would misrepresent the whole thing.
    if (
      risk.canEstimateRows &&
      adapter.estimateAffectedRows &&
      !hasMultipleStatements(query)
    ) {
      if (!adapter.isConnected()) {
        await adapter.connect();
      }
      estimatedRows = await adapter.estimateAffectedRows(query.trim());
    }

    return NextResponse.json({
      level: risk.level,
      verb: risk.verb,
      reasons: risk.reasons,
      // Planner estimate from table statistics — approximate, and can be far off
      // on a table that has never been ANALYZEd. Callers must label it as such.
      estimatedRows,
    });
  } catch (error) {
    console.error("Query analyze error:", error);
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
