import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgresAdapter } from "@/lib/adapters/postgres";

/**
 * Connecting without naming a database, then listing, creating and switching.
 *
 * The behaviour under test is the one that made this feature necessary: `pg`
 * silently defaults a URL with no database to one named after the *user*, so a
 * connection "succeeds" and shows an empty table list belonging to a database
 * the user never chose.
 *
 * Requires TEST_POSTGRES_URL. The suite derives a server-only URL from it, so
 * the variable can keep naming a database as the other suites need.
 */
const CONNECTION_STRING = process.env.TEST_POSTGRES_URL;

/** The same server, with no database named. */
function serverOnlyUrl(connectionString: string): string {
  const url = new URL(connectionString);
  url.pathname = "/";
  return url.toString();
}

const TEMP_DATABASE = "dbpilot_test-db.1";
/**
 * A second scratch database, so the "tables do not leak between databases" test
 * compares two databases this suite owns.
 *
 * Using a shared one such as `postgres` makes the assertion depend on whatever
 * other suites are doing concurrently — and it does: the index suite creates and
 * drops tables there, which is enough to break a table listing mid-scan.
 */
const OTHER_DATABASE = "dbpilot_test-db.2";

describe.skipIf(!CONNECTION_STRING)("PostgreSQL databases", () => {
  let adapter: PostgresAdapter;

  beforeAll(async () => {
    adapter = new PostgresAdapter(serverOnlyUrl(CONNECTION_STRING!));
    await adapter.connect();
    await adapter.executeQuery(`DROP DATABASE IF EXISTS "${TEMP_DATABASE}"`);
    await adapter.executeQuery(`DROP DATABASE IF EXISTS "${OTHER_DATABASE}"`);
  });

  afterAll(async () => {
    if (!adapter) return;
    // Cannot drop the database currently connected to.
    await adapter.useDatabase("postgres").catch(() => {});
    await adapter.executeQuery(`DROP DATABASE IF EXISTS "${TEMP_DATABASE}"`);
    await adapter.executeQuery(`DROP DATABASE IF EXISTS "${OTHER_DATABASE}"`);
    await adapter.disconnect();
  });

  describe("connecting without a database", () => {
    it("connects and reports where it actually landed", async () => {
      // Not null: pg picks a default. The point is that the adapter reports the
      // truth rather than echoing a connection string that names nothing.
      const current = adapter.getCurrentDatabase();

      expect(current).toBeTruthy();
      const confirmed = await adapter.executeQuery(
        "SELECT current_database() AS db"
      );
      expect(confirmed.rows[0].db).toBe(current);
    });
  });

  describe("listDatabases", () => {
    it("lists the databases on the server", async () => {
      const databases = await adapter.listDatabases();

      expect(databases.length).toBeGreaterThan(0);
      expect(databases.map((d) => d.name)).toContain("postgres");
    });

    it("marks exactly one database as current, and it is the current one", async () => {
      const databases = await adapter.listDatabases();
      const current = databases.filter((d) => d.isCurrent);

      expect(current).toHaveLength(1);
      expect(current[0].name).toBe(adapter.getCurrentDatabase());
    });

    it("marks engine-owned databases as system", async () => {
      const databases = await adapter.listDatabases();

      expect(databases.find((d) => d.name === "postgres")?.isSystem).toBe(true);
      // template0 refuses connections, so offering it would only ever fail.
      expect(databases.map((d) => d.name)).not.toContain("template0");
    });

    it("reports a size for each database", async () => {
      const databases = await adapter.listDatabases();

      expect(databases.every((d) => (d.sizeBytes ?? 0) > 0)).toBe(true);
    });
  });

  describe("createDatabase", () => {
    it("creates a database whose name no identifier pattern would accept", async () => {
      // `dbpilot_test-db.1` has a hyphen and a dot. Validating database names
      // the way table names are validated would make this unreachable — and
      // real servers are full of names like it.
      await adapter.createDatabase(TEMP_DATABASE);

      const databases = await adapter.listDatabases();
      expect(databases.map((d) => d.name)).toContain(TEMP_DATABASE);
    });

    it("surfaces the engine's error for a duplicate name", async () => {
      await expect(adapter.createDatabase(TEMP_DATABASE)).rejects.toThrow(
        /already exists/i
      );
    });

    it("refuses a name that quoting cannot make safe", async () => {
      await expect(adapter.createDatabase("has\tTab")).rejects.toThrow(
        /control characters/i
      );
    });

    it("neutralises a name built to break out of the identifier", async () => {
      // Quoting doubles the inner quote, so the whole string becomes a single
      // (absurd) identifier rather than two statements. It therefore *succeeds*
      // — creating one oddly-named database — and the assertion is that
      // `postgres` survived rather than that the statement failed.
      const hostile = 'x"; DROP DATABASE postgres; --';

      try {
        await adapter.createDatabase(hostile);

        const databases = await adapter.listDatabases();
        expect(databases.map((d) => d.name)).toContain("postgres");
        // The name was stored verbatim, which is what "one identifier" means.
        expect(databases.map((d) => d.name)).toContain(hostile);
      } finally {
        // This test creates a real database and must not leave it behind on
        // whatever server the suite was pointed at.
        await adapter.executeQuery(
          `DROP DATABASE IF EXISTS "${hostile.replaceAll('"', '""')}"`
        );
      }
    });
  });

  describe("useDatabase", () => {
    it("switches to another database", async () => {
      await adapter.useDatabase(TEMP_DATABASE);

      expect(adapter.getCurrentDatabase()).toBe(TEMP_DATABASE);
      const confirmed = await adapter.executeQuery(
        "SELECT current_database() AS db"
      );
      expect(confirmed.rows[0].db).toBe(TEMP_DATABASE);
    });

    it("shows the new database's tables, not the old one's", async () => {
      await adapter.useDatabase("postgres");
      await adapter.createDatabase(OTHER_DATABASE).catch(() => {});

      await adapter.useDatabase(TEMP_DATABASE);
      await adapter.executeQuery("CREATE TABLE only_here (id int)");

      expect((await adapter.getTables()).map((t) => t.name)).toContain(
        "only_here"
      );

      // Both databases belong to this suite, so nothing else can be creating or
      // dropping tables in them while the listing runs.
      await adapter.useDatabase(OTHER_DATABASE);
      expect((await adapter.getTables()).map((t) => t.name)).not.toContain(
        "only_here"
      );
    });

    it("is a no-op when already on that database", async () => {
      await adapter.useDatabase("postgres");
      await adapter.useDatabase("postgres");

      expect(adapter.getCurrentDatabase()).toBe("postgres");
      expect((await adapter.executeQuery("SELECT 1 AS ok")).error).toBeUndefined();
    });

    it("stays on the working database when the switch fails", async () => {
      await adapter.useDatabase("postgres");

      await expect(
        adapter.useDatabase("dbpilot_definitely_missing")
      ).rejects.toThrow();

      // The rollback is the point: a failed switch must not leave the adapter
      // with no pool at all.
      expect(adapter.getCurrentDatabase()).toBe("postgres");
      expect((await adapter.executeQuery("SELECT 1 AS ok")).error).toBeUndefined();
    });

    it("refuses a name that quoting cannot make safe", async () => {
      await expect(adapter.useDatabase("has\nNewline")).rejects.toThrow(
        /control characters/i
      );
      expect((await adapter.executeQuery("SELECT 1 AS ok")).error).toBeUndefined();
    });
  });
});
