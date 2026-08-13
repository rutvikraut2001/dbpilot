import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgresAdapter } from "@/lib/adapters/postgres";

/**
 * Proves that read-only mode is enforced by PostgreSQL itself, not by inspecting
 * the query text. Every case below is executed straight through the adapter,
 * bypassing the API route's keyword pre-flight entirely — so what's being tested
 * is the `SET TRANSACTION READ ONLY` guarantee on its own.
 *
 * Requires a scratch PostgreSQL. Skipped when TEST_POSTGRES_URL is unset:
 *
 *   docker compose --profile with-db up -d postgres
 *   TEST_POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/testdb npm test
 */
const CONNECTION_STRING = process.env.TEST_POSTGRES_URL;

describe.skipIf(!CONNECTION_STRING)("PostgreSQL engine-level read-only", () => {
  let adapter: PostgresAdapter;

  beforeAll(async () => {
    adapter = new PostgresAdapter(CONNECTION_STRING!);
    await adapter.connect();

    await adapter.executeQuery("DROP TABLE IF EXISTS ro_users");
    await adapter.executeQuery(
      "CREATE TABLE ro_users (id serial PRIMARY KEY, name text)"
    );
    await adapter.executeQuery(
      "INSERT INTO ro_users (name) VALUES ('alice'), ('bob'), ('carol')"
    );
    await adapter.executeQuery(`
      CREATE OR REPLACE FUNCTION ro_sneaky_delete() RETURNS int
      LANGUAGE plpgsql VOLATILE AS $$
      BEGIN DELETE FROM ro_users WHERE name = 'alice'; RETURN 1; END $$
    `);
  });

  afterAll(async () => {
    if (!adapter) return;
    await adapter.executeQuery("DROP FUNCTION IF EXISTS ro_sneaky_delete()");
    await adapter.executeQuery("DROP TABLE IF EXISTS ro_users");
    await adapter.disconnect();
  });

  async function rowCount(): Promise<number> {
    const result = await adapter.executeQuery(
      "SELECT count(*)::int AS n FROM ro_users"
    );
    return result.rows[0].n as number;
  }

  it("permits reads", async () => {
    const result = await adapter.executeQuery("SELECT * FROM ro_users", {
      readOnly: true,
    });

    expect(result.error).toBeUndefined();
    expect(result.rows).toHaveLength(3);
  });

  it.each([
    ["DELETE", "DELETE FROM ro_users"],
    ["UPDATE", "UPDATE ro_users SET name = 'zzz'"],
    ["INSERT", "INSERT INTO ro_users (name) VALUES ('dave')"],
    ["TRUNCATE", "TRUNCATE ro_users"],
    ["DROP TABLE", "DROP TABLE ro_users"],
    ["CREATE TABLE", "CREATE TABLE ro_other (id int)"],
    ["ALTER TABLE", "ALTER TABLE ro_users ADD COLUMN extra int"],
    [
      "data-modifying CTE",
      "WITH gone AS (DELETE FROM ro_users RETURNING *) SELECT * FROM gone",
    ],
    [
      "DO block",
      "DO $$ BEGIN DELETE FROM ro_users; END $$",
    ],
    [
      "write inside a VOLATILE function",
      "SELECT ro_sneaky_delete()",
    ],
    [
      "write as the second statement of a batch",
      "SELECT 1; DELETE FROM ro_users;",
    ],
    ["SELECT INTO", "SELECT * INTO ro_backup FROM ro_users"],
  ])("refuses %s", async (_label, sql) => {
    const result = await adapter.executeQuery(sql, { readOnly: true });

    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/read-only transaction/i);
  });

  it("leaves the data untouched after every refused write", async () => {
    expect(await rowCount()).toBe(3);

    const names = await adapter.executeQuery(
      "SELECT name FROM ro_users ORDER BY id"
    );
    expect(names.rows.map((r) => r.name)).toEqual(["alice", "bob", "carol"]);
  });

  it("still allows writes when read-only is off", async () => {
    const result = await adapter.executeQuery(
      "UPDATE ro_users SET name = 'alice2' WHERE name = 'alice'"
    );

    expect(result.error).toBeUndefined();
    expect(await rowCount()).toBe(3);

    // Restore for idempotent reruns.
    await adapter.executeQuery(
      "UPDATE ro_users SET name = 'alice' WHERE name = 'alice2'"
    );
  });

  it("does not leave the pooled connection stuck in a transaction", async () => {
    // A read-only failure must roll back and release, or the next query on that
    // pooled connection would fail with "current transaction is aborted".
    await adapter.executeQuery("DELETE FROM ro_users", { readOnly: true });

    const after = await adapter.executeQuery("SELECT 1 AS ok");
    expect(after.error).toBeUndefined();
    expect(after.rows[0].ok).toBe(1);
  });
});
