import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PostgresAdapter } from "@/lib/adapters/postgres";

/**
 * Editing a table's structure against a real PostgreSQL.
 *
 * The property that distinguishes this adapter from the MySQL one is
 * transactional DDL: a multi-step edit either lands whole or not at all. That is
 * what makes applying several changes at once safe here, so it is tested
 * directly rather than assumed.
 *
 * Requires TEST_POSTGRES_URL; skipped otherwise.
 */
const CONNECTION_STRING = process.env.TEST_POSTGRES_URL;

describe.skipIf(!CONNECTION_STRING)("PostgreSQL schema editing", () => {
  let adapter: PostgresAdapter;

  beforeAll(async () => {
    adapter = new PostgresAdapter(CONNECTION_STRING!);
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
        id serial PRIMARY KEY,
        name text NOT NULL,
        qty integer NOT NULL DEFAULT 7
      )
    `);
    await adapter.executeQuery(
      "INSERT INTO edit_rows (name, qty) VALUES ('a', 1), ('b', 2)"
    );
  });

  async function columns() {
    return adapter.getTableSchema("edit_rows");
  }

  async function column(name: string) {
    return (await columns()).find((c) => c.name === name);
  }

  describe("planSchemaChanges", () => {
    it("renders statements without running them", async () => {
      const plan = await adapter.planSchemaChanges!("edit_rows", [
        { kind: "dropColumn", name: "qty" },
      ]);

      expect(plan.statements).toEqual([
        'ALTER TABLE "edit_rows" DROP COLUMN "qty"',
      ]);
      // Planning must not be a dry run that actually runs.
      expect(await column("qty")).toBeDefined();
    });

    it("reports PostgreSQL edits as atomic", async () => {
      const plan = await adapter.planSchemaChanges!("edit_rows", [
        { kind: "dropColumn", name: "qty" },
      ]);

      expect(plan.atomic).toBe(true);
    });

    it("warns that a type change rewrites the table and takes an exclusive lock", async () => {
      const plan = await adapter.planSchemaChanges!("edit_rows", [
        { kind: "setType", name: "qty", type: "bigint" },
      ]);

      expect(plan.warnings.join(" ")).toMatch(/ACCESS EXCLUSIVE/);
    });

    it("warns that dropping a column discards its data", async () => {
      const plan = await adapter.planSchemaChanges!("edit_rows", [
        { kind: "dropColumn", name: "qty" },
      ]);

      expect(plan.warnings.join(" ")).toMatch(/permanently/i);
    });

    it("warns that NOT NULL without a default fails on a non-empty table", async () => {
      const plan = await adapter.planSchemaChanges!("edit_rows", [
        {
          kind: "addColumn",
          column: { name: "code", type: "text", nullable: false },
        },
      ]);

      expect(plan.warnings.join(" ")).toMatch(/NOT NULL without a default/);
    });
  });

  describe("applying changes", () => {
    it("adds a column with a type, default and nullability", async () => {
      await adapter.alterTable!("edit_rows", [
        {
          kind: "addColumn",
          column: {
            name: "code",
            type: "varchar(16)",
            nullable: false,
            defaultValue: "'none'",
          },
        },
      ]);

      const added = await column("code");
      expect(added?.type).toBe("character varying");
      expect(added?.nullable).toBe(false);
      expect(added?.defaultValue).toContain("none");
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
      expect(await column("quantity")).toBeDefined();

      const rows = await adapter.executeQuery(
        "SELECT quantity FROM edit_rows ORDER BY id"
      );
      expect(rows.rows.map((r) => Number(r.quantity))).toEqual([1, 2]);
    });

    it("changes a column type", async () => {
      await adapter.alterTable!("edit_rows", [
        { kind: "setType", name: "qty", type: "bigint" },
      ]);

      expect((await column("qty"))?.type).toBe("bigint");
    });

    it("toggles nullability", async () => {
      await adapter.alterTable!("edit_rows", [
        { kind: "setNullable", name: "name", nullable: true },
      ]);
      expect((await column("name"))?.nullable).toBe(true);

      await adapter.alterTable!("edit_rows", [
        { kind: "setNullable", name: "name", nullable: false },
      ]);
      expect((await column("name"))?.nullable).toBe(false);
    });

    it("sets and drops a default", async () => {
      await adapter.alterTable!("edit_rows", [
        { kind: "setDefault", name: "qty", defaultValue: "42" },
      ]);
      expect((await column("qty"))?.defaultValue).toContain("42");

      await adapter.alterTable!("edit_rows", [
        { kind: "setDefault", name: "qty", defaultValue: null },
      ]);
      expect((await column("qty"))?.defaultValue).toBeUndefined();
    });

    it("applies several changes in one edit", async () => {
      await adapter.alterTable!("edit_rows", [
        { kind: "addColumn", column: { name: "email", type: "text" } },
        { kind: "renameColumn", from: "qty", to: "quantity" },
        { kind: "setType", name: "quantity", type: "bigint" },
      ]);

      const names = (await columns()).map((c) => c.name);
      expect(names).toContain("email");
      expect(names).toContain("quantity");
      expect((await column("quantity"))?.type).toBe("bigint");
    });
  });

  describe("atomicity", () => {
    it("rolls the whole edit back when a later change fails", async () => {
      // The reason PostgreSQL can offer multi-change edits at all. Without the
      // transaction the table would be left with `ok_col` added and nothing
      // else — a shape the user never asked for.
      await expect(
        adapter.alterTable!("edit_rows", [
          { kind: "addColumn", column: { name: "ok_col", type: "text" } },
          { kind: "dropColumn", name: "does_not_exist" },
        ])
      ).rejects.toThrow();

      expect(await column("ok_col")).toBeUndefined();
      expect(await column("qty")).toBeDefined();
    });

    it("leaves the connection usable after a failed edit", async () => {
      await adapter
        .alterTable!("edit_rows", [
          { kind: "dropColumn", name: "does_not_exist" },
        ])
        .catch(() => {});

      const after = await adapter.executeQuery("SELECT 1 AS ok");
      expect(after.error).toBeUndefined();
    });

    it("restores the query ceiling after an edit", async () => {
      // Type changes run with `statement_timeout = 0`; leaking that back into
      // the pool would remove the ceiling from every later query.
      await adapter.alterTable!("edit_rows", [
        { kind: "setType", name: "qty", type: "bigint" },
      ]);

      const shown = await adapter.executeQuery("SHOW statement_timeout");
      expect(shown.rows[0].statement_timeout).toBe("30s");
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
      ).rejects.toThrow(/Invalid column type/);

      expect(await column("qty")).toBeDefined();
    });

    it("rejects a well-formed type that is not on the allowlist", async () => {
      // A user-defined type reaches this message rather than a generic one, and
      // is pointed at the query editor where the whole statement is visible.
      await expect(
        adapter.planSchemaChanges!("edit_rows", [
          { kind: "setType", name: "qty", type: "order_status" },
        ])
      ).rejects.toThrow(/Unsupported column type/);
    });

    it("rejects a type whose shape is not a type at all", async () => {
      await expect(
        adapter.planSchemaChanges!("edit_rows", [
          { kind: "setType", name: "qty", type: "int) ; DROP TABLE edit_rows --" },
        ])
      ).rejects.toThrow(/Invalid column type/);
    });

    it("rejects an injected column name", async () => {
      await expect(
        adapter.planSchemaChanges!("edit_rows", [
          { kind: "dropColumn", name: 'x"; DROP TABLE edit_rows; --' },
        ])
      ).rejects.toThrow(/Invalid column name/);

      const alive = await adapter.executeQuery(
        "SELECT count(*) AS n FROM edit_rows"
      );
      expect(alive.error).toBeUndefined();
    });

    it("accepts a parameterized type", async () => {
      const plan = await adapter.planSchemaChanges!("edit_rows", [
        {
          kind: "addColumn",
          column: { name: "amount", type: "numeric(10, 2)" },
        },
      ]);

      expect(plan.statements[0]).toContain("numeric(10, 2)");
    });
  });
});
