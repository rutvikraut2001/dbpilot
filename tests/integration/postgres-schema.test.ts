import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgresAdapter } from "@/lib/adapters/postgres";

/**
 * Schema introspection against a real PostgreSQL, focused on composite keys.
 *
 * The regression that prompted this suite: `getTableSchema` joined
 * `key_column_usage` to `constraint_column_usage` on constraint name alone,
 * which pairs *every* local column of a foreign key with *every* referenced
 * column. A composite key on (a, b) therefore produced four rows instead of two
 * — each column returned twice, and half the pairings naming the wrong target.
 *
 * It surfaced as React complaining about duplicate keys in the ER diagram, but
 * the real damage was quieter: the diagram drew relationships that do not exist.
 *
 * Requires TEST_POSTGRES_URL; skipped otherwise.
 */
const CONNECTION_STRING = process.env.TEST_POSTGRES_URL;

/** Dropped child-first so the foreign keys do not block it. */
const CARD_TABLES = [
  "card_profile",
  "card_post_tags",
  "card_membership",
  "card_order",
  "card_post",
  "card_tag",
  "card_user",
];
const CASCADE = " CASCADE";

describe.skipIf(!CONNECTION_STRING)("PostgreSQL schema introspection", () => {
  let adapter: PostgresAdapter;

  beforeAll(async () => {
    adapter = new PostgresAdapter(CONNECTION_STRING!);
    await adapter.connect();

    await adapter.executeQuery("DROP TABLE IF EXISTS fk_child");
    await adapter.executeQuery("DROP TABLE IF EXISTS fk_other");
    await adapter.executeQuery("DROP TABLE IF EXISTS fk_parent");

    await adapter.executeQuery(`
      CREATE TABLE fk_parent (
        enterprise_id integer,
        services_id integer,
        PRIMARY KEY (enterprise_id, services_id)
      )
    `);
    await adapter.executeQuery(
      "CREATE TABLE fk_other (enterprise_id integer PRIMARY KEY)"
    );
    await adapter.executeQuery(`
      CREATE TABLE fk_child (
        id serial PRIMARY KEY,
        enterprise_id integer,
        services_id integer,
        note text,
        CONSTRAINT fk_composite FOREIGN KEY (enterprise_id, services_id)
          REFERENCES fk_parent (enterprise_id, services_id)
      )
    `);
  });

  afterAll(async () => {
    if (!adapter) return;
    await adapter.executeQuery("DROP TABLE IF EXISTS fk_child");
    await adapter.executeQuery("DROP TABLE IF EXISTS fk_other");
    await adapter.executeQuery("DROP TABLE IF EXISTS fk_parent");
    await adapter.disconnect();
  });

  describe("a composite foreign key", () => {
    it("returns each column exactly once", async () => {
      const columns = await adapter.getTableSchema("fk_child");
      const names = columns.map((c) => c.name);

      expect(names).toEqual(["id", "enterprise_id", "services_id", "note"]);
      expect(new Set(names).size).toBe(names.length);
    });

    it("pairs each column with its own referenced column", async () => {
      // The mispairing this guards: enterprise_id used to also be reported as
      // referencing services_id, and vice versa.
      const columns = await adapter.getTableSchema("fk_child");
      const byName = Object.fromEntries(columns.map((c) => [c.name, c]));

      expect(byName.enterprise_id.foreignKeyRef).toEqual({
        table: "fk_parent",
        column: "enterprise_id",
      });
      expect(byName.services_id.foreignKeyRef).toEqual({
        table: "fk_parent",
        column: "services_id",
      });
    });

    it("marks every member of a composite primary key", async () => {
      const columns = await adapter.getTableSchema("fk_parent");

      expect(columns.filter((c) => c.isPrimaryKey).map((c) => c.name)).toEqual([
        "enterprise_id",
        "services_id",
      ]);
    });

    it("draws one relationship per column pair, correctly paired", async () => {
      const relationships = (await adapter.getRelationships()).filter(
        (r) => r.sourceTable === "fk_child"
      );

      expect(relationships).toHaveLength(2);
      expect(relationships).toContainEqual(
        expect.objectContaining({
          sourceColumn: "enterprise_id",
          targetTable: "fk_parent",
          targetColumn: "enterprise_id",
        })
      );
      expect(relationships).toContainEqual(
        expect.objectContaining({
          sourceColumn: "services_id",
          targetTable: "fk_parent",
          targetColumn: "services_id",
        })
      );
    });
  });

  describe("cardinality read from the schema", () => {
    beforeAll(async () => {
      for (const t of CARD_TABLES) {
        await adapter.executeQuery(`DROP TABLE IF EXISTS ${t}${CASCADE}`);
      }
      await adapter.executeQuery("CREATE TABLE card_user (id serial PRIMARY KEY)");
      await adapter.executeQuery("CREATE TABLE card_post (id serial PRIMARY KEY)");
      await adapter.executeQuery("CREATE TABLE card_tag (id serial PRIMARY KEY)");
      await adapter.executeQuery(
        "CREATE TABLE card_profile (id serial PRIMARY KEY, user_id int UNIQUE NOT NULL REFERENCES card_user(id))"
      );
      await adapter.executeQuery(
        "CREATE TABLE card_order (id serial PRIMARY KEY, user_id int REFERENCES card_user(id))"
      );
      await adapter.executeQuery(
        "CREATE TABLE card_post_tags (post_id int NOT NULL REFERENCES card_post(id), tag_id int NOT NULL REFERENCES card_tag(id), PRIMARY KEY (post_id, tag_id))"
      );
      await adapter.executeQuery(
        "CREATE TABLE card_membership (user_id int NOT NULL REFERENCES card_user(id), tag_id int NOT NULL REFERENCES card_tag(id), role text NOT NULL, PRIMARY KEY (user_id, tag_id))"
      );
    });

    afterAll(async () => {
      for (const t of CARD_TABLES) {
        await adapter.executeQuery(`DROP TABLE IF EXISTS ${t}${CASCADE}`);
      }
    });

    async function cardRelationships() {
      return (await adapter.getRelationships()).filter((r) =>
        r.sourceTable.startsWith("card_")
      );
    }

    it("calls a unique foreign key one-to-one", async () => {
      // The constraint that stops a second child pointing at the same parent.
      // Every relationship used to be reported as one-to-many regardless.
      const profile = (await cardRelationships()).find(
        (r) => r.sourceTable === "card_profile"
      );

      expect(profile?.type).toBe("one-to-one");
    });

    it("calls a plain foreign key one-to-many", async () => {
      const order = (await cardRelationships()).find(
        (r) => r.sourceTable === "card_order"
      );

      expect(order?.type).toBe("one-to-many");
    });

    it("marks a nullable foreign key as optional", async () => {
      const relationships = await cardRelationships();

      expect(
        relationships.find((r) => r.sourceTable === "card_order")?.optional
      ).toBe(true);
      expect(
        relationships.find((r) => r.sourceTable === "card_profile")?.optional
      ).toBe(false);
    });

    it("reports a pure junction table as many-to-many", async () => {
      const junction = (await cardRelationships()).filter(
        (r) => r.sourceTable === "card_post_tags"
      );

      expect(junction).toHaveLength(2);
      for (const relationship of junction) {
        expect(relationship.type).toBe("many-to-many");
        expect(relationship.viaJunctionTable).toBe("card_post_tags");
      }
    });

    it("leaves a join table that carries its own column alone", async () => {
      // card_membership has a `role`, which makes it an entity. Collapsing it
      // into a many-to-many would hide that column from the diagram.
      const membership = (await cardRelationships()).filter(
        (r) => r.sourceTable === "card_membership"
      );

      expect(membership).toHaveLength(2);
      expect(membership.every((r) => r.type === "one-to-many")).toBe(true);
      expect(membership.every((r) => r.viaJunctionTable === undefined)).toBe(
        true
      );
    });
  });

  describe("a column in two foreign keys", () => {
    beforeAll(async () => {
      await adapter.executeQuery(`
        ALTER TABLE fk_child
        ADD CONSTRAINT fk_second FOREIGN KEY (enterprise_id)
          REFERENCES fk_other (enterprise_id)
      `);
    });

    it("still returns the column once", async () => {
      // The column list holds one reference per column, so a second constraint
      // must not become a second row.
      const columns = await adapter.getTableSchema("fk_child");
      const names = columns.map((c) => c.name);

      expect(names.filter((n) => n === "enterprise_id")).toHaveLength(1);
      expect(new Set(names).size).toBe(names.length);
    });

    it("reports both relationships in the diagram", async () => {
      // Two constraints really are two relationships — the deduplication is
      // about the column list, not about hiding a real edge.
      const relationships = (await adapter.getRelationships()).filter(
        (r) => r.sourceTable === "fk_child" && r.sourceColumn === "enterprise_id"
      );

      expect(relationships.map((r) => r.targetTable).sort()).toEqual([
        "fk_other",
        "fk_parent",
      ]);
    });
  });
});
