import { describe, it, expect } from "vitest";
import { analyzeIndexHealth, formatBytes } from "@/lib/index-health";
import type { IndexInfo } from "@/lib/adapters/types";

/**
 * The index health rules.
 *
 * These decide what the UI *suggests dropping*, so the interesting cases are the
 * false positives: a rule that tells someone to drop an index their queries
 * depend on is worse than a rule that stays quiet.
 */

function index(overrides: Partial<IndexInfo> & { name: string }): IndexInfo {
  return {
    columns: ["a"],
    isUnique: false,
    isPrimary: false,
    type: "btree",
    ...overrides,
  };
}

describe("analyzeIndexHealth", () => {
  it("reports nothing for a table with only a primary key", () => {
    const issues = analyzeIndexHealth([
      index({ name: "t_pkey", columns: ["id"], isPrimary: true, isUnique: true }),
    ]);

    expect(issues).toEqual([]);
  });

  it("never flags the primary key, whatever else is true of it", () => {
    const issues = analyzeIndexHealth([
      index({
        name: "t_pkey",
        columns: ["id"],
        isPrimary: true,
        isUnique: true,
        scans: 0,
        sizeBytes: 500 * 1024 * 1024,
      }),
      index({ name: "idx_id", columns: ["id"] }),
    ]);

    expect(issues.some((i) => i.indexName === "t_pkey")).toBe(false);
  });

  describe("duplicates", () => {
    it("flags a second index on identical columns", () => {
      const issues = analyzeIndexHealth([
        index({ name: "idx_a", columns: ["a"] }),
        index({ name: "idx_a_copy", columns: ["a"] }),
      ]);

      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        kind: "duplicate",
        indexName: "idx_a",
        relatedIndex: "idx_a_copy",
      });
    });

    it("reports the plain index rather than the unique one", () => {
      // Dropping the unique index would drop a constraint with it, so the
      // droppable one is the plain index however the pair is ordered.
      const forward = analyzeIndexHealth([
        index({ name: "uq_a", columns: ["a"], isUnique: true }),
        index({ name: "idx_a", columns: ["a"] }),
      ]);
      const reversed = analyzeIndexHealth([
        index({ name: "idx_a", columns: ["a"] }),
        index({ name: "uq_a", columns: ["a"], isUnique: true }),
      ]);

      expect(forward[0]).toMatchObject({
        kind: "duplicate",
        indexName: "idx_a",
        relatedIndex: "uq_a",
      });
      expect(reversed[0]).toMatchObject({
        kind: "duplicate",
        indexName: "idx_a",
        relatedIndex: "uq_a",
      });
    });

    it("treats a different column order as a different index", () => {
      // (a, b) and (b, a) serve different lookups; neither is a duplicate.
      const issues = analyzeIndexHealth([
        index({ name: "idx_ab", columns: ["a", "b"] }),
        index({ name: "idx_ba", columns: ["b", "a"] }),
      ]);

      expect(issues.filter((i) => i.kind === "duplicate")).toEqual([]);
    });

    it("reports one finding per duplicate, not one per pair", () => {
      const issues = analyzeIndexHealth([
        index({ name: "idx_a1", columns: ["a"] }),
        index({ name: "idx_a2", columns: ["a"] }),
        index({ name: "idx_a3", columns: ["a"] }),
      ]);

      // Three indexes form three pairs, but only two are droppable.
      expect(issues.filter((i) => i.kind === "duplicate")).toHaveLength(2);
    });
  });

  describe("redundancy", () => {
    it("flags an index whose columns are a leading prefix of a wider one", () => {
      const issues = analyzeIndexHealth([
        index({ name: "idx_a", columns: ["a"] }),
        index({ name: "idx_abc", columns: ["a", "b", "c"] }),
      ]);

      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        kind: "redundant",
        indexName: "idx_a",
        relatedIndex: "idx_abc",
      });
    });

    it("does not flag a non-leading subset", () => {
      // (a, b, c) cannot serve a lookup on b alone, so idx_b earns its keep.
      const issues = analyzeIndexHealth([
        index({ name: "idx_b", columns: ["b"] }),
        index({ name: "idx_abc", columns: ["a", "b", "c"] }),
      ]);

      expect(issues.filter((i) => i.kind === "redundant")).toEqual([]);
    });

    it("does not flag a unique index as redundant", () => {
      // A wider index does not enforce the shorter one's uniqueness.
      const issues = analyzeIndexHealth([
        index({ name: "uq_a", columns: ["a"], isUnique: true }),
        index({ name: "idx_ab", columns: ["a", "b"] }),
      ]);

      expect(issues.filter((i) => i.kind === "redundant")).toEqual([]);
    });

    it("does not flag the wider index as redundant of the narrower", () => {
      const issues = analyzeIndexHealth([
        index({ name: "idx_ab", columns: ["a", "b"] }),
        index({ name: "idx_a", columns: ["a"] }),
      ]);

      expect(issues.map((i) => i.indexName)).toEqual(["idx_a"]);
    });
  });

  describe("partial indexes", () => {
    it("does not recommend dropping a full index because a partial one exists", () => {
      // This is the finding that would break queries: the partial index covers
      // only its predicate's rows, so it cannot replace the full index.
      const issues = analyzeIndexHealth([
        index({ name: "idx_a_full", columns: ["a"] }),
        index({ name: "idx_a_partial", columns: ["a"], isPartial: true }),
      ]);

      expect(issues.filter((i) => i.indexName === "idx_a_full")).toEqual([]);
    });

    it("does not call a partial index a duplicate of a full one", () => {
      const issues = analyzeIndexHealth([
        index({ name: "idx_a_partial", columns: ["a"], isPartial: true }),
        index({ name: "idx_a_full", columns: ["a"] }),
      ]);

      expect(issues.filter((i) => i.kind === "duplicate")).toEqual([]);
      expect(issues.filter((i) => i.kind === "redundant")).toEqual([]);
    });

    it("still reports an unused partial index", () => {
      const issues = analyzeIndexHealth([
        index({ name: "idx_p", columns: ["a"], isPartial: true, scans: 0 }),
      ]);

      expect(issues).toHaveLength(1);
      expect(issues[0].kind).toBe("unused");
    });
  });

  describe("unused", () => {
    it("flags an index the planner has never chosen", () => {
      const issues = analyzeIndexHealth([
        index({ name: "idx_a", columns: ["a"], scans: 0 }),
      ]);

      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ kind: "unused", indexName: "idx_a" });
    });

    it("stays silent when the engine cannot report scan counts", () => {
      // scans undefined means "unknown". Treating it as zero would accuse every
      // index on an engine without usage statistics of being unused.
      const issues = analyzeIndexHealth([
        index({ name: "idx_a", columns: ["a"], scans: undefined }),
      ]);

      expect(issues).toEqual([]);
    });

    it("does not flag an index that has been used", () => {
      const issues = analyzeIndexHealth([
        index({ name: "idx_a", columns: ["a"], scans: 1 }),
      ]);

      expect(issues).toEqual([]);
    });

    it("does not flag an unused unique index", () => {
      // It enforces a constraint whether or not a query ever reads it.
      const issues = analyzeIndexHealth([
        index({ name: "uq_a", columns: ["a"], isUnique: true, scans: 0 }),
      ]);

      expect(issues).toEqual([]);
    });

    it("does not report an index as both duplicate and unused", () => {
      const issues = analyzeIndexHealth([
        index({ name: "idx_a1", columns: ["a"], scans: 0 }),
        index({ name: "idx_a2", columns: ["a"], scans: 0 }),
      ]);

      const forDuplicate = issues.filter((i) => i.indexName === "idx_a1");
      expect(forDuplicate).toHaveLength(1);
      expect(forDuplicate[0].kind).toBe("duplicate");
    });
  });

  describe("large", () => {
    const big = 60 * 1024 * 1024;

    it("flags an index disproportionate to its table", () => {
      const issues = analyzeIndexHealth(
        [index({ name: "idx_a", columns: ["a"], sizeBytes: big, scans: 5 })],
        { tableSizeBytes: 10 * 1024 * 1024 }
      );

      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        kind: "large",
        indexName: "idx_a",
        severity: "info",
      });
    });

    it("needs the table size to say anything", () => {
      const issues = analyzeIndexHealth([
        index({ name: "idx_a", columns: ["a"], sizeBytes: big, scans: 5 }),
      ]);

      expect(issues).toEqual([]);
    });

    it("ignores a small index on a tiny table", () => {
      // Ratio alone would flag this; the absolute floor is what stops a 24 KB
      // index on an 8 KB table being called large.
      const issues = analyzeIndexHealth(
        [index({ name: "idx_a", columns: ["a"], sizeBytes: 24 * 1024, scans: 5 })],
        { tableSizeBytes: 8 * 1024 }
      );

      expect(issues).toEqual([]);
    });

    it("reports the primary key when it is oversized", () => {
      // The size rule is informational, so unlike the drop-oriented rules it
      // does apply to the primary key.
      const issues = analyzeIndexHealth(
        [
          index({
            name: "t_pkey",
            columns: ["id"],
            isPrimary: true,
            isUnique: true,
            sizeBytes: big,
          }),
        ],
        { tableSizeBytes: 1024 * 1024 }
      );

      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ kind: "large", indexName: "t_pkey" });
    });
  });

  it("returns findings in a stable order", () => {
    const indexes = [
      index({ name: "idx_z", columns: ["z"], scans: 0 }),
      index({ name: "idx_a", columns: ["a"], scans: 0 }),
      index({ name: "idx_m", columns: ["m"], scans: 0 }),
    ];

    const first = analyzeIndexHealth(indexes).map((i) => i.indexName);
    const second = analyzeIndexHealth([...indexes].reverse()).map(
      (i) => i.indexName
    );

    expect(first).toEqual(["idx_a", "idx_m", "idx_z"]);
    expect(second).toEqual(first);
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [10 * 1024, "10 KB"],
    [1024 * 1024, "1.0 MB"],
    [5 * 1024 * 1024 * 1024, "5.0 GB"],
  ])("renders %i bytes as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
