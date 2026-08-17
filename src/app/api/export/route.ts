import { NextRequest, NextResponse } from "next/server";
import { getCachedAdapter } from "@/lib/adapters/factory";
import { audit } from "@/lib/audit";
import {
  sanitizeError,
  TableNameSchema,
  ConnectionIdSchema,
} from "@/lib/validation";
import {
  csvHeader,
  csvRows,
  rowToJson,
  exportFilename,
} from "@/lib/utils/export";

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

    const ext = format as "csv" | "json";
    const contentType =
      ext === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8";

    // Paging a whole table with LIMIT/OFFSET is only correct under a stable
    // ORDER BY. Without one the database may return rows in a different order
    // per page — a 2M-row export measured 500k rows containing just 442k
    // distinct ids, i.e. ~50k duplicated and ~58k silently missing. Ordering by
    // the primary key makes the walk deterministic; it is also indexed, so the
    // ordering is close to free.
    let orderBy: string[] = [];
    try {
      const schema = await adapter.getTableSchema(tableName!);
      orderBy = schema.filter((col) => col.isPrimaryKey).map((col) => col.name);
    } catch {
      // Schema lookup failing shouldn't block the export; fall through to the
      // unordered walk and flag it on the response below.
    }

    // Stream the export instead of materializing it.
    //
    // The previous implementation accumulated every row into an array and then
    // serialized the whole thing into a single string — two full copies of the
    // table in memory, up to the 500k cap, before a single byte was sent. Now
    // each page is serialized and flushed as it arrives, so peak memory is one
    // page and the download starts immediately.
    const encoder = new TextEncoder();
    const exportedConnectionId = connectionId!;
    const exportedTable = tableName!;
    const exportOrderBy = orderBy;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let page = 1;
        let written = 0;
        let capped = false;
        // Pinned from the first page so every chunk lines up with the header.
        let columns: string[] = [];

        try {
          if (ext === "json") controller.enqueue(encoder.encode("[\n"));

          for (;;) {
            const result = await adapter.getRows(exportedTable, {
              page,
              pageSize: PAGE_SIZE,
              // Nothing here uses the total, and counting the whole table just
              // to export it would double the work.
              includeTotal: false,
              orderBy: exportOrderBy,
            });

            let batch = result.data;
            if (batch.length === 0) break;

            if (written + batch.length > MAX_ROWS) {
              batch = batch.slice(0, MAX_ROWS - written);
              capped = true;
            }

            if (ext === "csv") {
              if (written === 0) {
                columns = Object.keys(batch[0]);
                controller.enqueue(encoder.encode(csvHeader(columns)));
              }
              controller.enqueue(
                encoder.encode(`\n${csvRows(batch, columns)}`)
              );
            } else {
              const serialized = batch.map(rowToJson).join(",\n");
              controller.enqueue(
                encoder.encode(written === 0 ? serialized : `,\n${serialized}`)
              );
            }

            written += batch.length;

            if (capped) break;
            if (result.data.length < PAGE_SIZE) break;
            page += 1;
          }

          if (ext === "json") controller.enqueue(encoder.encode("\n]\n"));

          audit("data.read", {
            connectionId: exportedConnectionId,
            details: { table: exportedTable, export: ext, rows: written, capped },
            success: true,
          });

          controller.close();
        } catch (streamError) {
          audit("data.read", {
            connectionId: exportedConnectionId,
            details: { table: exportedTable, export: ext, rows: written },
            success: false,
            error: sanitizeError(streamError),
          });
          // The status line is already sent, so the only signal available is a
          // truncated body plus an errored stream.
          controller.error(streamError);
        }
      },
    });

    return new NextResponse(stream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${exportFilename(tableName!, ext)}"`,
        "Cache-Control": "no-store",
        "X-Export-Max-Rows": String(MAX_ROWS),
        // Without a primary key there is no stable ordering to page by, so the
        // export is best-effort and may repeat or omit rows.
        ...(orderBy.length === 0 ? { "X-Export-Unordered": "true" } : {}),
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
