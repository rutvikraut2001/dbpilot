import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Asserts read-only enforcement at the API boundary — the layer an attacker or
 * a stale client actually talks to. Every case here calls the route handler
 * directly with a hostile or careless request; the UI is not involved, because
 * the UI is not what makes these guarantees.
 *
 * The database drivers are mocked out: what's under test is whether a write
 * ever reaches the adapter, not what the adapter does with it.
 */

const CONN = "conn_test_readonly";

interface FakeAdapter {
  dialect: "sql" | "mongodb" | "redis";
  isConnected: () => boolean;
  connect: ReturnType<typeof vi.fn>;
  executeQuery: ReturnType<typeof vi.fn>;
  insertRow: ReturnType<typeof vi.fn>;
  updateRow: ReturnType<typeof vi.fn>;
  deleteRow: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
  testConnection: ReturnType<typeof vi.fn>;
  flushDb: ReturnType<typeof vi.fn>;
  flushAll: ReturnType<typeof vi.fn>;
  capabilities: { supportsIndexManagement: boolean };
  getIndexInfo: ReturnType<typeof vi.fn>;
  getTableStats: ReturnType<typeof vi.fn>;
  createIndex: ReturnType<typeof vi.fn>;
  dropIndex: ReturnType<typeof vi.fn>;
}

function makeAdapter(dialect: FakeAdapter["dialect"] = "sql"): FakeAdapter {
  return {
    dialect,
    isConnected: () => true,
    connect: vi.fn().mockResolvedValue(undefined),
    executeQuery: vi.fn().mockResolvedValue({
      rows: [],
      columns: [],
      rowCount: 0,
      executionTimeMs: 1,
    }),
    insertRow: vi.fn().mockResolvedValue({}),
    updateRow: vi.fn().mockResolvedValue({}),
    deleteRow: vi.fn().mockResolvedValue(true),
    ping: vi.fn().mockResolvedValue(true),
    testConnection: vi
      .fn()
      .mockResolvedValue({ success: true, message: "ok" }),
    flushDb: vi.fn().mockResolvedValue(undefined),
    flushAll: vi.fn().mockResolvedValue(undefined),
    capabilities: { supportsIndexManagement: true },
    getIndexInfo: vi.fn().mockResolvedValue([]),
    getTableStats: vi
      .fn()
      .mockResolvedValue({ rowCount: 0, sizeBytes: 0, indexCount: 0 }),
    createIndex: vi.fn().mockResolvedValue({
      name: "idx_users_name",
      columns: ["name"],
      isUnique: false,
      isPrimary: false,
      type: "btree",
    }),
    dropIndex: vi.fn().mockResolvedValue(true),
  };
}

let adapter: FakeAdapter;

vi.mock("@/lib/adapters/factory", () => ({
  getCachedAdapter: () => adapter,
  getOrCreateAdapter: async () => adapter,
  createAdapter: () => adapter,
  removeAdapter: vi.fn(),
  clearAllAdapters: vi.fn(),
  connectWithRetry: vi.fn(),
  setupTunnel: vi.fn(),
}));

// The Redis route narrows with `instanceof RedisAdapter`; make the fake pass.
vi.mock("@/lib/adapters/redis", () => {
  class RedisAdapter {
    static [Symbol.hasInstance]() {
      return true;
    }
  }
  return { RedisAdapter };
});

async function loadModules(env: { forceReadOnly?: boolean } = {}) {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__readOnlyState;

  if (env.forceReadOnly) {
    process.env.FORCE_READ_ONLY = "true";
  } else {
    delete process.env.FORCE_READ_ONLY;
  }

  const state = await import("@/lib/server-state");
  const data = await import("@/app/api/data/route");
  const query = await import("@/app/api/query/route");
  const redis = await import("@/app/api/redis/route");
  const settings = await import("@/app/api/settings/route");
  const connect = await import("@/app/api/connect/route");
  const indexes = await import("@/app/api/indexes/route");

  return { state, data, query, redis, settings, connect, indexes };
}

function jsonRequest(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  adapter = makeAdapter();
});

afterEach(() => {
  delete process.env.FORCE_READ_ONLY;
  vi.clearAllMocks();
});

