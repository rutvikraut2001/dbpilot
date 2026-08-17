import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * server-state reads FORCE_READ_ONLY at module load via lib/config, so each
 * scenario loads a fresh module graph with the env set accordingly.
 */
async function loadServerState(env: { forceReadOnly?: boolean } = {}) {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__readOnlyState;

  if (env.forceReadOnly) {
    process.env.FORCE_READ_ONLY = "true";
  } else {
    delete process.env.FORCE_READ_ONLY;
  }

  return import("@/lib/server-state");
}

const CONN = "conn_test_1";

describe("read-only state (normal deployment)", () => {
  beforeEach(() => {
    delete process.env.FORCE_READ_ONLY;
  });

  it("defaults an unknown connection to read-only", async () => {
    const state = await loadServerState();
    expect(state.isReadOnlyMode("conn_never_seen")).toBe(true);
  });

  it("initializes a new connection to read-only", async () => {
    const state = await loadServerState();
    expect(state.initReadOnlyMode(CONN)).toBe(true);
    expect(state.isReadOnlyMode(CONN)).toBe(true);
  });

  it("lets an explicit setting enable writes", async () => {
    const state = await loadServerState();
    state.initReadOnlyMode(CONN);

    expect(state.setReadOnlyMode(CONN, false)).toBe(false);
    expect(state.isReadOnlyMode(CONN)).toBe(false);
  });

  it("does not downgrade an existing connection on re-init", async () => {
    // This is the reload bug: reconnecting must not silently flip a connection
    // from read-only to writable.
    const state = await loadServerState();
    state.initReadOnlyMode(CONN);
    expect(state.isReadOnlyMode(CONN)).toBe(true);

    state.initReadOnlyMode(CONN);
    expect(state.isReadOnlyMode(CONN)).toBe(true);
  });

  it("does not upgrade an existing writable connection on re-init", async () => {
    const state = await loadServerState();
    state.setReadOnlyMode(CONN, false);

    expect(state.initReadOnlyMode(CONN)).toBe(false);
    expect(state.isReadOnlyMode(CONN)).toBe(false);
  });

  it("returns to read-only after the connection is cleared", async () => {
    const state = await loadServerState();
    state.setReadOnlyMode(CONN, false);
    state.clearReadOnlyState(CONN);

    expect(state.isReadOnlyMode(CONN)).toBe(true);
  });

  it("reports that read-only is not forced", async () => {
    const state = await loadServerState();
    expect(state.isForceReadOnly()).toBe(false);
  });
});

describe("read-only state (FORCE_READ_ONLY=true)", () => {
  afterEach(() => {
    delete process.env.FORCE_READ_ONLY;
  });

  it("reports read-only as forced", async () => {
    const state = await loadServerState({ forceReadOnly: true });
    expect(state.isForceReadOnly()).toBe(true);
  });

  it("forces read-only for every connection", async () => {
    const state = await loadServerState({ forceReadOnly: true });
    expect(state.isReadOnlyMode("conn_anything")).toBe(true);
  });

  it("refuses to enable writes", async () => {
    const state = await loadServerState({ forceReadOnly: true });

    expect(state.setReadOnlyMode(CONN, false)).toBe(true);
    expect(state.isReadOnlyMode(CONN)).toBe(true);
  });

  it("stays read-only after init", async () => {
    const state = await loadServerState({ forceReadOnly: true });
    expect(state.initReadOnlyMode(CONN)).toBe(true);
  });
});

describe("time-boxed write access", () => {
  beforeEach(() => {
    delete process.env.FORCE_READ_ONLY;
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("grants writes for the requested window", async () => {
    const state = await loadServerState();
    state.setReadOnlyMode(CONN, false, { durationMinutes: 15 });

    expect(state.isReadOnlyMode(CONN)).toBe(false);

    const access = state.getWriteAccess(CONN);
    expect(access.readOnly).toBe(false);
    expect(access.writeExpiresAt).toBeGreaterThan(Date.now());
  });

  it("reverts to read-only once the window lapses", async () => {
    // The point of a time box: it expires on its own, with nothing running.
    vi.useFakeTimers();
    const state = await loadServerState();
    state.setReadOnlyMode(CONN, false, { durationMinutes: 15 });
    expect(state.isReadOnlyMode(CONN)).toBe(false);

    vi.advanceTimersByTime(14 * 60_000);
    expect(state.isReadOnlyMode(CONN)).toBe(false);

    vi.advanceTimersByTime(2 * 60_000);
    expect(state.isReadOnlyMode(CONN)).toBe(true);
  });

  it("reports an expired grant as read-only with no expiry", async () => {
    vi.useFakeTimers();
    const state = await loadServerState();
    state.setReadOnlyMode(CONN, false, { durationMinutes: 5 });

    vi.advanceTimersByTime(6 * 60_000);

    expect(state.getWriteAccess(CONN)).toEqual({ readOnly: true });
  });

  it("keeps an open-ended grant when no duration is given", async () => {
    vi.useFakeTimers();
    const state = await loadServerState();
    state.setReadOnlyMode(CONN, false);

    vi.advanceTimersByTime(24 * 60 * 60_000);

    expect(state.isReadOnlyMode(CONN)).toBe(false);
    expect(state.getWriteAccess(CONN).writeExpiresAt).toBeUndefined();
  });

  it("records the reason alongside the grant", async () => {
    const state = await loadServerState();
    state.setReadOnlyMode(CONN, false, {
      durationMinutes: 30,
      reason: "fixing a stuck order",
    });

    expect(state.getWriteAccess(CONN).reason).toBe("fixing a stuck order");
  });

  it("clears the expiry when read-only is turned back on", async () => {
    const state = await loadServerState();
    state.setReadOnlyMode(CONN, false, { durationMinutes: 30 });
    state.setReadOnlyMode(CONN, true);

    expect(state.getWriteAccess(CONN)).toEqual({ readOnly: true });
  });

  it("ignores a duration under FORCE_READ_ONLY", async () => {
    const state = await loadServerState({ forceReadOnly: true });
    state.setReadOnlyMode(CONN, false, { durationMinutes: 60 });

    expect(state.isReadOnlyMode(CONN)).toBe(true);
    expect(state.getWriteAccess(CONN)).toEqual({ readOnly: true });
  });

  it("does not resurrect a lapsed grant on reconnect", async () => {
    vi.useFakeTimers();
    const state = await loadServerState();
    state.setReadOnlyMode(CONN, false, { durationMinutes: 5 });
    vi.advanceTimersByTime(6 * 60_000);

    expect(state.initReadOnlyMode(CONN)).toBe(true);
  });
});
