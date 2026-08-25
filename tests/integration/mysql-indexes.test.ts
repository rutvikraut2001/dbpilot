import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MySQLAdapter } from "@/lib/adapters/mysql";
import { analyzeIndexHealth } from "@/lib/index-health";

/**
 * Index listing and management against a real MySQL — the same contract the
 * PostgreSQL suite pins, plus the places MySQL differs: no partial indexes, and
 * FULLTEXT/SPATIAL spelled as a prefix to CREATE rather than a USING clause.
 *
 * Requires TEST_MYSQL_URL; skipped otherwise.
 */
const CONNECTION_STRING = process.env.TEST_MYSQL_URL;

describe.skipIf(!CONNECTION_STRING)("MySQL indexes", () => {
  let adapter: MySQLAdapter;

  beforeAll(async () => {
    adapter = new MySQLAdapter(CONNECTION_STRING!);
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
        id int AUTO_INCREMENT PRIMARY KEY,
        a varchar(64),
        b varchar(64),
        email varchar(128),
        body text
      )
    `);
  });

  async function names(): Promise<string[]> {
    return (await adapter.getIndexInfo("ix_rows")).map((index) => index.name);
  }

  describe("getIndexInfo", () => {
    it("reports columns in index key order", async () => {
      await adapter.executeQuery("CREATE INDEX ix_ba ON ix_rows (b, a)");

      const index = (await adapter.getIndexInfo("ix_rows")).find(
        (i) => i.name === "ix_ba"
      );

      expect(index?.columns).toEqual(["b", "a"]);
    });

    it("marks the primary key, which MySQL names PRIMARY", async () => {
      const index = (await adapter.getIndexInfo("ix_rows")).find(
        (i) => i.isPrimary
      );

      expect(index?.name).toBe("PRIMARY");
      expect(index?.columns).toEqual(["id"]);
      expect(index?.isUnique).toBe(true);
    });

    it("never marks an index partial, because MySQL has none", async () => {
      await adapter.executeQuery("CREATE INDEX ix_a ON ix_rows (a)");

      const indexes = await adapter.getIndexInfo("ix_rows");
      expect(indexes.every((index) => index.isPartial === false)).toBe(true);
    });

    it("reconstructs a definition, since MySQL has no pg_get_indexdef", async () => {
      await adapter.executeQuery("CREATE UNIQUE INDEX ix_email ON ix_rows (email)");

      const indexes = await adapter.getIndexInfo("ix_rows");

      expect(indexes.find((i) => i.name === "ix_email")?.definition).toBe(
        "CREATE UNIQUE INDEX `ix_email` ON `ix_rows` (`email`) USING BTREE"
      );
      expect(indexes.find((i) => i.isPrimary)?.definition).toBe(
        "PRIMARY KEY (`id`)"
      );
    });

    it("reports size and scan counts where the server exposes them", async () => {
      await adapter.executeQuery("CREATE INDEX ix_a ON ix_rows (a)");
      await adapter.executeQuery("ANALYZE TABLE ix_rows");

      const index = (await adapter.getIndexInfo("ix_rows")).find(
        (i) => i.name === "ix_a"
      );

      // Both come from optional sources (mysql.* privileges, performance_schema)
      // and are undefined rather than zero when unavailable — so this asserts
      // the shape holds either way, and a number when present is positive.
      expect(index?.sizeBytes === undefined || index.sizeBytes > 0).toBe(true);
      expect(index?.scans === undefined || index.scans >= 0).toBe(true);
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
      });
      expect(await names()).toContain("ix_a");
    });

    it("creates a unique index that the server then enforces", async () => {
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

    it("creates a FULLTEXT index", async () => {
      const created = await adapter.createIndex!("ix_rows", {
        name: "ix_body",
        columns: ["body"],
        method: "fulltext",
      });

      expect(created.type).toBe("FULLTEXT");
      expect(created.definition).toContain("CREATE FULLTEXT INDEX");
    });

    it("refuses a UNIQUE FULLTEXT index", async () => {
      await expect(
        adapter.createIndex!("ix_rows", {
          name: "ix_bad",
          columns: ["body"],
          method: "fulltext",
          unique: true,
        })
      ).rejects.toThrow(/cannot be UNIQUE/);
    });

    it("builds online when asked", async () => {
      const created = await adapter.createIndex!("ix_rows", {
        name: "ix_online",
        columns: ["a"],
        concurrent: true,
      });

      expect(created.name).toBe("ix_online");
    });

    it("refuses a partial index rather than silently building a full one", async () => {
      // Approximating this would cost far more disk and write time than the
      // caller asked for, so the limitation is reported instead.
      await expect(
        adapter.createIndex!("ix_rows", {
          name: "ix_partial",
          columns: ["a"],
          where: "b IS NOT NULL",
        })
      ).rejects.toThrow(/does not support partial indexes/);

      expect(await names()).not.toContain("ix_partial");
    });

    it("rejects a method outside the allowlist", async () => {
      await expect(
        adapter.createIndex!("ix_rows", {
          name: "ix_bad",
          columns: ["a"],
          method: "gin",
        })
      ).rejects.toThrow(/Unsupported index method/);
    });

    it("rejects an injected index name rather than interpolating it", async () => {
      await expect(
        adapter.createIndex!("ix_rows", {
          name: "x`; DROP TABLE ix_rows; --",
          columns: ["a"],
        })
      ).rejects.toThrow(/Invalid column name/);

      const survived = await adapter.executeQuery(
        "SELECT COUNT(*) AS n FROM ix_rows"
      );
      expect(survived.error).toBeUndefined();
    });

    it("rejects an injected column name", async () => {
      await expect(
        adapter.createIndex!("ix_rows", {
          name: "ix_bad",
          columns: ["a`); DROP TABLE ix_rows; --"],
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
      ).rejects.toThrow(/Duplicate key name/i);
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

    it("refuses to drop PRIMARY", async () => {
      await expect(adapter.dropIndex!("ix_rows", "PRIMARY")).rejects.toThrow(
        /primary key/
      );

      expect(await names()).toContain("PRIMARY");
    });

    it("rejects an injected index name", async () => {
      await expect(
        adapter.dropIndex!("ix_rows", "ix_a` ON `ix_rows`; DROP TABLE `ix_rows")
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

    it("flags a duplicate index", async () => {
      await adapter.createIndex!("ix_rows", { name: "ix_a1", columns: ["a"] });
      await adapter.createIndex!("ix_rows", { name: "ix_a2", columns: ["a"] });

      const issues = analyzeIndexHealth(await adapter.getIndexInfo("ix_rows"));

      expect(
        issues.filter((issue) => issue.kind === "duplicate")
      ).toHaveLength(1);
    });

    it("never suggests dropping PRIMARY", async () => {
      await adapter.createIndex!("ix_rows", { name: "ix_id", columns: ["id"] });

      const issues = analyzeIndexHealth(await adapter.getIndexInfo("ix_rows"));

      expect(issues.some((issue) => issue.indexName === "PRIMARY")).toBe(false);
    });
  });
});
