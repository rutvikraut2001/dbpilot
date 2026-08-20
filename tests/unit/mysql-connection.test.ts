import { describe, it, expect } from "vitest";
import { MySQLAdapter } from "@/lib/adapters/mysql";
import { dialectForConnection } from "@/lib/utils/dialect";
import {
  DB_DEFAULT_PORTS,
  getAlternateConnectionString,
  parseHostname,
  parsePort,
  redirectToTunnel,
} from "@/lib/utils/connection-string";
import { buildConnectionStrategies } from "@/lib/utils/connection-diagnostics";
import { sanitizeError } from "@/lib/validation";
import { supportedDatabases } from "@/lib/constants";

/**
 * Everything about MySQL support that can be checked without a server.
 *
 * The connection string is parsed before any socket is opened, so a malformed
 * one must fail with a message that says what is wrong rather than surfacing as
 * a connection timeout ten seconds later.
 */
describe("MySQL connection strings", () => {
  it("rejects a string that is not a URL, before attempting to connect", async () => {
    const adapter = new MySQLAdapter("not-a-connection-string");

    await expect(adapter.connect()).rejects.toThrow(
      /Invalid MySQL connection string/
    );
  });

  it("requires a database name", async () => {
    const adapter = new MySQLAdapter("mysql://root:secret@localhost:3306");

    await expect(adapter.connect()).rejects.toThrow(/must name a database/);
  });

  it("requires a database name even with a trailing slash", async () => {
    const adapter = new MySQLAdapter("mysql://root:secret@localhost:3306/");

    await expect(adapter.connect()).rejects.toThrow(/must name a database/);
  });

  it("accepts mariadb:// as an alias for the same protocol", async () => {
    // Reaching the database-name complaint proves the scheme itself was
    // accepted; had it not been, the URL error would have come first.
    const adapter = new MySQLAdapter("mariadb://root:secret@localhost:3306");

    await expect(adapter.connect()).rejects.toThrow(/must name a database/);
  });

  it("reports the SQL dialect, so read-only mode enforces at the engine", () => {
    // A wrong answer here would route MySQL through command inspection instead
    // of `START TRANSACTION READ ONLY`, which is the actual guarantee.
    expect(new MySQLAdapter("mysql://root@localhost:3306/db").dialect).toBe(
      "sql"
    );
    expect(dialectForConnection("mysql")).toBe("sql");
  });

  it("is not connected until connect() succeeds", () => {
    expect(
      new MySQLAdapter("mysql://root@localhost:3306/db").isConnected()
    ).toBe(false);
  });
});

describe("MySQL in the shared connection-string helpers", () => {
  const url = "mysql://root:secret@localhost:3306/appdb";

  it("knows MySQL's default port", () => {
    expect(DB_DEFAULT_PORTS.mysql).toBe(3306);
  });

  it("parses host and port", () => {
    expect(parseHostname(url)).toBe("localhost");
    expect(parsePort(url, 3306)).toBe(3306);
    expect(parsePort("mysql://root@db.example.com/appdb", 3306)).toBe(3306);
  });

  it("swaps localhost for the Docker host and back", () => {
    const alternate = getAlternateConnectionString(url);
    expect(alternate).toBe(
      "mysql://root:secret@host.docker.internal:3306/appdb"
    );
    expect(getAlternateConnectionString(alternate!)).toBe(url);
  });

  it("redirects through an SSH tunnel's local port, keeping the scheme", () => {
    const tunneled = redirectToTunnel(url, 54321);

    expect(tunneled).toContain("mysql://");
    expect(tunneled).toContain("127.0.0.1:54321");
    expect(tunneled).toContain("/appdb");
  });

  it("appears in the connection form's supported databases", () => {
    const mysql = supportedDatabases.find((db) => db.type === "mysql");

    expect(mysql?.name).toBe("MySQL");
    expect(mysql?.placeholder).toContain("mysql://");
    expect(mysql?.placeholder).toContain("3306");
  });
});

describe("MySQL connection fallback strategies", () => {
  it("offers the Unix socket paths for a local MySQL", () => {
    const strategies = buildConnectionStrategies(
      "mysql",
      "mysql://root:secret@localhost:3306/appdb"
    );

    const sockets = strategies
      .map((s) => s.connectionString)
      .filter((s) => s.includes("socket="));

    expect(sockets).toContain(
      "mysql://root:secret@localhost:3306/appdb?socket=/var/run/mysqld/mysqld.sock"
    );
    expect(sockets).toContain(
      "mysql://root:secret@localhost:3306/appdb?socket=/tmp/mysql.sock"
    );
  });

  it("joins the socket parameter with & when the string already has a query", () => {
    const strategies = buildConnectionStrategies(
      "mysql",
      "mysql://root@localhost:3306/appdb?ssl-mode=REQUIRED"
    );

    expect(
      strategies.some((s) =>
        s.connectionString.includes("?ssl-mode=REQUIRED&socket=")
      )
    ).toBe(true);
  });

  it("does not offer socket paths for a remote host", () => {
    const strategies = buildConnectionStrategies(
      "mysql",
      "mysql://root@db.example.com:3306/appdb"
    );

    expect(strategies).toHaveLength(1);
    expect(strategies[0].label).toBe("Original");
  });

  it("does not offer MySQL sockets to other database types", () => {
    const strategies = buildConnectionStrategies(
      "postgresql",
      "postgresql://postgres@localhost:5432/appdb"
    );

    expect(
      strategies.every((s) => !s.connectionString.includes("mysqld.sock"))
    ).toBe(true);
  });
});

describe("MySQL error sanitization", () => {
  it("strips credentials from a mysql:// URL in an error message", () => {
    const message = sanitizeError(
      new Error(
        "connect ECONNREFUSED for mysql://root:sup3rsecret@localhost:3306/appdb"
      )
    );

    expect(message).not.toContain("sup3rsecret");
    expect(message).toContain("mysql://***@");
  });

  it("strips credentials from a mariadb:// URL too", () => {
    const message = sanitizeError(
      new Error("failed: mariadb://admin:hunter2@10.0.0.5:3306/appdb")
    );

    expect(message).not.toContain("hunter2");
    expect(message).toContain("mariadb://***@");
  });
});
