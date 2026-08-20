import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MySQLAdapter } from "@/lib/adapters/mysql";

/**
 * Paging, bulk delete and row estimation against a real MySQL — the same
 * properties `postgres-performance.test.ts` pins for PostgreSQL, so the two
 * adapters are held to one contract rather than each to its own.
 *
 * These assert semantics, not timings; a wall-clock assertion would be flaky on
 * shared CI.
 *
 * Requires TEST_MYSQL_URL; skipped otherwise.
 */
const CONNECTION_STRING = process.env.TEST_MYSQL_URL;

describe.skipIf(!CONNECTION_STRING)("MySQL paging and bulk delete", () => {
  let adapter: MySQLAdapter;

  beforeAll(async () => {
    adapter = new MySQLAdapter(CONNECTION_STRING!);
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
      "CREATE TABLE perf_rows (id int AUTO_INCREMENT PRIMARY KEY, bucket varchar(8) NOT NULL)"
    );

    // MySQL has no generate_series; a recursive CTE is the portable equivalent
    // on 8.0 and produces the same 250 alternating rows.
    await adapter.executeQuery(`
      INSERT INTO perf_rows (bucket)
      WITH RECURSIVE seq(i) AS (
        SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 250
      )
      SELECT IF(i % 2 = 0, 'even', 'odd') FROM seq
    `);

    // The optimizer's estimates come from the statistics, which a fresh table
    // has none of until it is analyzed.
    await adapter.executeQuery("ANALYZE TABLE perf_rows");
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

      expect(withoutCount.total).toBe(0);
      expect(withoutCount.data).toEqual(withCount.data);
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
      });

      expect(result.total).toBe(125);
      expect(result.data.every((row) => row.bucket === "even")).toBe(true);
    });
  });

  describe("orderBy", () => {
    it("takes precedence over sortBy", async () => {
      const result = await adapter.getRows("perf_rows", {
        page: 1,
        pageSize: 5,
        sortBy: "id",
        sortOrder: "desc",
        orderBy: ["id"],
      });

      // orderBy is ascending by construction, so winning means ids 1..5.
      expect(result.data.map((row) => Number(row.id))).toEqual([1, 2, 3, 4, 5]);
    });

    it("validates column names rather than interpolating them", async () => {
      await expect(
        adapter.getRows("perf_rows", {
          page: 1,
          pageSize: 5,
          orderBy: ["id`; DROP TABLE perf_rows; --"],
        })
      ).rejects.toThrow(/Invalid column name/);

      const survived = await adapter.getRows("perf_rows", {
        page: 1,
        pageSize: 1,
      });
      expect(survived.total).toBe(250);
    });

    it("covers every row exactly once when paging the whole table", async () => {
      const seen: number[] = [];
      const pageSize = 40;

      for (let page = 1; page <= Math.ceil(250 / pageSize); page++) {
        const result = await adapter.getRows("perf_rows", {
          page,
          pageSize,
          orderBy: ["id"],
          includeTotal: false,
        });
        seen.push(...result.data.map((row) => Number(row.id)));
      }

      expect(seen).toHaveLength(250);
      expect(new Set(seen).size).toBe(250);
    });
  });

  describe("deleteRows", () => {
    async function remainingIds(): Promise<number[]> {
      const result = await adapter.executeQuery(
        "SELECT id FROM perf_rows ORDER BY id"
      );
      return result.rows.map((row) => Number(row.id));
    }

    it("deletes exactly the rows given", async () => {
      const result = await adapter.deleteRows("perf_rows", [
        { id: 1 },
        { id: 2 },
        { id: 3 },
      ]);

      expect(result).toEqual({ deleted: 3, failed: 0 });

      const ids = await remainingIds();
      expect(ids).toHaveLength(247);
      expect(ids).not.toContain(1);
      expect(ids[0]).toBe(4);
    });

    it("handles a large selection in one statement", async () => {
      const keys = Array.from({ length: 200 }, (_, i) => ({ id: i + 1 }));
      const result = await adapter.deleteRows("perf_rows", keys);

      expect(result.deleted).toBe(200);
      expect(await remainingIds()).toHaveLength(50);
    });

    it("reports rows that did not exist as failed", async () => {
      const result = await adapter.deleteRows("perf_rows", [
        { id: 1 },
        { id: 999_999 },
      ]);

      expect(result.deleted).toBe(1);
      expect(result.failed).toBe(1);
    });

    it("is a no-op for an empty selection", async () => {
      const result = await adapter.deleteRows("perf_rows", []);

      expect(result).toEqual({ deleted: 0, failed: 0 });
      expect(await remainingIds()).toHaveLength(250);
    });

    it("rejects an invalid column name rather than interpolating it", async () => {
      await expect(
        adapter.deleteRows("perf_rows", [{ "id` = 1 OR `1": 1 }])
      ).rejects.toThrow(/Invalid column name/);

      expect(await remainingIds()).toHaveLength(250);
    });

    it("leaves the table untouched when the statement fails", async () => {
      // A column that does not exist makes the whole statement fail; the
      // explicit transaction is what keeps the valid keys in the same batch
      // from being deleted anyway.
      const result = await adapter.deleteRows("perf_rows", [
        { id: 1 },
        { nonexistent_column: 5 },
      ]);

      expect(result.deleted).toBe(0);
      expect(result.error).toBeDefined();
      expect(await remainingIds()).toHaveLength(250);
    });
  });

  describe("estimateAffectedRows", () => {
    async function rowCount(): Promise<number> {
      const result = await adapter.executeQuery(
        "SELECT COUNT(*) AS n FROM perf_rows"
      );
      return Number(result.rows[0].n);
    }

    it("reports every row for an unscoped DELETE, without deleting any", async () => {
      const estimate = await adapter.estimateAffectedRows(
        "DELETE FROM perf_rows"
      );

      expect(estimate).toBe(250);
      // This is the property that makes the preview safe to show.
      expect(await rowCount()).toBe(250);
    });

    it("reports the matching rows for a scoped DELETE, without deleting any", async () => {
      const estimate = await adapter.estimateAffectedRows(
        "DELETE FROM perf_rows WHERE bucket = 'even'"
      );

      // 125 of the 250 rows match, and `bucket` has no index. Reading the DML
      // plan alone would answer 250 here (MySQL reports filtered: 100.00 for
      // DML whatever the predicate); explaining the predicate as a SELECT would
      // answer 25, the optimizer's fixed guess for an unindexed equality. Both
      // regressions are caught by this number.
      expect(estimate).toBe(125);
      expect(await rowCount()).toBe(250);
    });

    it("reports the matching rows for a DELETE scoped by primary key", async () => {
      const estimate = await adapter.estimateAffectedRows(
        "DELETE FROM perf_rows WHERE id <= 60"
      );

      expect(estimate).toBe(60);
      expect(await rowCount()).toBe(250);
    });

    it("reports the matching rows for an UPDATE, without updating any", async () => {
      const estimate = await adapter.estimateAffectedRows(
        "UPDATE perf_rows SET bucket = 'zzz' WHERE bucket = 'odd'"
      );

      expect(estimate).toBe(125);

      const distinct = await adapter.executeQuery(
        "SELECT COUNT(DISTINCT bucket) AS n FROM perf_rows"
      );
      expect(Number(distinct.rows[0].n)).toBe(2);
    });

    it("estimates a SELECT from the plan", async () => {
      const estimate = await adapter.estimateAffectedRows(
        "SELECT * FROM perf_rows"
      );

      // A SELECT preview is not a safety gate, so it pays for no count and
      // takes the planner's figure — which for a full scan is the table size.
      expect(estimate).toBeGreaterThan(0);
    });

    it("returns null rather than a wrong number when the plan cannot be read", async () => {
      // MySQL refuses to plan a DELETE whose subquery reads the target table
      // (ER_UPDATE_TABLE_USED), so there is nothing to derive an answer from.
      const estimate = await adapter.estimateAffectedRows(
        "DELETE FROM perf_rows WHERE bucket IN (SELECT bucket FROM perf_rows WHERE id = 1)"
      );

      expect(estimate).toBeNull();
      expect(await rowCount()).toBe(250);
    });

    it("returns null for a statement the planner rejects", async () => {
      const estimate = await adapter.estimateAffectedRows(
        "DELETE FROM table_that_does_not_exist"
      );

      expect(estimate).toBeNull();
    });

    it("leaves the connection usable after a failed estimate", async () => {
      await adapter.estimateAffectedRows("this is not sql");

      const after = await adapter.executeQuery("SELECT 1 AS ok");
      expect(after.error).toBeUndefined();
      expect(Number(after.rows[0].ok)).toBe(1);
    });
  });
});
