import { describe, it, expect } from "vitest";
import { filtersCacheKey, cacheKey } from "@/lib/cache";

describe("filtersCacheKey", () => {
  it("treats no filters and empty filters the same", () => {
    expect(filtersCacheKey(undefined)).toBe("");
    expect(filtersCacheKey({})).toBe("");
  });

  it("is stable regardless of property order", () => {
    // Property order varies with how the filter object was built; if it leaked
    // into the key the row-count cache would miss on every request.
    expect(filtersCacheKey({ a: 1, b: 2 })).toBe(filtersCacheKey({ b: 2, a: 1 }));
  });

  it("distinguishes different values", () => {
    expect(filtersCacheKey({ user_id: 1 })).not.toBe(
      filtersCacheKey({ user_id: 2 })
    );
  });

  it("distinguishes different columns", () => {
    expect(filtersCacheKey({ a: 1 })).not.toBe(filtersCacheKey({ b: 1 }));
  });
});

describe("row count cache keys", () => {
  it("scopes by connection, table and filters", () => {
    const a = cacheKey.rowCount("conn_1", "users", "");
    const b = cacheKey.rowCount("conn_2", "users", "");
    const c = cacheKey.rowCount("conn_1", "orders", "");
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("produces keys the table prefix covers, so writes invalidate every filter", () => {
    const prefix = cacheKey.rowCountPrefix("conn_1", "users");
    expect(cacheKey.rowCount("conn_1", "users", "").startsWith(prefix)).toBe(true);
    expect(
      cacheKey
        .rowCount("conn_1", "users", filtersCacheKey({ id: 5 }))
        .startsWith(prefix)
    ).toBe(true);
  });

  it("does not let one table's prefix match another's keys", () => {
    const prefix = cacheKey.rowCountPrefix("conn_1", "users");
    expect(cacheKey.rowCount("conn_1", "orders", "").startsWith(prefix)).toBe(
      false
    );
  });

  it("does not let a table prefix match a similarly-named table", () => {
    // The trailing separator is what stops "users" from invalidating "users2".
    const prefix = cacheKey.rowCountPrefix("conn_1", "users");
    expect(cacheKey.rowCount("conn_1", "users2", "").startsWith(prefix)).toBe(
      false
    );
  });
});
