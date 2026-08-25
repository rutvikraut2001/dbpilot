import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PostgresAdapter } from "@/lib/adapters/postgres";
import { analyzeIndexHealth } from "@/lib/index-health";

/**
 * Index listing and management against a real PostgreSQL.
 *
 * Requires TEST_POSTGRES_URL; skipped otherwise:
 *
 *   docker compose --profile with-db up -d postgres
 *   TEST_POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/testdb npm test
 */
const CONNECTION_STRING = process.env.TEST_POSTGRES_URL;

describe.skipIf(!CONNECTION_STRING)("PostgreSQL indexes", () => {
  let adapter: PostgresAdapter;

  beforeAll(async () => {
    adapter = new PostgresAdapter(CONNECTION_STRING!);
    await adapter.connect();
  });

  afterAll(async () => {
    if (!adapter) return;
    await adapter.executeQuery("DROP TABLE IF EXISTS ix_rows");
    await adapter.disconnect();
  });

  beforeEach(async () => {
    await adapter.executeQuery("DROP TABLE IF EXISTS ix_rows");
    await adapter.executeQuery(`
      CREATE TABLE ix_rows (
        id serial PRIMARY KEY,
        a text,
        b text,
        email text,
        deleted_at timestamptz
      )
    `);
  });

  async function names(): Promise<string[]> {
    return (await adapter.getIndexInfo("ix_rows")).map((index) => index.name);
  }

  describe("getIndexInfo", () => {
    it("reports columns in index key order, not table column order", async () => {
      // The regression this guards: joining pg_attribute and ordering by attnum
      // returns the table's column order, so an index on (b, a) reads back as
      // (a, b) — a different index, and one that would defeat the prefix
      // analysis in index-health.
      await adapter.executeQuery("CREATE INDEX ix_ba ON ix_rows (b, a)");

      const index = (await adapter.getIndexInfo("ix_rows")).find(
        (i) => i.name === "ix_ba"
      );

      expect(index?.columns).toEqual(["b", "a"]);
    });

    it("describes an expression index by its expression", async () => {
      // An expression index has no pg_attribute row to join against at all.
      await adapter.executeQuery(
        "CREATE INDEX ix_lower_email ON ix_rows (lower(email))"
      );

      const index = (await adapter.getIndexInfo("ix_rows")).find(
        (i) => i.name === "ix_lower_email"
      );

      expect(index?.columns).toEqual(["lower(email)"]);
    });

    it("marks the primary key and its uniqueness", async () => {
      const index = (await adapter.getIndexInfo("ix_rows")).find(
        (i) => i.isPrimary
      );

      expect(index?.name).toBe("ix_rows_pkey");
      expect(index?.columns).toEqual(["id"]);
      expect(index?.isUnique).toBe(true);
    });

    it("marks a partial index", async () => {
      await adapter.executeQuery(
        "CREATE INDEX ix_live ON ix_rows (a) WHERE deleted_at IS NULL"
      );

      const indexes = await adapter.getIndexInfo("ix_rows");
      expect(indexes.find((i) => i.name === "ix_live")?.isPartial).toBe(true);
      expect(indexes.find((i) => i.isPrimary)?.isPartial).toBe(false);
    });

    it("reports size, scan count and the engine's own DDL", async () => {
      await adapter.executeQuery("CREATE INDEX ix_a ON ix_rows (a)");

      const index = (await adapter.getIndexInfo("ix_rows")).find(
        (i) => i.name === "ix_a"
      );

      expect(index?.sizeBytes).toBeGreaterThan(0);
      // A number, not undefined: PostgreSQL tracks this, and the health analysis
      // relies on being able to tell zero from unknown.
      expect(typeof index?.scans).toBe("number");
      expect(index?.definition).toContain("CREATE INDEX ix_a");
      expect(index?.type).toBe("btree");
    });

    it("excludes INCLUDE'd payload columns from the key list", async () => {
      // Included columns are stored but cannot be searched on, so treating them
      // as key columns would overstate what the index can serve.
      await adapter.executeQuery(
        "CREATE INDEX ix_covering ON ix_rows (a) INCLUDE (b)"
      );

      const index = (await adapter.getIndexInfo("ix_rows")).find(
        (i) => i.name === "ix_covering"
      );

      expect(index?.columns).toEqual(["a"]);
    });
  });

  describe("createIndex", () => {
    it("creates a plain index and returns it as stored", async () => {
      const created = await adapter.createIndex!("ix_rows", {
        name: "ix_a",
        columns: ["a"],
      });

      expect(created).toMatchObject({
        name: "ix_a",
        columns: ["a"],
        isUnique: false,
        isPrimary: false,
        type: "btree",
      });
      expect(await names()).toContain("ix_a");
    });

    it("creates a unique index", async () => {
      const created = await adapter.createIndex!("ix_rows", {
        name: "ix_email_uq",
        columns: ["email"],
        unique: true,
      });

      expect(created.isUnique).toBe(true);

      await adapter.executeQuery(
        "INSERT INTO ix_rows (email) VALUES ('a@example.com')"
      );
      const duplicate = await adapter.executeQuery(
        "INSERT INTO ix_rows (email) VALUES ('a@example.com')"
      );
      expect(duplicate.error).toBeDefined();
    });

    it("keeps multi-column order as given", async () => {
      const created = await adapter.createIndex!("ix_rows", {
        name: "ix_ba",
        columns: ["b", "a"],
      });

      expect(created.columns).toEqual(["b", "a"]);
    });

    it("honours a non-default access method", async () => {
      const created = await adapter.createIndex!("ix_rows", {
        name: "ix_hash",
        columns: ["a"],
        method: "hash",
      });

      expect(created.type).toBe("hash");
    });

    it("creates a partial index from a predicate", async () => {
      const created = await adapter.createIndex!("ix_rows", {
        name: "ix_live",
        columns: ["a"],
        where: "deleted_at IS NULL",
      });

      expect(created.isPartial).toBe(true);
      expect(created.definition).toContain("WHERE");
    });

    it("builds concurrently when asked", async () => {
      const created = await adapter.createIndex!("ix_rows", {
        name: "ix_concurrent",
        columns: ["a"],
        concurrent: true,
      });

      expect(created.name).toBe("ix_concurrent");
    });

    it("rejects an access method outside the allowlist", async () => {
      await expect(
        adapter.createIndex!("ix_rows", {
          name: "ix_bad",
          columns: ["a"],
          method: "btree; DROP TABLE ix_rows",
        })
      ).rejects.toThrow(/Unsupported index method/);

      expect(await names()).not.toContain("ix_bad");
    });

    it("refuses a predicate carrying a second statement", async () => {
      // The predicate is the one part of the statement built from uninspected
      // user text, and pg's simple query protocol would run the batch.
      await expect(
        adapter.createIndex!("ix_rows", {
          name: "ix_inject",
          columns: ["a"],
          where: "true; DROP TABLE ix_rows; --",
        })
      ).rejects.toThrow(/single expression/);

      // The table is the thing that had to survive.
      const survived = await adapter.executeQuery(
        "SELECT count(*) AS n FROM ix_rows"
      );
      expect(survived.error).toBeUndefined();
    });

    it("rejects an injected index name rather than interpolating it", async () => {
      await expect(
        adapter.createIndex!("ix_rows", {
          name: 'x"; DROP TABLE ix_rows; --',
          columns: ["a"],
        })
      ).rejects.toThrow(/Invalid column name/);

      const survived = await adapter.executeQuery(
        "SELECT count(*) AS n FROM ix_rows"
      );
      expect(survived.error).toBeUndefined();
    });

    it("rejects an injected column name", async () => {
      await expect(
        adapter.createIndex!("ix_rows", {
          name: "ix_bad",
          columns: ['a"); DROP TABLE ix_rows; --'],
        })
      ).rejects.toThrow(/Invalid column name/);
    });

    it("requires at least one column", async () => {
      await expect(
        adapter.createIndex!("ix_rows", { name: "ix_empty", columns: [] })
      ).rejects.toThrow(/at least one column/);
    });

    it("surfaces the engine's error for a duplicate name", async () => {
      await adapter.createIndex!("ix_rows", { name: "ix_a", columns: ["a"] });

      await expect(
        adapter.createIndex!("ix_rows", { name: "ix_a", columns: ["b"] })
      ).rejects.toThrow(/already exists/);
    });

    it("surfaces the engine's error for a column that does not exist", async () => {
      await expect(
        adapter.createIndex!("ix_rows", {
          name: "ix_ghost",
          columns: ["not_a_column"],
        })
      ).rejects.toThrow();
    });
  });

  describe("dropIndex", () => {
    it("drops an index and reports it", async () => {
      await adapter.createIndex!("ix_rows", { name: "ix_a", columns: ["a"] });

      expect(await adapter.dropIndex!("ix_rows", "ix_a")).toBe(true);
      expect(await names()).not.toContain("ix_a");
    });

    it("returns false for an index that does not exist", async () => {
      expect(await adapter.dropIndex!("ix_rows", "ix_missing")).toBe(false);
    });

    it("refuses to drop the primary key", async () => {
      await expect(
        adapter.dropIndex!("ix_rows", "ix_rows_pkey")
      ).rejects.toThrow(/primary key/);

      expect(await names()).toContain("ix_rows_pkey");
    });

    it("refuses an index belonging to a different table", async () => {
      // PostgreSQL index names are schema-scoped, so a bare DROP INDEX would
      // happily drop another table's index. The table argument has to matter.
      await adapter.executeQuery("DROP TABLE IF EXISTS ix_other");
      await adapter.executeQuery("CREATE TABLE ix_other (id int, x text)");
      await adapter.executeQuery("CREATE INDEX ix_other_x ON ix_other (x)");

      try {
        expect(await adapter.dropIndex!("ix_rows", "ix_other_x")).toBe(false);

        const stillThere = await adapter.getIndexInfo("ix_other");
        expect(stillThere.map((i) => i.name)).toContain("ix_other_x");
      } finally {
        await adapter.executeQuery("DROP TABLE IF EXISTS ix_other");
      }
    });

    it("rejects an injected index name", async () => {
      await expect(
        adapter.dropIndex!("ix_rows", 'ix_a"; DROP TABLE ix_rows; --')
      ).rejects.toThrow(/Invalid column name/);
    });
  });

  describe("health analysis over real indexes", () => {
    it("flags a leading-prefix index as redundant", async () => {
      await adapter.createIndex!("ix_rows", {
        name: "ix_ab",
        columns: ["a", "b"],
      });
      await adapter.createIndex!("ix_rows", { name: "ix_a", columns: ["a"] });

      const issues = analyzeIndexHealth(await adapter.getIndexInfo("ix_rows"));

      expect(issues).toContainEqual(
        expect.objectContaining({
          kind: "redundant",
          indexName: "ix_a",
          relatedIndex: "ix_ab",
        })
      );
    });

    it("does not flag a full index because a partial one covers some rows", async () => {
      await adapter.createIndex!("ix_rows", { name: "ix_a", columns: ["a"] });
      await adapter.createIndex!("ix_rows", {
        name: "ix_a_live",
        columns: ["a"],
        where: "deleted_at IS NULL",
      });

      const issues = analyzeIndexHealth(await adapter.getIndexInfo("ix_rows"));

      expect(
        issues.filter(
          (issue) =>
            issue.indexName === "ix_a" &&
            (issue.kind === "duplicate" || issue.kind === "redundant")
        )
      ).toEqual([]);
    });
  });
});
