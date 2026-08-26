import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MySQLAdapter } from "@/lib/adapters/mysql";

/**
 * Connecting without naming a database, then listing, creating and switching.
 *
 * MySQL is the clearest case of the state this feature exists for: it can
 * connect to the server with genuinely *no* database selected, where PostgreSQL
 * always resolves one. `getCurrentDatabase()` returning null is therefore a real
 * value here, and the tests below pin that it stays usable rather than throwing.
 *
 * Requires TEST_MYSQL_URL; the suite derives a server-only URL from it.
 */
const CONNECTION_STRING = process.env.TEST_MYSQL_URL;

function serverOnlyUrl(connectionString: string): string {
  const url = new URL(connectionString);
  url.pathname = "/";
  return url.toString();
}

const TEMP_DATABASE = "dbpilot_test-db.1";

describe.skipIf(!CONNECTION_STRING)("MySQL databases", () => {
  let adapter: MySQLAdapter;

  beforeAll(async () => {
    adapter = new MySQLAdapter(serverOnlyUrl(CONNECTION_STRING!));
    await adapter.connect();
    await adapter.executeQuery(`DROP DATABASE IF EXISTS \`${TEMP_DATABASE}\``);
  });

  afterAll(async () => {
    if (!adapter) return;
    await adapter.executeQuery(`DROP DATABASE IF EXISTS \`${TEMP_DATABASE}\``);
    await adapter.disconnect();
  });

  describe("connecting without a database", () => {
    it("connects with none selected", async () => {
      // Previously this threw: the adapter demanded a database in the URL, which
      // is exactly what stopped a user reaching the picker.
      expect(adapter.isConnected()).toBe(true);
      expect(adapter.getCurrentDatabase()).toBeNull();
    });

    it("returns an empty table list rather than failing", async () => {
      // The UI shows "no database selected" for this; an exception would surface
      // as a generic error instead.
      expect(await adapter.getTables()).toEqual([]);
    });

    it("can still run server-level queries", async () => {
      const result = await adapter.executeQuery("SELECT VERSION() AS v");

      expect(result.error).toBeUndefined();
      expect(result.rows[0].v).toBeTruthy();
    });
  });

  describe("listDatabases", () => {
    it("lists the databases on the server", async () => {
      const names = (await adapter.listDatabases()).map((d) => d.name);

      expect(names).toContain("mysql");
      expect(names).toContain("information_schema");
    });

    it("marks engine-owned databases as system", async () => {
      const databases = await adapter.listDatabases();
      const system = databases.filter((d) => d.isSystem).map((d) => d.name);

      expect(system).toEqual(
        expect.arrayContaining([
          "information_schema",
          "mysql",
          "performance_schema",
          "sys",
        ])
      );
    });

    it("marks nothing as current while none is selected", async () => {
      const databases = await adapter.listDatabases();

      expect(databases.some((d) => d.isCurrent)).toBe(false);
    });
  });

  describe("createDatabase", () => {
    it("creates a database whose name no identifier pattern would accept", async () => {
      await adapter.createDatabase(TEMP_DATABASE);

      const names = (await adapter.listDatabases()).map((d) => d.name);
      expect(names).toContain(TEMP_DATABASE);
    });

    it("surfaces the engine's error for a duplicate name", async () => {
      await expect(adapter.createDatabase(TEMP_DATABASE)).rejects.toThrow(
        /exists/i
      );
    });

    it("refuses a name that quoting cannot make safe", async () => {
      await expect(adapter.createDatabase("has\tTab")).rejects.toThrow(
        /control characters/i
      );
    });

    it("neutralises a name built to break out of the identifier", async () => {
      await adapter
        .createDatabase("x`; DROP DATABASE testdb; --")
        .catch(() => {});

      // The doubling escape means that was at most one oddly-named database,
      // never two statements.
      const names = (await adapter.listDatabases()).map((d) => d.name);
      expect(names).toContain("mysql");
    });
  });

  describe("useDatabase", () => {
    it("switches from no database to one", async () => {
      await adapter.useDatabase(TEMP_DATABASE);

      expect(adapter.getCurrentDatabase()).toBe(TEMP_DATABASE);
      const confirmed = await adapter.executeQuery("SELECT DATABASE() AS db");
      expect(confirmed.rows[0].db).toBe(TEMP_DATABASE);
    });

    it("shows the new database's tables, not the old one's", async () => {
      await adapter.useDatabase(TEMP_DATABASE);
      await adapter.executeQuery("CREATE TABLE only_here (id int)");

      expect((await adapter.getTables()).map((t) => t.name)).toContain(
        "only_here"
      );

      await adapter.useDatabase("testdb");
      expect((await adapter.getTables()).map((t) => t.name)).not.toContain(
        "only_here"
      );
    });

    it("marks the selected database as current in the list", async () => {
      await adapter.useDatabase("testdb");
      const databases = await adapter.listDatabases();

      expect(databases.filter((d) => d.isCurrent).map((d) => d.name)).toEqual([
        "testdb",
      ]);
    });

    it("stays on the working database when the switch fails", async () => {
      await adapter.useDatabase("testdb");

      await expect(
        adapter.useDatabase("dbpilot_definitely_missing")
      ).rejects.toThrow();

      expect(adapter.getCurrentDatabase()).toBe("testdb");
      expect((await adapter.executeQuery("SELECT 1 AS ok")).error).toBeUndefined();
    });
  });
});