describe("read-only mode blocks writes on /api/data", () => {
  it("refuses INSERT", async () => {
    const { data } = await loadModules();

    const response = await data.POST(
      jsonRequest("http://localhost/api/data", "POST", {
        connectionId: CONN,
        table: "users",
        data: { name: "x" },
      })
    );

    expect(response.status).toBe(403);
    expect(adapter.insertRow).not.toHaveBeenCalled();
  });

  it("refuses UPDATE", async () => {
    const { data } = await loadModules();

    const response = await data.PUT(
      jsonRequest("http://localhost/api/data", "PUT", {
        connectionId: CONN,
        table: "users",
        primaryKey: { id: 1 },
        data: { name: "x" },
      })
    );

    expect(response.status).toBe(403);
    expect(adapter.updateRow).not.toHaveBeenCalled();
  });

  it("refuses DELETE", async () => {
    const { data } = await loadModules();

    const response = await data.DELETE(
      new NextRequest(
        `http://localhost/api/data?connectionId=${CONN}&table=users&primaryKey=${encodeURIComponent(
          JSON.stringify({ id: 1 })
        )}`,
        { method: "DELETE" }
      )
    );

    expect(response.status).toBe(403);
    expect(adapter.deleteRow).not.toHaveBeenCalled();
  });

  it("ignores a client-supplied readOnly=false on the DELETE URL", async () => {
    // The data viewer appends `readOnly=<local state>` to this URL. The server
    // must decide from its own state and ignore the parameter entirely.
    const { data } = await loadModules();

    const response = await data.DELETE(
      new NextRequest(
        `http://localhost/api/data?connectionId=${CONN}&table=users&primaryKey=${encodeURIComponent(
          JSON.stringify({ id: 1 })
        )}&readOnly=false`,
        { method: "DELETE" }
      )
    );

    expect(response.status).toBe(403);
    expect(adapter.deleteRow).not.toHaveBeenCalled();
  });

  it("allows a write once the server has been told to allow it", async () => {
    const { state, data } = await loadModules();
    state.setReadOnlyMode(CONN, false);

    const response = await data.POST(
      jsonRequest("http://localhost/api/data", "POST", {
        connectionId: CONN,
        table: "users",
        data: { name: "x" },
      })
    );

    expect(response.status).toBe(200);
    expect(adapter.insertRow).toHaveBeenCalledOnce();
  });
});

