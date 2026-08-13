import { describe, it, expect } from "vitest";
import {
  splitSqlStatements,
  hasMultipleStatements,
  isWriteSql,
  isWriteMongoQuery,
  isWriteRedisCommand,
  sqlWithoutNoise,
} from "@/lib/query-guard";

describe("splitSqlStatements", () => {
  it("splits on statement terminators", () => {
    expect(splitSqlStatements("SELECT 1; SELECT 2")).toEqual([
      "SELECT 1",
      "SELECT 2",
    ]);
  });

  it("ignores a trailing semicolon", () => {
    expect(splitSqlStatements("SELECT 1;")).toEqual(["SELECT 1"]);
    expect(hasMultipleStatements("SELECT 1;")).toBe(false);
  });

  it("does not split on a semicolon inside a string literal", () => {
    expect(splitSqlStatements("SELECT ';'")).toHaveLength(1);
    expect(
      splitSqlStatements("SELECT * FROM t WHERE name = 'a;b'")
    ).toHaveLength(1);
  });

  it("does not split on a semicolon inside a quoted identifier", () => {
    expect(splitSqlStatements('SELECT "we;ird" FROM t')).toHaveLength(1);
  });

  it("does not split on a semicolon inside a comment", () => {
    expect(splitSqlStatements("SELECT 1 -- ; not a statement")).toHaveLength(1);
    expect(splitSqlStatements("SELECT 1 /* ; */ + 2")).toHaveLength(1);
  });

  it("does not split inside a dollar-quoted body", () => {
    expect(
      splitSqlStatements("DO $$ BEGIN PERFORM 1; PERFORM 2; END $$")
    ).toHaveLength(1);
    expect(
      splitSqlStatements("SELECT $tag$ a; b $tag$")
    ).toHaveLength(1);
  });

  it("handles doubled-quote escapes", () => {
    expect(splitSqlStatements("SELECT 'it''s; fine'")).toHaveLength(1);
  });

  it("handles backslash escapes in E'' strings", () => {
    expect(splitSqlStatements("SELECT E'a\\';b'")).toHaveLength(1);
  });

  it("treats nested block comments as one comment", () => {
    expect(
      splitSqlStatements("SELECT 1 /* outer /* inner ; */ still ; */ , 2")
    ).toHaveLength(1);
  });
});

describe("sqlWithoutNoise", () => {
  it("removes comments and string contents", () => {
    expect(sqlWithoutNoise("SELECT 'DELETE' -- DROP TABLE x").trim()).toBe(
      "SELECT"
    );
  });

  it("does not fuse adjacent tokens when removing a string", () => {
    // Without a separator this would collapse to SELECTFROM.
    expect(sqlWithoutNoise("SELECT'a'FROM t")).toContain("SELECT ");
  });
});

describe("isWriteSql", () => {
  it.each([
    "SELECT * FROM users",
    "select id from users where status = 'active'",
    "  SELECT 1  ",
    "(SELECT 1)",
    "SHOW search_path",
    "EXPLAIN SELECT * FROM users",
    "WITH active AS (SELECT * FROM users) SELECT * FROM active",
    "TABLE users",
    "VALUES (1), (2)",
  ])("treats %j as a read", (query) => {
    expect(isWriteSql(query)).toBe(false);
  });

  it.each([
    "DELETE FROM users",
    "delete from users where id = 1",
    "INSERT INTO users (id) VALUES (1)",
    "UPDATE users SET status = 'x'",
    "DROP TABLE users",
    "TRUNCATE users",
    "ALTER TABLE users ADD COLUMN x INT",
    "CREATE TABLE t (id INT)",
    "GRANT ALL ON users TO bob",
    "VACUUM users",
    "DO $$ BEGIN DELETE FROM users; END $$",
    "CALL do_something()",
    "SET TRANSACTION READ WRITE",
    "BEGIN",
    "COMMIT",
  ])("treats %j as a write", (query) => {
    expect(isWriteSql(query)).toBe(true);
  });

  it("catches a data-modifying CTE", () => {
    expect(
      isWriteSql("WITH gone AS (DELETE FROM users RETURNING *) SELECT * FROM gone")
    ).toBe(true);
  });

  it("catches SELECT ... INTO, which creates a table", () => {
    expect(isWriteSql("SELECT * INTO backup FROM users")).toBe(true);
  });

  it("catches a write hidden behind a block comment", () => {
    // The previous implementation stripped comments with a regex applied after
    // the startsWith check, so this form slipped through.
    expect(isWriteSql("/* harmless */ DELETE FROM users")).toBe(true);
  });

  it("catches a write as the second statement of a batch", () => {
    // The exact read-only bypass this work exists to close: leading SELECT,
    // trailing DROP, executed together by the simple query protocol.
    expect(isWriteSql("SELECT 1; DROP TABLE users;")).toBe(true);
    expect(hasMultipleStatements("SELECT 1; DROP TABLE users;")).toBe(true);
  });

  it("does not flag identifiers that merely contain a keyword", () => {
    expect(isWriteSql("SELECT * FROM update_log")).toBe(false);
    expect(isWriteSql("SELECT delete_count FROM stats")).toBe(false);
    expect(isWriteSql("SELECT * FROM created_items")).toBe(false);
  });

  it("does not flag a keyword appearing only inside a string", () => {
    expect(isWriteSql("SELECT * FROM audit WHERE action = 'DELETE'")).toBe(
      false
    );
  });

  it("does not flag CASE ... END as transaction control", () => {
    expect(
      isWriteSql(
        "WITH x AS (SELECT CASE WHEN a THEN 1 ELSE 0 END AS f FROM t) SELECT * FROM x"
      )
    ).toBe(false);
  });
});

describe("isWriteMongoQuery", () => {
  it("allows reads", () => {
    expect(isWriteMongoQuery("db.users.find({})")).toBe(false);
    expect(isWriteMongoQuery("db.users.countDocuments({})")).toBe(false);
    expect(isWriteMongoQuery("db.users.aggregate([])")).toBe(false);
  });

  it("blocks writes", () => {
    expect(isWriteMongoQuery("db.users.deleteMany({})")).toBe(true);
    expect(isWriteMongoQuery("db.users.insertOne({a:1})")).toBe(true);
    expect(isWriteMongoQuery("db.users.findOneAndUpdate({}, {})")).toBe(true);
    expect(isWriteMongoQuery("db.users.drop()")).toBe(true);
  });
});

describe("isWriteRedisCommand", () => {
  it("allows reads", () => {
    expect(isWriteRedisCommand("GET foo")).toBe(false);
    expect(isWriteRedisCommand("hgetall myhash")).toBe(false);
    expect(isWriteRedisCommand("TTL foo")).toBe(false);
    expect(isWriteRedisCommand("SCAN 0")).toBe(false);
  });

  it("blocks writes and server-state mutation", () => {
    expect(isWriteRedisCommand("SET foo bar")).toBe(true);
    expect(isWriteRedisCommand("del foo")).toBe(true);
    expect(isWriteRedisCommand("FLUSHALL")).toBe(true);
    expect(isWriteRedisCommand("CONFIG SET appendonly no")).toBe(true);
    expect(isWriteRedisCommand("EVAL \"redis.call('del', KEYS[1])\" 1 k")).toBe(
      true
    );
  });
});
