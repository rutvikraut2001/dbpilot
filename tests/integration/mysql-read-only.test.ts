import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MySQLAdapter } from "@/lib/adapters/mysql";

/**
 * Proves that read-only mode is enforced by MySQL itself, not by inspecting the
 * query text. Every case below is executed straight through the adapter,
 * bypassing the API route's keyword pre-flight entirely — so what's being tested
 * is the `START TRANSACTION READ ONLY` guarantee on its own.
 *
 * Requires a scratch MySQL. Skipped when TEST_MYSQL_URL is unset:
 *
 *   docker compose --profile with-db up -d mysql
 *   TEST_MYSQL_URL=mysql://root:mysql@localhost:3306/testdb npm test
 */
const CONNECTION_STRING = process.env.TEST_MYSQL_URL;

describe.skipIf(!CONNECTION_STRING)("MySQL engine-level read-only", () => {
  let adapter: MySQLAdapter;

  beforeAll(async () => {
    adapter = new MySQLAdapter(CONNECTION_STRING!);
    await adapter.connect();

    await adapter.executeQuery("DROP TABLE IF EXISTS ro_users");
    await adapter.executeQuery(
      "CREATE TABLE ro_users (id int AUTO_INCREMENT PRIMARY KEY, name varchar(64))"
    );
    await adapter.executeQuery(
      "INSERT INTO ro_users (name) VALUES ('alice'), ('bob'), ('carol')"
    );

    // A procedure body is opaque to any keyword check: the CALL that runs it
    // says nothing about the DELETE inside.
    await adapter.executeQuery("DROP PROCEDURE IF EXISTS ro_sneaky_delete");
    await adapter.executeQuery(`
      CREATE PROCEDURE ro_sneaky_delete()
      BEGIN DELETE FROM ro_users WHERE name = 'alice'; END
    `);
  });

  afterAll(async () => {
    if (!adapter) return;
    await adapter.executeQuery("DROP PROCEDURE IF EXISTS ro_sneaky_delete");
    await adapter.executeQuery("DROP TABLE IF EXISTS ro_users");
    await adapter.disconnect();
  });

  async function rowCount(): Promise<number> {
    const result = await adapter.executeQuery(
      "SELECT COUNT(*) AS n FROM ro_users"
    );
    return Number(result.rows[0].n);
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
    ["REPLACE", "REPLACE INTO ro_users (id, name) VALUES (1, 'dave')"],
    [
      "INSERT ... ON DUPLICATE KEY UPDATE",
      "INSERT INTO ro_users (id, name) VALUES (1, 'dave') ON DUPLICATE KEY UPDATE name = 'dave'",
    ],
    ["TRUNCATE", "TRUNCATE TABLE ro_users"],
    ["DROP TABLE", "DROP TABLE ro_users"],
    ["CREATE TABLE", "CREATE TABLE ro_other (id int)"],
    ["ALTER TABLE", "ALTER TABLE ro_users ADD COLUMN extra int"],
    ["CREATE INDEX", "CREATE INDEX ro_users_name ON ro_users (name)"],
    ["RENAME TABLE", "RENAME TABLE ro_users TO ro_users_moved"],
    ["write inside a stored procedure", "CALL ro_sneaky_delete()"],
    ["GRANT", "GRANT SELECT ON *.* TO CURRENT_USER"],
  ])("refuses %s", async (_label, sql) => {
    const result = await adapter.executeQuery(sql, { readOnly: true });

    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/read only transaction|read-only/i);
  });

  it("refuses a write smuggled in as a second statement", async () => {
    // The driver runs with multipleStatements off, so this is rejected before it
    // reaches the transaction at all — a second, independent line of defence.
    const result = await adapter.executeQuery("SELECT 1; DELETE FROM ro_users;", {
      readOnly: true,
    });

    expect(result.error).toBeDefined();
    expect(await rowCount()).toBe(3);
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

  it("does not leave the pooled connection read-only or mid-transaction", async () => {
    // The read-only path sets a session default and opens a transaction. If
    // either survived release, the next write on that pooled connection would
    // be refused — and it is the same small pool, so it would be reused.
    await adapter.executeQuery("DELETE FROM ro_users", { readOnly: true });

    const after = await adapter.executeQuery(
      "INSERT INTO ro_users (name) VALUES ('dave')"
    );
    expect(after.error).toBeUndefined();

    const deleted = await adapter.executeQuery(
      "DELETE FROM ro_users WHERE name = 'dave'"
    );
    expect(deleted.error).toBeUndefined();
    expect(await rowCount()).toBe(3);
  });

  it("reports a read-only failure without poisoning later reads", async () => {
    await adapter.executeQuery("DROP TABLE ro_users", { readOnly: true });

    const after = await adapter.executeQuery("SELECT 1 AS ok", {
      readOnly: true,
    });
    expect(after.error).toBeUndefined();
    expect(Number(after.rows[0].ok)).toBe(1);
  });
});