describe("read-only mode blocks writes on /api/query", () => {
  it.each([
    "DELETE FROM users",
    "DROP TABLE users",
    "UPDATE users SET status = 'x'",
    "TRUNCATE users",
    "/* sneaky */ DELETE FROM users",
    "WITH gone AS (DELETE FROM users RETURNING *) SELECT * FROM gone",
    "DO $$ BEGIN DELETE FROM users; END $$",
  ])("refuses %j", async (sql) => {
    const { query } = await loadModules();

    const response = await query.POST(
      jsonRequest("http://localhost/api/query", "POST", {
        connectionId: CONN,
        query: sql,
      })
    );

    expect(response.status).toBe(403);
    expect(adapter.executeQuery).not.toHaveBeenCalled();
  });

  it("refuses a multi-statement batch hiding a write behind a SELECT", async () => {
    const { query } = await loadModules();

    const response = await query.POST(
      jsonRequest("http://localhost/api/query", "POST", {
        connectionId: CONN,
        query: "SELECT 1; DROP TABLE users;",
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("single statement"),
    });
    expect(adapter.executeQuery).not.toHaveBeenCalled();
  });

  it("ignores a client-supplied readOnly=false in the body", async () => {
    const { query } = await loadModules();

    const response = await query.POST(
      jsonRequest("http://localhost/api/query", "POST", {
        connectionId: CONN,
        query: "DELETE FROM users",
        readOnly: false,
      })
    );

    expect(response.status).toBe(403);
    expect(adapter.executeQuery).not.toHaveBeenCalled();
  });

  it("allows a read and tells the adapter to enforce read-only", async () => {
    const { query } = await loadModules();

    const response = await query.POST(
      jsonRequest("http://localhost/api/query", "POST", {
        connectionId: CONN,
        query: "SELECT * FROM users",
      })
    );

    expect(response.status).toBe(200);
    expect(adapter.executeQuery).toHaveBeenCalledWith("SELECT * FROM users", {
      readOnly: true,
    });
  });

  it("blocks Redis write commands", async () => {
    adapter = makeAdapter("redis");
    const { query } = await loadModules();

    const response = await query.POST(
      jsonRequest("http://localhost/api/query", "POST", {
        connectionId: CONN,
        query: "FLUSHALL",
      })
    );

    expect(response.status).toBe(403);
    expect(adapter.executeQuery).not.toHaveBeenCalled();
  });

  it("blocks MongoDB write operations", async () => {
    adapter = makeAdapter("mongodb");
    const { query } = await loadModules();

    const response = await query.POST(
      jsonRequest("http://localhost/api/query", "POST", {
        connectionId: CONN,
        query: "db.users.deleteMany({})",
      })
    );

    expect(response.status).toBe(403);
    expect(adapter.executeQuery).not.toHaveBeenCalled();
  });
});

describe("read-only mode blocks Redis flush", () => {
  it.each(["flushdb", "flushall"])("refuses %s", async (action) => {
    adapter = makeAdapter("redis");
    const { redis } = await loadModules();

    const response = await redis.POST(
      jsonRequest("http://localhost/api/redis", "POST", {
        connectionId: CONN,
        action,
      })
    );

    expect(response.status).toBe(403);
    expect(adapter.flushDb).not.toHaveBeenCalled();
    expect(adapter.flushAll).not.toHaveBeenCalled();
  });
});

describe("connecting cannot grant write access", () => {
  it("ignores readOnly=false in the connect body", async () => {
    // The regression: /api/connect used to do setReadOnlyMode(id, readOnly ?? false),
    // so any connect — including the studio's automatic reconnect on reload,
    // which sends no readOnly at all — reset the connection to writable.
    const { state, connect } = await loadModules();

    const response = await connect.POST(
      jsonRequest("http://localhost/api/connect", "POST", {
        type: "postgresql",
        connectionString: "postgresql://user:pass@localhost:5432/db",
        connectionId: CONN,
        readOnly: false,
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ readOnly: true });
    expect(state.isReadOnlyMode(CONN)).toBe(true);
  });

  it("preserves an enabled write mode across a reconnect", async () => {
    const { state, connect } = await loadModules();
    state.setReadOnlyMode(CONN, false);

    await connect.POST(
      jsonRequest("http://localhost/api/connect", "POST", {
        type: "postgresql",
        connectionString: "postgresql://user:pass@localhost:5432/db",
        connectionId: CONN,
      })
    );

    expect(state.isReadOnlyMode(CONN)).toBe(false);
  });
});

describe("read-only mode blocks index management", () => {
  it("refuses to create an index", async () => {
    const { indexes } = await loadModules();

    const response = await indexes.POST(
      jsonRequest("http://localhost/api/indexes", "POST", {
        connectionId: CONN,
        table: "users",
        name: "idx_users_name",
        columns: ["name"],
      })
    );

    expect(response.status).toBe(403);
    // Building an index rewrites storage and takes locks; the adapter must not
    // be reached at all.
    expect(adapter.createIndex).not.toHaveBeenCalled();
  });

  it("refuses to drop an index", async () => {
    const { indexes } = await loadModules();

    const response = await indexes.DELETE(
      new NextRequest(
        `http://localhost/api/indexes?connectionId=${CONN}&table=users&name=idx_users_name`,
        { method: "DELETE" }
      )
    );

    expect(response.status).toBe(403);
    expect(adapter.dropIndex).not.toHaveBeenCalled();
  });

  it("still allows listing indexes", async () => {
    // Read-only restricts writes, not visibility — a user browsing a production
    // database should still be able to see what indexes exist.
    const { indexes } = await loadModules();

    const response = await indexes.GET(
      new NextRequest(
        `http://localhost/api/indexes?connectionId=${CONN}&table=users`
      )
    );

    expect(response.status).toBe(200);
    expect(adapter.getIndexInfo).toHaveBeenCalled();
  });

  it("allows index writes once write access is granted", async () => {
    const { state, indexes } = await loadModules();
    state.setReadOnlyMode(CONN, false);

    const response = await indexes.POST(
      jsonRequest("http://localhost/api/indexes", "POST", {
        connectionId: CONN,
        table: "users",
        name: "idx_users_name",
        columns: ["name"],
      })
    );

    expect(response.status).toBe(200);
    expect(adapter.createIndex).toHaveBeenCalledWith(
      "users",
      expect.objectContaining({ name: "idx_users_name", columns: ["name"] })
    );
  });

  it("refuses an engine that does not support index management", async () => {
    const { state, indexes } = await loadModules();
    state.setReadOnlyMode(CONN, false);
    adapter.capabilities = { supportsIndexManagement: false };

    const response = await indexes.POST(
      jsonRequest("http://localhost/api/indexes", "POST", {
        connectionId: CONN,
        table: "users",
        name: "idx_users_name",
        columns: ["name"],
      })
    );

    expect(response.status).toBe(400);
    expect(adapter.createIndex).not.toHaveBeenCalled();
  });

  it("rejects a malformed index name before reaching the adapter", async () => {
    const { state, indexes } = await loadModules();
    state.setReadOnlyMode(CONN, false);

    const response = await indexes.POST(
      jsonRequest("http://localhost/api/indexes", "POST", {
        connectionId: CONN,
        table: "users",
        name: 'x"; DROP TABLE users; --',
        columns: ["name"],
      })
    );

    expect(response.status).toBe(400);
    expect(adapter.createIndex).not.toHaveBeenCalled();
  });
});

describe("FORCE_READ_ONLY cannot be overridden", () => {
  it("refuses to enable writes via /api/settings", async () => {
    const { state, settings } = await loadModules({ forceReadOnly: true });

    const response = await settings.POST(
      jsonRequest("http://localhost/api/settings", "POST", {
        connectionId: CONN,
        readOnly: false,
      })
    );

    expect(response.status).toBe(403);
    expect(state.isReadOnlyMode(CONN)).toBe(true);
  });

  it("still blocks writes after an attempted override", async () => {
    const { state, data } = await loadModules({ forceReadOnly: true });

    // Even calling the state setter directly cannot weaken it.
    state.setReadOnlyMode(CONN, false);

    const response = await data.POST(
      jsonRequest("http://localhost/api/data", "POST", {
        connectionId: CONN,
        table: "users",
        data: { name: "x" },
      })
    );

    expect(response.status).toBe(403);
    expect(adapter.insertRow).not.toHaveBeenCalled();
  });

  it("reports forceReadOnly to the client", async () => {
    const { settings } = await loadModules({ forceReadOnly: true });

    const response = await settings.GET(
      new NextRequest(
        `http://localhost/api/settings?connectionId=${CONN}`
      )
    );

    expect(await response.json()).toMatchObject({
      readOnly: true,
      forceReadOnly: true,
    });
  });
});
