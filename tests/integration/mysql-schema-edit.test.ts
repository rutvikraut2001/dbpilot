import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MySQLAdapter } from "@/lib/adapters/mysql";

/**
 * Editing a table's structure against a real MySQL.
 *
 * Two things differ sharply from PostgreSQL and are the reason this suite
 * exists separately:
 *
 *   - `MODIFY COLUMN` replaces a column's *whole* definition. Changing a type
 *     without restating NOT NULL and DEFAULT silently drops them, so a user
 *     widening an int to a bigint would quietly lose a not-null constraint.
 *   - DDL commits implicitly, so a multi-step edit cannot be rolled back as a
 *     unit. The plan says so rather than implying otherwise.
 *
 * Requires TEST_MYSQL_URL; skipped otherwise.
 */
const CONNECTION_STRING = process.env.TEST_MYSQL_URL;

describe.skipIf(!CONNECTION_STRING)("MySQL schema editing", () => {
  let adapter: MySQLAdapter;

  beforeAll(async () => {
    adapter = new MySQLAdapter(CONNECTION_STRING!);
    await adapter.connect();
  });

  afterAll(async () => {
    if (!adapter) return;
    await adapter.executeQuery("DROP TABLE IF EXISTS edit_rows");
    await adapter.disconnect();
  });

  beforeEach(async () => {
    await adapter.executeQuery("DROP TABLE IF EXISTS edit_rows");
    await adapter.executeQuery(`
      CREATE TABLE edit_rows (
        id int AUTO_INCREMENT PRIMARY KEY,
        name varchar(64) NOT NULL,
        qty int NOT NULL DEFAULT 7
      )
    `);
    await adapter.executeQuery(
      "INSERT INTO edit_rows (name, qty) VALUES ('a', 1), ('b', 2)"
    );
  });

  async function column(name: string) {
    return (await adapter.getTableSchema("edit_rows")).find(
      (c) => c.name === name
    );
  }

  describe("the MODIFY trap", () => {
    it("keeps NOT NULL and DEFAULT when only the type changes", async () => {
      const before = await column("qty");
      expect(before?.nullable).toBe(false);
      expect(before?.defaultValue).toBe("7");

      await adapter.alterTable!("edit_rows", [
        { kind: "setType", name: "qty", type: "bigint" },
      ]);

      const after = await column("qty");
      expect(after?.type).toBe("bigint");
      // Both would be gone had the statement been a bare MODIFY ... bigint.
      expect(after?.nullable).toBe(false);
      expect(after?.defaultValue).toBe("7");
    });

    it("restates the whole definition in the statement", async () => {
      const plan = await adapter.planSchemaChanges!("edit_rows", [
        { kind: "setType", name: "qty", type: "bigint" },
      ]);

      expect(plan.statements[0]).toBe(
        "ALTER TABLE `edit_rows` MODIFY COLUMN `qty` bigint NOT NULL DEFAULT 7"
      );
    });

    it("keeps the type and default when only nullability changes", async () => {
      await adapter.alterTable!("edit_rows", [
        { kind: "setNullable", name: "qty", nullable: true },
      ]);

      const after = await column("qty");
      expect(after?.nullable).toBe(true);
      expect(after?.type).toBe("int");
      expect(after?.defaultValue).toBe("7");
    });

    it("refuses to plan a change to a column that does not exist", async () => {
      await expect(
        adapter.planSchemaChanges!("edit_rows", [
          { kind: "setType", name: "ghost", type: "bigint" },
        ])
      ).rejects.toThrow(/No column named ghost/);
    });
  });

  describe("atomicity", () => {
    it("reports MySQL edits as not atomic", async () => {
      const plan = await adapter.planSchemaChanges!("edit_rows", [
        { kind: "dropColumn", name: "qty" },
      ]);

      expect(plan.atomic).toBe(false);
    });

    it("warns that a failed multi-step edit leaves earlier changes applied", async () => {
      const plan = await adapter.planSchemaChanges!("edit_rows", [
        { kind: "addColumn", column: { name: "a", type: "text" } },
        { kind: "addColumn", column: { name: "b", type: "text" } },
      ]);

      expect(plan.warnings.join(" ")).toMatch(/stay applied/);
    });

    it("does leave earlier changes applied when a later one fails", async () => {
      // Asserted rather than glossed over: this is the behaviour the warning
      // above describes, and the UI has to be honest about it.
      await expect(
        adapter.alterTable!("edit_rows", [
          { kind: "addColumn", column: { name: "ok_col", type: "text" } },
          { kind: "dropColumn", name: "does_not_exist" },
        ])
      ).rejects.toThrow();

      expect(await column("ok_col")).toBeDefined();
    });
  });

  describe("applying changes", () => {
    it("adds a column", async () => {
      await adapter.alterTable!("edit_rows", [
        {
          kind: "addColumn",
          column: { name: "email", type: "varchar(128)", nullable: true },
        },
      ]);

      expect((await column("email"))?.type).toBe("varchar(128)");
    });

    it("drops a column", async () => {
      await adapter.alterTable!("edit_rows", [
        { kind: "dropColumn", name: "qty" },
      ]);

      expect(await column("qty")).toBeUndefined();
    });

    it("renames a column, keeping its data", async () => {
      await adapter.alterTable!("edit_rows", [
        { kind: "renameColumn", from: "qty", to: "quantity" },
      ]);

      expect(await column("qty")).toBeUndefined();

      const rows = await adapter.executeQuery(
        "SELECT quantity FROM edit_rows ORDER BY id"
      );
      expect(rows.rows.map((r) => Number(r.quantity))).toEqual([1, 2]);
    });

    it("sets and drops a default", async () => {
      await adapter.alterTable!("edit_rows", [
        { kind: "setDefault", name: "qty", defaultValue: "42" },
      ]);
      expect((await column("qty"))?.defaultValue).toBe("42");

      await adapter.alterTable!("edit_rows", [
        { kind: "setDefault", name: "qty", defaultValue: null },
      ]);
      expect((await column("qty"))?.defaultValue).toBeUndefined();
    });
  });

  describe("rejecting unsafe input", () => {
    it("rejects a type carrying a second statement", async () => {
      await expect(
        adapter.planSchemaChanges!("edit_rows", [
          {
            kind: "addColumn",
            column: { name: "x", type: "text; DROP TABLE edit_rows" },
          },
        ])
      ).rejects.toThrow(/column type/i);

      expect(await column("qty")).toBeDefined();
    });

    it("rejects an injected column name", async () => {
      await expect(
        adapter.planSchemaChanges!("edit_rows", [
          { kind: "dropColumn", name: "x`; DROP TABLE edit_rows; --" },
        ])
      ).rejects.toThrow(/Invalid column name/);

      const alive = await adapter.executeQuery(
        "SELECT COUNT(*) AS n FROM edit_rows"
      );
      expect(alive.error).toBeUndefined();
    });

    it("accepts a parameterized and unsigned type", async () => {
      const plan = await adapter.planSchemaChanges!("edit_rows", [
        {
          kind: "addColumn",
          column: { name: "amount", type: "decimal(10, 2) unsigned" },
        },
      ]);

      expect(plan.statements[0]).toContain("decimal(10, 2) unsigned");
    });
  });
});
