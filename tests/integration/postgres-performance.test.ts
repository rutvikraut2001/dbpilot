import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PostgresAdapter } from "@/lib/adapters/postgres";

/**
 * Behaviour of the Phase 2 performance work, verified against a real database.
 *
 * These assert semantics, not timings — a wall-clock assertion would be flaky on
 * shared CI. What matters is that skipping the count still returns the right
 * page, and that a single-statement bulk delete removes exactly the right rows.
 *
 * Requires TEST_POSTGRES_URL; skipped otherwise.
 */
const CONNECTION_STRING = process.env.TEST_POSTGRES_URL;

describe.skipIf(!CONNECTION_STRING)("PostgreSQL paging and bulk delete", () => {
  let adapter: PostgresAdapter;

  beforeAll(async () => {
    adapter = new PostgresAdapter(CONNECTION_STRING!);
    await adapter.connect();
  });

  afterAll(async () => {
    if (!adapter) return;
    await adapter.executeQuery("DROP TABLE IF EXISTS perf_rows");
    await adapter.disconnect();
  });

  beforeEach(async () => {
    await adapter.executeQuery("DROP TABLE IF EXISTS perf_rows");
    await adapter.executeQuery(
      "CREATE TABLE perf_rows (id serial PRIMARY KEY, bucket text NOT NULL)"
    );
    await adapter.executeQuery(`
      INSERT INTO perf_rows (bucket)
      SELECT CASE WHEN i % 2 = 0 THEN 'even' ELSE 'odd' END
      FROM generate_series(1, 250) AS i
    `);
  });

  describe("includeTotal", () => {
    it("returns the total when asked", async () => {
      const result = await adapter.getRows("perf_rows", {
        page: 1,
        pageSize: 50,
        includeTotal: true,
      });

      expect(result.total).toBe(250);
      expect(result.data).toHaveLength(50);
    });

    it("returns the same page without the total when told to skip it", async () => {
      const withCount = await adapter.getRows("perf_rows", {
        page: 3,
        pageSize: 50,
        sortBy: "id",
        includeTotal: true,
      });
      const withoutCount = await adapter.getRows("perf_rows", {
        page: 3,
        pageSize: 50,
        sortBy: "id",
        includeTotal: false,
      });

      // The rows must be identical; only the total differs.
      expect(withoutCount.data).toEqual(withCount.data);
      expect(withCount.total).toBe(250);
      expect(withoutCount.total).toBe(0);
    });

    it("defaults to counting when the option is omitted", async () => {
      const result = await adapter.getRows("perf_rows", {
        page: 1,
        pageSize: 10,
      });
      expect(result.total).toBe(250);
    });

    it("counts only matching rows when filtered", async () => {
      const result = await adapter.getRows("perf_rows", {
        page: 1,
        pageSize: 10,
        filters: { bucket: "even" },
        includeTotal: true,
      });
      expect(result.total).toBe(125);
    });
  });

  describe("orderBy", () => {
    it("applies a deterministic ordering", async () => {
      const result = await adapter.getRows("perf_rows", {
        page: 1,
        pageSize: 20,
        orderBy: ["id"],
        includeTotal: false,
      });

      const ids = result.data.map((r) => r.id as number);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
      expect(ids[0]).toBe(1);
    });

    it("takes precedence over sortBy", async () => {
      const result = await adapter.getRows("perf_rows", {
        page: 1,
        pageSize: 5,
        sortBy: "id",
        sortOrder: "desc",
        orderBy: ["id"],
        includeTotal: false,
      });

      expect(result.data.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    });

    it("validates column names rather than interpolating them", async () => {
      await expect(
        adapter.getRows("perf_rows", {
          page: 1,
          pageSize: 5,
          orderBy: ["id; DROP TABLE perf_rows"],
        })
      ).rejects.toThrow(/Invalid column name/);
    });

    it("covers every row exactly once when paging the whole table", async () => {
      // The guarantee the export depends on. Paging without a stable ORDER BY
      // let the database reorder rows between pages: a 2M-row export produced
      // 500k rows containing only 442k distinct ids — ~50k duplicated and ~58k
      // missing. This asserts the contract that prevents it.
      const seen: number[] = [];
      const pageSize = 40;

      for (let page = 1; ; page++) {
        const result = await adapter.getRows("perf_rows", {
          page,
          pageSize,
          orderBy: ["id"],
          includeTotal: false,
        });
        if (result.data.length === 0) break;
        seen.push(...result.data.map((r) => r.id as number));
        if (result.data.length < pageSize) break;
      }

      expect(seen).toHaveLength(250);
      expect(new Set(seen).size).toBe(250);
      expect(seen).toEqual(Array.from({ length: 250 }, (_, i) => i + 1));
    });
  });

  describe("getTables under concurrent DDL", () => {
    it("keeps listing while tables are dropped underneath it", async () => {
      // The regression: the listing used to rebuild each table's name and cast
      // it back with `::regclass`, evaluated per row. A table dropped between
      // the row being read and the cast running threw, failing the *entire*
      // listing — measured at 8 failures in 60 attempts under this churn, which
      // on a busy database means the sidebar intermittently going blank.
      // Joining pg_class on oid has no such window.
      const TABLES = 30;
      for (let i = 0; i < TABLES; i++) {
        await adapter.executeQuery(
          `CREATE TABLE IF NOT EXISTS churn_${i} (id int, x text)`
        );
      }

      let listings = 0;
      let failures = 0;

      try {
        const churn = (async () => {
          for (let round = 0; round < TABLES; round++) {
            await adapter.executeQuery(`DROP TABLE IF EXISTS churn_${round}`);
            await adapter.executeQuery(
              `CREATE TABLE IF NOT EXISTS churn_${round} (id int, x text)`
            );
          }
        })();

        const listing = (async () => {
          for (let round = 0; round < TABLES; round++) {
            try {
              await adapter.getTables();
              listings++;
            } catch {
              failures++;
            }
          }
        })();

        await Promise.all([churn, listing]);
      } finally {
        for (let i = 0; i < TABLES; i++) {
          await adapter.executeQuery(`DROP TABLE IF EXISTS churn_${i}`);
        }
      }

      expect(failures).toBe(0);
      expect(listings).toBe(TABLES);
    }, 120000);

    it("includes materialized views, which information_schema omits", async () => {
      // A side effect of reading pg_class directly: matviews were previously
      // invisible in the sidebar entirely.
      await adapter.executeQuery("DROP MATERIALIZED VIEW IF EXISTS perf_matview");
      await adapter.executeQuery(
        "CREATE MATERIALIZED VIEW perf_matview AS SELECT 1 AS n"
      );

      try {
        const tables = await adapter.getTables();
        const matview = tables.find((t) => t.name === "perf_matview");

        expect(matview).toBeDefined();
        expect(matview?.type).toBe("view");
      } finally {
        await adapter.executeQuery(
          "DROP MATERIALIZED VIEW IF EXISTS perf_matview"
        );
      }
    });
  });

  describe("deleteRows", () => {
    async function remaining(): Promise<number> {
      const result = await adapter.executeQuery(
        "SELECT count(*)::int AS n FROM perf_rows"
      );
      return result.rows[0].n as number;
    }

    it("deletes exactly the rows given", async () => {
      const result = await adapter.deleteRows("perf_rows", [
        { id: 1 },
        { id: 2 },
        { id: 3 },
      ]);

      expect(result).toMatchObject({ deleted: 3, failed: 0 });
      expect(await remaining()).toBe(247);

      const survivors = await adapter.executeQuery(
        "SELECT id FROM perf_rows WHERE id <= 5 ORDER BY id"
      );
      expect(survivors.rows.map((r) => r.id)).toEqual([4, 5]);
    });

    it("handles a large selection in one statement", async () => {
      const primaryKeys = Array.from({ length: 200 }, (_, i) => ({ id: i + 1 }));

      const result = await adapter.deleteRows("perf_rows", primaryKeys);

      expect(result.deleted).toBe(200);
      expect(await remaining()).toBe(50);
    });

    it("reports rows that did not exist as failed", async () => {
      const result = await adapter.deleteRows("perf_rows", [
        { id: 1 },
        { id: 99999 },
      ]);

      expect(result.deleted).toBe(1);
      expect(result.failed).toBe(1);
      expect(await remaining()).toBe(249);
    });

    it("is a no-op for an empty selection", async () => {
      const result = await adapter.deleteRows("perf_rows", []);
      expect(result).toEqual({ deleted: 0, failed: 0 });
      expect(await remaining()).toBe(250);
    });

    it("rejects an invalid column name rather than interpolating it", async () => {
      await expect(
        adapter.deleteRows("perf_rows", [{ "id; DROP TABLE perf_rows": 1 }])
      ).rejects.toThrow(/Invalid column name/);

      expect(await remaining()).toBe(250);
    });

    it("leaves the table untouched when the statement fails", async () => {
      // A type mismatch fails the whole statement; because it is one statement,
      // nothing is partially deleted.
      const result = await adapter.deleteRows("perf_rows", [
        { id: "not-a-number" },
      ]);

      expect(result.failed).toBe(1);
      expect(result.error).toBeDefined();
      expect(await remaining()).toBe(250);
    });
  });
});

describe.skipIf(!CONNECTION_STRING)("PostgreSQL row estimation", () => {
  let adapter: PostgresAdapter;

  beforeAll(async () => {
    adapter = new PostgresAdapter(CONNECTION_STRING!);
    await adapter.connect();
  });

  afterAll(async () => {
    if (!adapter) return;
    await adapter.executeQuery("DROP TABLE IF EXISTS est_rows");
    await adapter.disconnect();
  });

  beforeEach(async () => {
    await adapter.executeQuery("DROP TABLE IF EXISTS est_rows");
    await adapter.executeQuery(
      "CREATE TABLE est_rows (id serial PRIMARY KEY, bucket int NOT NULL)"
    );
    await adapter.executeQuery(`
      INSERT INTO est_rows (bucket)
      SELECT i % 10 FROM generate_series(1, 1000) AS i
    `);
    // Estimates come from table statistics; without ANALYZE they are a guess.
    await adapter.executeQuery("ANALYZE est_rows");
  });

  async function remaining(): Promise<number> {
    const result = await adapter.executeQuery(
      "SELECT count(*)::int AS n FROM est_rows"
    );
    return result.rows[0].n as number;
  }

  it("estimates an unscoped DELETE without deleting anything", async () => {
    // The whole safety property: EXPLAIN plans, it does not execute. Using
    // EXPLAIN ANALYZE here would empty the table.
    const estimate = await adapter.estimateAffectedRows("DELETE FROM est_rows");

    expect(estimate).toBe(1000);
    expect(await remaining()).toBe(1000);
  });

  it("estimates a scoped DELETE without deleting anything", async () => {
    const estimate = await adapter.estimateAffectedRows(
      "DELETE FROM est_rows WHERE bucket = 3"
    );

    expect(estimate).toBeGreaterThan(50);
    expect(estimate).toBeLessThan(200);
    expect(await remaining()).toBe(1000);
  });

  it("estimates an UPDATE without updating anything", async () => {
    const before = await adapter.executeQuery(
      "SELECT sum(bucket)::int AS total FROM est_rows"
    );

    const estimate = await adapter.estimateAffectedRows(
      "UPDATE est_rows SET bucket = 99"
    );
    expect(estimate).toBe(1000);

    const after = await adapter.executeQuery(
      "SELECT sum(bucket)::int AS total FROM est_rows"
    );
    expect(after.rows[0].total).toBe(before.rows[0].total);
  });

  it("reads the estimate off the child of a ModifyTable node", async () => {
    // A ModifyTable node reports "Plan Rows": 0 for itself; the useful estimate
    // is on the scan beneath it. Reading the root would always yield 0.
    expect(
      await adapter.estimateAffectedRows("DELETE FROM est_rows WHERE id < 500")
    ).toBeGreaterThan(0);
  });

  it("estimates a SELECT", async () => {
    expect(
      await adapter.estimateAffectedRows("SELECT * FROM est_rows WHERE bucket = 1")
    ).toBeGreaterThan(0);
  });

  it("returns null for a statement the planner rejects", async () => {
    expect(
      await adapter.estimateAffectedRows("DELETE FROM does_not_exist")
    ).toBeNull();
  });

  it("leaves the connection usable after a failed estimate", async () => {
    await adapter.estimateAffectedRows("this is not sql");

    const after = await adapter.executeQuery("SELECT 1 AS ok");
    expect(after.error).toBeUndefined();
    expect(after.rows[0].ok).toBe(1);
  });
});

describe.skipIf(!CONNECTION_STRING)("PostgreSQL query cancellation", () => {
  let adapter: PostgresAdapter;

  beforeAll(async () => {
    adapter = new PostgresAdapter(CONNECTION_STRING!);
    await adapter.connect();
  });

  afterAll(async () => {
    if (adapter) await adapter.disconnect();
  });

  it("aborts a long-running query", async () => {
    const runId = "run-cancel-1";

    // pg_sleep would otherwise run for 30s (the statement timeout).
    const execution = adapter.executeQuery("SELECT pg_sleep(30)", { runId });

    // Give the query time to reach the server and register its backend pid.
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(await adapter.cancelQuery(runId)).toBe(true);

    const result = await execution;
    expect(result.error).toMatch(/cancel/i);
    // Well under the 30s the sleep asked for.
    expect(result.executionTimeMs).toBeLessThan(5_000);
  }, 20_000);

  it("aborts a long-running read-only query too", async () => {
    // The read-only path runs inside a transaction; cancelling must still work.
    const runId = "run-cancel-2";
    const execution = adapter.executeQuery("SELECT pg_sleep(30)", {
      runId,
      readOnly: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await adapter.cancelQuery(runId)).toBe(true);

    const result = await execution;
    expect(result.error).toMatch(/cancel/i);
  }, 20_000);

  it("reports false for an unknown run", async () => {
    expect(await adapter.cancelQuery("never-started")).toBe(false);
  });

  it("reports false once the query has finished", async () => {
    const runId = "run-cancel-3";
    const result = await adapter.executeQuery("SELECT 1 AS ok", { runId });
    expect(result.error).toBeUndefined();

    // The run is deregistered when it settles, so there is nothing to signal.
    expect(await adapter.cancelQuery(runId)).toBe(false);
  });

  it("leaves the connection usable after a cancellation", async () => {
    const runId = "run-cancel-4";
    const execution = adapter.executeQuery("SELECT pg_sleep(30)", { runId });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await adapter.cancelQuery(runId);
    await execution;

    const after = await adapter.executeQuery("SELECT 42 AS answer");
    expect(after.error).toBeUndefined();
    expect(after.rows[0].answer).toBe(42);
  }, 20_000);

  it("does not leak pooled connections across many cancellations", async () => {
    // Each run checks out a dedicated client; a leak here would exhaust the pool.
    for (let i = 0; i < 5; i++) {
      const runId = `run-cancel-loop-${i}`;
      const execution = adapter.executeQuery("SELECT pg_sleep(10)", { runId });
      await new Promise((resolve) => setTimeout(resolve, 150));
      await adapter.cancelQuery(runId);
      await execution;
    }

    const after = await adapter.executeQuery("SELECT 1 AS ok");
    expect(after.error).toBeUndefined();
  }, 40_000);
});
