import { NextRequest, NextResponse } from "next/server";
import { getCachedAdapter } from "@/lib/adapters/factory";
import { audit } from "@/lib/audit";
import {
  sanitizeError,
  TableNameSchema,
  ConnectionIdSchema,
} from "@/lib/validation";
import { rowsToCsv, rowsToJson, exportFilename } from "@/lib/utils/export";

// Fetch ALL rows of a table and stream them back as a downloadable CSV or JSON file.
// Read-only operation; pages through the adapter to avoid the 100-row API cap.
const PAGE_SIZE = 1000;
const MAX_ROWS = 500_000; // safety cap to protect memory on very large tables

export async function GET(request: NextRequest) {
  let connectionId: string | null = null;
  let tableName: string | null = null;

  try {
    const { searchParams } = new URL(request.url);
    connectionId = searchParams.get("connectionId");
    tableName = searchParams.get("table");
    const format = (searchParams.get("format") || "csv").toLowerCase();

    const connectionIdResult = ConnectionIdSchema.safeParse(connectionId);
    const tableResult = TableNameSchema.safeParse(tableName);

    if (!connectionIdResult.success || !tableResult.success) {
      return NextResponse.json(
        { error: "Missing or invalid required parameters: connectionId and table" },
        { status: 400 }
      );
    }

    if (format !== "csv" && format !== "json") {
      return NextResponse.json(
        { error: "Invalid format. Use 'csv' or 'json'." },
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
    if (!adapter.isConnected()) {
      await adapter.connect();
    }

    // Page through the whole table.
    const rows: Record<string, unknown>[] = [];
    let page = 1;
    let capped = false;
    for (;;) {
      const result = await adapter.getRows(tableName!, { page, pageSize: PAGE_SIZE });
      rows.push(...result.data);

      if (rows.length >= MAX_ROWS) {
        rows.length = MAX_ROWS;
        capped = true;
        break;
      }
      if (result.data.length < PAGE_SIZE || page >= result.totalPages) {
        break;
      }
      page += 1;
    }

    const ext = format as "csv" | "json";
    const body = ext === "csv" ? rowsToCsv(rows) : rowsToJson(rows);
    const contentType =
      ext === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8";

    audit("data.read", {
      connectionId: connectionId!,
      details: { table: tableName, export: ext, rows: rows.length, capped },
      success: true,
    });

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${exportFilename(tableName!, ext)}"`,
        "Cache-Control": "no-store",
        ...(capped ? { "X-Export-Capped": String(MAX_ROWS) } : {}),
      },
    });
  } catch (error) {
    console.error("Export error:", error);
    audit("data.read", {
      connectionId: connectionId ?? undefined,
      details: { table: tableName, export: true },
      success: false,
      error: sanitizeError(error),
    });
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
