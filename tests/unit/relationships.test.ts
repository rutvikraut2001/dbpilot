import { describe, it, expect } from "vitest";
import { junctionCandidates, markJunctionTables } from "@/lib/relationships";
import type { Relationship } from "@/lib/adapters/types";

/**
 * Junction-table detection.
 *
 * The rule is deliberately narrow, and the tests are mostly about what it must
 * *not* collapse: mislabelling a real entity as plumbing hides data the user
 * has, which is worse than drawing a many-to-many as two ordinary edges.
 */

function rel(
  sourceTable: string,
  sourceColumn: string,
  targetTable: string,
  overrides: Partial<Relationship> = {}
): Relationship {
  return {
    sourceTable,
    sourceColumn,
    targetTable,
    targetColumn: "id",
    type: "one-to-many",
    ...overrides,
  };
}

/** The canonical shape: a table that is nothing but two foreign keys. */
const PURE_JUNCTION = [
  rel("post_tags", "post_id", "posts"),
  rel("post_tags", "tag_id", "tags"),
];

describe("junctionCandidates", () => {
  it("finds a table whose foreign keys point at exactly two others", () => {
    expect(junctionCandidates(PURE_JUNCTION)).toEqual(["post_tags"]);
  });

  it("ignores a table nothing points at two tables from", () => {
    expect(junctionCandidates([rel("orders", "user_id", "users")])).toEqual([]);
  });

  it("ignores a table that something else references", () => {
    // If another table has a foreign key to it, it is an entity in its own
    // right whatever its own columns look like.
    const withDependent = [
      ...PURE_JUNCTION,
      rel("audit", "post_tag_id", "post_tags"),
    ];

    // `audit` is not a candidate either — it has one foreign key, not two — so
    // what this asserts is that post_tags dropped out.
    expect(junctionCandidates(withDependent)).not.toContain("post_tags");
    expect(junctionCandidates(withDependent)).toEqual([]);
  });

  it("ignores a table with foreign keys to three tables", () => {
    expect(
      junctionCandidates([
        rel("triple", "a_id", "a"),
        rel("triple", "b_id", "b"),
        rel("triple", "c_id", "c"),
      ])
    ).toEqual([]);
  });

  it("ignores two foreign keys pointing at the same table", () => {
    // A message with sender_id and recipient_id both referencing users is an
    // entity, not a join between two things.
    expect(
      junctionCandidates([
        rel("messages", "sender_id", "users"),
        rel("messages", "recipient_id", "users"),
      ])
    ).toEqual([]);
  });
});

describe("markJunctionTables", () => {
  it("marks both halves as many-to-many, naming the junction", () => {
    const marked = markJunctionTables(
      PURE_JUNCTION,
      new Map([["post_tags", ["post_id", "tag_id"]]])
    );

    expect(marked).toHaveLength(2);
    for (const relationship of marked) {
      expect(relationship.type).toBe("many-to-many");
      expect(relationship.viaJunctionTable).toBe("post_tags");
    }
  });

  it("keeps the real foreign keys rather than replacing them", () => {
    // The annotation is additive: the underlying schema is still reported
    // accurately, so nothing downstream loses the actual columns.
    const marked = markJunctionTables(
      PURE_JUNCTION,
      new Map([["post_tags", ["post_id", "tag_id"]]])
    );

    expect(marked.map((r) => [r.sourceColumn, r.targetTable])).toEqual([
      ["post_id", "posts"],
      ["tag_id", "tags"],
    ]);
  });

  it("leaves a join table alone once it carries its own data", () => {
    // `role` makes this an entity — a membership — and collapsing it would hide
    // a column the user has.
    const marked = markJunctionTables(
      [rel("memberships", "user_id", "users"), rel("memberships", "team_id", "teams")],
      new Map([["memberships", ["user_id", "team_id", "role"]]])
    );

    expect(marked.every((r) => r.type === "one-to-many")).toBe(true);
    expect(marked.every((r) => r.viaJunctionTable === undefined)).toBe(true);
  });

  it("leaves a candidate alone when its columns are unknown", () => {
    // Without the column list there is no way to tell plumbing from an entity,
    // so it guesses at neither.
    const marked = markJunctionTables(PURE_JUNCTION);

    expect(marked.every((r) => r.type === "one-to-many")).toBe(true);
  });

  it("returns the input untouched when nothing qualifies", () => {
    const input = [rel("orders", "user_id", "users")];

    expect(markJunctionTables(input, new Map())).toEqual(input);
  });

  it("preserves optionality on the relationships it marks", () => {
    const marked = markJunctionTables(
      [
        rel("post_tags", "post_id", "posts", { optional: true }),
        rel("post_tags", "tag_id", "tags", { optional: false }),
      ],
      new Map([["post_tags", ["post_id", "tag_id"]]])
    );

    expect(marked.map((r) => r.optional)).toEqual([true, false]);
  });

  it("handles a composite junction whose key columns repeat per constraint", () => {
    // A junction table on a composite key still has every column covered.
    const marked = markJunctionTables(
      [
        rel("ab", "a1", "a"),
        rel("ab", "a2", "a"),
        rel("ab", "b1", "b"),
      ],
      new Map([["ab", ["a1", "a2", "b1"]]])
    );

    expect(marked.every((r) => r.type === "many-to-many")).toBe(true);
  });
});
