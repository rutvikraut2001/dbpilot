import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MySQLAdapter } from "@/lib/adapters/mysql";

/**
 * Schema introspection and CRUD against a real MySQL.
 *
 * Focused on where MySQL differs from PostgreSQL rather than on the shared
 * adapter contract, because those differences are where this adapter can be
 * wrong while still looking right:
 *
 *   - enum members live inline in COLUMN_TYPE, not in a catalogue to join
 *   - there is no RETURNING, so insert and update have to read the row back
 *   - a boolean is `tinyint(1)`, and the grid hands back the string "false"
 *   - a bigint would lose precision as a JS number, so it must arrive as text
 *
 * Requires TEST_MYSQL_URL; skipped otherwise.
 */
const CONNECTION_STRING = process.env.TEST_MYSQL_URL;

describe.skipIf(!CONNECTION_STRING)("MySQL schema and CRUD", () => {
  let adapter: MySQLAdapter;

  beforeAll(async () => {
    adapter = new MySQLAdapter(CONNECTION_STRING!);
    await adapter.connect();

    // Child first: dropping a referenced table would fail.
    await adapter.executeQuery("DROP VIEW IF EXISTS schema_active_items");
    await adapter.executeQuery("DROP TABLE IF EXISTS schema_items");
    await adapter.executeQuery("DROP TABLE IF EXISTS schema_owners");

    await adapter.executeQuery(`
      CREATE TABLE schema_owners (
        id int AUTO_INCREMENT PRIMARY KEY,
        email varchar(128) NOT NULL UNIQUE
      )
    `);

    await adapter.executeQuery(`
      CREATE TABLE schema_items (
        id bigint AUTO_INCREMENT PRIMARY KEY,
        owner_id int NOT NULL,
        label varchar(64) NOT NULL,
        status enum('active','inactive','pending') NOT NULL DEFAULT 'pending',
        -- Members containing a comma and an escaped quote: splitting the type
        -- string on commas would mangle both.
        awkward enum('a,b','it''s','plain') DEFAULT NULL,
        is_flagged tinyint(1) NOT NULL DEFAULT 0,
        metadata json DEFAULT NULL,
        note text,
        CONSTRAINT fk_schema_items_owner
          FOREIGN KEY (owner_id) REFERENCES schema_owners (id),
        KEY idx_owner_label (owner_id, label)
      )
    `);

    await adapter.executeQuery(`
      CREATE VIEW schema_active_items AS
      SELECT id, label FROM schema_items WHERE status = 'active'
    `);

    await adapter.executeQuery(
      "INSERT INTO schema_owners (email) VALUES ('owner@example.com')"
    );
  });

  afterAll(async () => {
    if (!adapter) return;
    await adapter.executeQuery("DROP VIEW IF EXISTS schema_active_items");
    await adapter.executeQuery("DROP TABLE IF EXISTS schema_items");
    await adapter.executeQuery("DROP TABLE IF EXISTS schema_owners");
    await adapter.disconnect();
  });

  async function ownerId(): Promise<number> {
    const result = await adapter.executeQuery(
      "SELECT id FROM schema_owners LIMIT 1"
    );
    return Number(result.rows[0].id);
  }

  describe("getTables", () => {
    it("lists tables and views, and no system schemas", async () => {
      const tables = await adapter.getTables();
      const names = tables.map((t) => t.name);

      expect(names).toContain("schema_items");
      expect(names).toContain("schema_owners");

      expect(tables.find((t) => t.name === "schema_items")?.type).toBe("table");
      expect(tables.find((t) => t.name === "schema_active_items")?.type).toBe(
        "view"
      );

      // Everything reported belongs to the connected database.
      expect(names).not.toContain("user");
      expect(names).not.toContain("COLUMNS");
    });
  });

  describe("getTableSchema", () => {
    it("reports the full column type, not just the base type", async () => {
      const columns = await adapter.getTableSchema("schema_items");
      const byName = Object.fromEntries(columns.map((c) => [c.name, c]));

      expect(byName.label.type).toBe("varchar(64)");
      expect(byName.owner_id.type).toMatch(/^int/);
      expect(byName.metadata.type).toBe("json");
    });

    it("extracts enum members from the column type", async () => {
      const columns = await adapter.getTableSchema("schema_items");
      const status = columns.find((c) => c.name === "status");

      expect(status?.enumValues).toEqual(["active", "inactive", "pending"]);
      expect(status?.defaultValue).toBe("pending");
    });

    it("parses enum members containing commas and quotes", async () => {
      const columns = await adapter.getTableSchema("schema_items");
      const awkward = columns.find((c) => c.name === "awkward");

      expect(awkward?.enumValues).toEqual(["a,b", "it's", "plain"]);
    });

    it("leaves enumValues unset for a non-enum column", async () => {
      const columns = await adapter.getTableSchema("schema_items");

      expect(columns.find((c) => c.name === "label")?.enumValues).toBeUndefined();
      expect(columns.find((c) => c.name === "metadata")?.enumValues).toBeUndefined();
    });

    it("marks the primary key and reports AUTO_INCREMENT as its default", async () => {
      const columns = await adapter.getTableSchema("schema_items");
      const id = columns.find((c) => c.name === "id");

      expect(id?.isPrimaryKey).toBe(true);
      // MySQL leaves COLUMN_DEFAULT null for an AUTO_INCREMENT column and
      // records it in EXTRA instead; the editor needs to know not to require it.
      expect(id?.defaultValue).toBe("auto_increment");
    });

    it("marks nullability from the catalogue", async () => {
      const columns = await adapter.getTableSchema("schema_items");
      const byName = Object.fromEntries(columns.map((c) => [c.name, c]));

      expect(byName.label.nullable).toBe(false);
      expect(byName.note.nullable).toBe(true);
    });

    it("resolves foreign keys to their target", async () => {
      const columns = await adapter.getTableSchema("schema_items");
      const ownerColumn = columns.find((c) => c.name === "owner_id");

      expect(ownerColumn?.isForeignKey).toBe(true);
      expect(ownerColumn?.foreignKeyRef).toEqual({
        table: "schema_owners",
        column: "id",
      });
    });

    it("returns columns in ordinal order", async () => {
      const columns = await adapter.getTableSchema("schema_items");

      expect(columns.map((c) => c.name)).toEqual([
        "id",
        "owner_id",
        "label",
        "status",
        "awkward",
        "is_flagged",
        "metadata",
        "note",
      ]);
    });

    it("accepts a database-qualified table name", async () => {
      const database = new URL(
        CONNECTION_STRING!.replace(/^mariadb:\/\//, "mysql://")
      ).pathname.replace(/^\//, "");

      const columns = await adapter.getTableSchema(
        `${database}.schema_owners`
      );
      expect(columns.map((c) => c.name)).toEqual(["id", "email"]);
    });

    it("rejects an injected table name rather than interpolating it", async () => {
      await expect(
        adapter.getTableSchema("schema_items`; DROP TABLE schema_items; --")
      ).rejects.toThrow(/Invalid identifier/);

      // Still there.
      expect(await adapter.getTableSchema("schema_items")).not.toHaveLength(0);
    });
  });

  describe("columns belonging to more than one foreign key", () => {
    beforeAll(async () => {
      await adapter.executeQuery("DROP TABLE IF EXISTS multi_fk_child");
      await adapter.executeQuery("DROP TABLE IF EXISTS multi_fk_other");
      await adapter.executeQuery(
        "CREATE TABLE multi_fk_other (owner_id int PRIMARY KEY)"
      );
      await adapter.executeQuery(`
        CREATE TABLE multi_fk_child (
          id int AUTO_INCREMENT PRIMARY KEY,
          owner_id int,
          KEY k_owner (owner_id),
          CONSTRAINT fk_to_owners FOREIGN KEY (owner_id)
            REFERENCES schema_owners (id),
          CONSTRAINT fk_to_other FOREIGN KEY (owner_id)
            REFERENCES multi_fk_other (owner_id)
        )
      `);
    });

    afterAll(async () => {
      await adapter.executeQuery("DROP TABLE IF EXISTS multi_fk_child");
      await adapter.executeQuery("DROP TABLE IF EXISTS multi_fk_other");
    });

    it("returns the column once, not once per constraint", async () => {
      // Joining KEY_COLUMN_USAGE into the column query duplicated the column
      // here, which handed React two list items with the same key and drew the
      // column twice in the ER diagram.
      const names = (await adapter.getTableSchema("multi_fk_child")).map(
        (c) => c.name
      );

      expect(names).toEqual(["id", "owner_id"]);
      expect(new Set(names).size).toBe(names.length);
    });

    it("still reports both relationships", async () => {
      // Two constraints are two real relationships; only the column list is
      // deduplicated.
      const relationships = (await adapter.getRelationships()).filter(
        (r) => r.sourceTable === "multi_fk_child"
      );

      expect(relationships.map((r) => r.targetTable).sort()).toEqual([
        "multi_fk_other",
        "schema_owners",
      ]);
    });
  });

  describe("getRelationships", () => {
    it("reports the foreign key between the two tables", async () => {
      const relationships = await adapter.getRelationships();

      expect(relationships).toContainEqual({
        sourceTable: "schema_items",
        sourceColumn: "owner_id",
        targetTable: "schema_owners",
        targetColumn: "id",
        type: "one-to-many",
      });
    });
  });

  describe("getIndexInfo", () => {
    it("groups columns by index and flags the primary key", async () => {
      const indexes = await adapter.getIndexInfo("schema_items");
      const byName = Object.fromEntries(indexes.map((i) => [i.name, i]));

      expect(byName.PRIMARY.isPrimary).toBe(true);
      expect(byName.PRIMARY.isUnique).toBe(true);
      expect(byName.PRIMARY.columns).toEqual(["id"]);

      // Composite index columns must keep their declared order — reversing them
      // would describe a differently-useful index.
      expect(byName.idx_owner_label.columns).toEqual(["owner_id", "label"]);
      expect(byName.idx_owner_label.isPrimary).toBe(false);
      expect(byName.idx_owner_label.isUnique).toBe(false);
    });

    it("flags a unique constraint's index as unique", async () => {
      const indexes = await adapter.getIndexInfo("schema_owners");
      const email = indexes.find((i) => i.columns.includes("email"));

      expect(email?.isUnique).toBe(true);
      expect(email?.isPrimary).toBe(false);
    });
  });

  describe("getTableStats and getDatabaseStats", () => {
    it("counts the table's indexes", async () => {
      const stats = await adapter.getTableStats("schema_items");

      // PRIMARY, the FK's index, and idx_owner_label.
      expect(stats.indexCount).toBeGreaterThanOrEqual(2);
      expect(stats.sizeBytes).toBeGreaterThan(0);
    });

    it("reports the server version and a table count", async () => {
      const stats = await adapter.getDatabaseStats();

      expect(stats.version).toMatch(/^MySQL /);
      expect(stats.tableCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe("insertRow", () => {
    it("reads the row back with its server-assigned key and defaults", async () => {
      const inserted = await adapter.insertRow("schema_items", {
        owner_id: await ownerId(),
        label: "read-back",
      });

      expect(inserted.id).toBeDefined();
      // Neither was supplied; both come from the table definition.
      expect(inserted.status).toBe("pending");
      expect(Number(inserted.is_flagged)).toBe(0);

      await adapter.deleteRow("schema_items", { id: inserted.id });
    });

    it("returns a bigint key as a string rather than a lossy number", async () => {
      const inserted = await adapter.insertRow("schema_items", {
        owner_id: await ownerId(),
        label: "bigint-key",
      });

      // A bigint rounded through a JS number would eventually address the wrong
      // row on the next edit, so the driver must hand it over as text.
      expect(typeof inserted.id).toBe("string");

      await adapter.deleteRow("schema_items", { id: inserted.id });
    });

    it("coerces the grid's boolean strings for a tinyint(1) column", async () => {
      const owner = await ownerId();

      const off = await adapter.insertRow("schema_items", {
        owner_id: owner,
        label: "flag-off",
        // The grid's cells are text inputs; "false" is a truthy string, and
        // storing it as 1 would invert the value the user chose.
        is_flagged: "false",
      });
      const on = await adapter.insertRow("schema_items", {
        owner_id: owner,
        label: "flag-on",
        is_flagged: "true",
      });

      expect(Number(off.is_flagged)).toBe(0);
      expect(Number(on.is_flagged)).toBe(1);

      await adapter.deleteRows("schema_items", [{ id: off.id }, { id: on.id }]);
    });

    it("stores an object in a json column as JSON", async () => {
      const inserted = await adapter.insertRow("schema_items", {
        owner_id: await ownerId(),
        label: "json-object",
        metadata: { source: "test", tags: ["a", "b"] },
      });

      const stored =
        typeof inserted.metadata === "string"
          ? JSON.parse(inserted.metadata)
          : inserted.metadata;
      expect(stored).toEqual({ source: "test", tags: ["a", "b"] });

      await adapter.deleteRow("schema_items", { id: inserted.id });
    });

    it("stores JSON text in a json column without double-encoding it", async () => {
      const inserted = await adapter.insertRow("schema_items", {
        owner_id: await ownerId(),
        label: "json-text",
        metadata: '{"source":"text"}',
      });

      const stored =
        typeof inserted.metadata === "string"
          ? JSON.parse(inserted.metadata)
          : inserted.metadata;
      expect(stored).toEqual({ source: "text" });

      await adapter.deleteRow("schema_items", { id: inserted.id });
    });

    it("rejects an injected column name rather than interpolating it", async () => {
      await expect(
        adapter.insertRow("schema_items", { "label`, `owner_id": "x" })
      ).rejects.toThrow(/Invalid column name/);
    });
  });

  describe("updateRow", () => {
    it("returns the updated row", async () => {
      const inserted = await adapter.insertRow("schema_items", {
        owner_id: await ownerId(),
        label: "before",
      });

      const updated = await adapter.updateRow(
        "schema_items",
        { id: inserted.id },
        { label: "after", status: "active" }
      );

      expect(updated.label).toBe("after");
      expect(updated.status).toBe("active");

      await adapter.deleteRow("schema_items", { id: inserted.id });
    });

    it("reads the row back by its new key when the key itself changed", async () => {
      const inserted = await adapter.insertRow("schema_items", {
        owner_id: await ownerId(),
        label: "key-change",
      });
      const newId = Number(inserted.id) + 100_000;

      const updated = await adapter.updateRow(
        "schema_items",
        { id: inserted.id },
        { id: newId, label: "moved" }
      );

      expect(Number(updated.id)).toBe(newId);
      expect(updated.label).toBe("moved");

      await adapter.deleteRow("schema_items", { id: newId });
    });

    it("throws rather than reporting success when no row matches", async () => {
      await expect(
        adapter.updateRow(
          "schema_items",
          { id: 999_999_999 },
          { label: "nobody" }
        )
      ).rejects.toThrow(/No rows updated/);
    });

    it("does not mistake an unchanged value for a missing row", async () => {
      const inserted = await adapter.insertRow("schema_items", {
        owner_id: await ownerId(),
        label: "idempotent",
      });

      // MySQL's changedRows would be 0 here; affectedRows is 1, which is why
      // the adapter checks that one instead.
      const updated = await adapter.updateRow(
        "schema_items",
        { id: inserted.id },
        { label: "idempotent" }
      );

      expect(updated.label).toBe("idempotent");

      await adapter.deleteRow("schema_items", { id: inserted.id });
    });
  });

  describe("deleteRow", () => {
    it("reports whether a row was removed", async () => {
      const inserted = await adapter.insertRow("schema_items", {
        owner_id: await ownerId(),
        label: "to-delete",
      });

      expect(await adapter.deleteRow("schema_items", { id: inserted.id })).toBe(
        true
      );
      expect(await adapter.deleteRow("schema_items", { id: inserted.id })).toBe(
        false
      );
    });

    it("refuses to delete without key values", async () => {
      await expect(adapter.deleteRow("schema_items", {})).rejects.toThrow(
        /without primary key/
      );
    });
  });

  describe("executeQuery", () => {
    it("reports affected rows for a statement that returns none", async () => {
      const inserted = await adapter.insertRow("schema_items", {
        owner_id: await ownerId(),
        label: "affected-rows",
      });

      const result = await adapter.executeQuery(
        "UPDATE schema_items SET status = 'active' WHERE label = 'affected-rows'"
      );

      expect(result.error).toBeUndefined();
      expect(result.rowCount).toBe(1);
      expect(result.rows).toEqual([]);

      await adapter.deleteRow("schema_items", { id: inserted.id });
    });

    it("reports column names for an empty result set", async () => {
      // Columns come from the field metadata, so they survive a query that
      // matches nothing — without them the grid renders no headers.
      const result = await adapter.executeQuery(
        "SELECT id, label FROM schema_items WHERE 1 = 0"
      );

      expect(result.rows).toEqual([]);
      expect(result.columns).toEqual(["id", "label"]);
    });

    it("returns the error message instead of throwing", async () => {
      const result = await adapter.executeQuery("SELECT * FROM no_such_table");

      expect(result.rows).toEqual([]);
      expect(result.error).toBeDefined();
    });
  });

  describe("ping", () => {
    it("succeeds on a live connection", async () => {
      expect(await adapter.ping()).toBe(true);
    });

    it("fails without connecting", async () => {
      const disconnected = new MySQLAdapter(CONNECTION_STRING!);
      expect(await disconnected.ping()).toBe(false);
    });
  });
});
