import { describe, it, expect } from "vitest";
import {
  assessSqlRisk,
  assessMongoRisk,
  assessRedisRisk,
  assessRisk,
  hasTopLevelKeyword,
} from "@/lib/query-guard";

describe("hasTopLevelKeyword", () => {
  it("finds a keyword outside parentheses", () => {
    expect(hasTopLevelKeyword("DELETE FROM t WHERE id = 1", "WHERE")).toBe(true);
  });

  it("ignores a keyword only present inside parentheses", () => {
    // The decisive case: this UPDATE has no WHERE of its own, so it rewrites
    // every row — even though the string contains "WHERE".
    expect(
      hasTopLevelKeyword(
        "UPDATE t SET x = (SELECT y FROM z WHERE z.id = 1)",
        "WHERE"
      )
    ).toBe(false);
  });

  it("finds a keyword after a parenthesised expression closes", () => {
    expect(
      hasTopLevelKeyword(
        "UPDATE t SET x = (SELECT 1) WHERE id = 2",
        "WHERE"
      )
    ).toBe(true);
  });

  it("handles nested parentheses", () => {
    expect(
      hasTopLevelKeyword(
        "DELETE FROM t WHERE id IN (SELECT a FROM b WHERE c IN (SELECT d FROM e))",
        "WHERE"
      )
    ).toBe(true);
    expect(
      hasTopLevelKeyword(
        "UPDATE t SET x = (COALESCE((SELECT 1 FROM z WHERE z.q), 0))",
        "WHERE"
      )
    ).toBe(false);
  });

  it("ignores a keyword inside a string literal", () => {
    expect(
      hasTopLevelKeyword("DELETE FROM t -- WHERE nothing", "WHERE")
    ).toBe(false);
    expect(hasTopLevelKeyword("INSERT INTO t VALUES ('WHERE')", "WHERE")).toBe(
      false
    );
  });
});

describe("assessSqlRisk — dangerous", () => {
  it.each([
    ["DELETE FROM users", "every row"],
    ["delete from users", "every row"],
    ["UPDATE users SET status = 'x'", "every row"],
    ["TRUNCATE users", "every row"],
    ["DROP TABLE users", "cannot be undone"],
    ["DROP DATABASE production", "cannot be undone"],
    ["DROP SCHEMA public CASCADE", "cannot be undone"],
    ["ALTER TABLE users DROP COLUMN email", "Drops a column"],
  ])("flags %j", (sql, expectedReason) => {
    const risk = assessSqlRisk(sql);
    expect(risk.level).toBe("dangerous");
    expect(risk.reasons.join(" ")).toContain(expectedReason);
  });

  it("flags an UPDATE whose only WHERE is inside a subquery", () => {
    const risk = assessSqlRisk(
      "UPDATE users SET tier = (SELECT tier FROM defaults WHERE id = 1)"
    );
    expect(risk.level).toBe("dangerous");
    expect(risk.reasons.join(" ")).toContain("every row");
  });

  it("names the dropped object type", () => {
    expect(assessSqlRisk("DROP DATABASE prod").reasons.join(" ")).toContain(
      "database"
    );
    expect(assessSqlRisk("DROP INDEX idx_a").reasons.join(" ")).toContain(
      "index"
    );
  });
});

describe("assessSqlRisk — warn", () => {
  it.each([
    "DELETE FROM users WHERE id = 1",
    "UPDATE users SET name = 'x' WHERE id = 1",
    "INSERT INTO users (name) VALUES ('a')",
    "ALTER TABLE users ADD COLUMN nickname text",
    "GRANT SELECT ON users TO bob",
    "REVOKE SELECT ON users FROM bob",
    "CALL rebuild_stats()",
    "DO $$ BEGIN PERFORM 1; END $$",
  ])("warns on %j", (sql) => {
    expect(assessSqlRisk(sql).level).toBe("warn");
  });

  it("marks scoped DML as estimable", () => {
    expect(assessSqlRisk("DELETE FROM users WHERE id = 1").canEstimateRows).toBe(
      true
    );
    expect(assessSqlRisk("DROP TABLE users").canEstimateRows).toBe(false);
  });
});

describe("assessSqlRisk — safe", () => {
  it.each([
    "SELECT * FROM users",
    "SELECT count(*) FROM users WHERE active",
    "WITH x AS (SELECT 1) SELECT * FROM x",
    "EXPLAIN SELECT * FROM users",
    "SHOW search_path",
  ])("leaves %j alone", (sql) => {
    expect(assessSqlRisk(sql).level).toBe("safe");
  });

  it("is safe for an empty statement", () => {
    expect(assessSqlRisk("").level).toBe("safe");
    expect(assessSqlRisk("   ").level).toBe("safe");
  });
});

describe("assessSqlRisk — batches", () => {
  it("takes the riskiest statement in a batch", () => {
    const risk = assessSqlRisk("SELECT 1; DROP TABLE users;");
    expect(risk.level).toBe("dangerous");
    expect(risk.reasons[0]).toContain("2 statements");
  });

  it("warns for a batch whose worst statement is a scoped write", () => {
    const risk = assessSqlRisk(
      "UPDATE users SET a = 1 WHERE id = 1; SELECT 1;"
    );
    expect(risk.level).toBe("warn");
    expect(risk.reasons[0]).toContain("2 statements");
  });

  it("never offers a row estimate for a batch", () => {
    // Estimating one statement of several would misrepresent the whole batch.
    expect(
      assessSqlRisk("DELETE FROM users WHERE id = 1; DELETE FROM orders;")
        .canEstimateRows
    ).toBe(false);
  });

  it("stays safe for a batch of reads", () => {
    expect(assessSqlRisk("SELECT 1; SELECT 2;").level).toBe("safe");
  });
});

describe("assessMongoRisk", () => {
  it("flags dropping a collection or database", () => {
    expect(assessMongoRisk("db.users.drop()").level).toBe("dangerous");
    expect(assessMongoRisk("db.dropDatabase()").level).toBe("dangerous");
  });

  it("flags an empty filter on a bulk write", () => {
    expect(assessMongoRisk("db.users.deleteMany({})").level).toBe("dangerous");
    expect(assessMongoRisk("db.users.updateMany({ }, {})").level).toBe(
      "dangerous"
    );
  });

  it("warns on a scoped write", () => {
    expect(assessMongoRisk('db.users.deleteMany({ status: "old" })').level).toBe(
      "warn"
    );
    expect(assessMongoRisk("db.users.insertOne({ a: 1 })").level).toBe("warn");
  });

  it("leaves reads alone", () => {
    expect(assessMongoRisk("db.users.find({})").level).toBe("safe");
    expect(assessMongoRisk("db.users.countDocuments({})").level).toBe("safe");
  });
});

describe("assessRedisRisk", () => {
  it("flags server-wide commands", () => {
    expect(assessRedisRisk("FLUSHALL").level).toBe("dangerous");
    expect(assessRedisRisk("flushdb").level).toBe("dangerous");
    expect(assessRedisRisk("CONFIG SET appendonly no").level).toBe("dangerous");
    expect(assessRedisRisk("SHUTDOWN").level).toBe("dangerous");
  });

  it("explains FLUSHALL's blast radius", () => {
    expect(assessRedisRisk("FLUSHALL").reasons.join(" ")).toContain(
      "every database"
    );
  });

  it("warns on a key write", () => {
    expect(assessRedisRisk("SET foo bar").level).toBe("warn");
    expect(assessRedisRisk("DEL foo").level).toBe("warn");
  });

  it("leaves reads alone", () => {
    expect(assessRedisRisk("GET foo").level).toBe("safe");
    expect(assessRedisRisk("TTL foo").level).toBe("safe");
  });
});

describe("assessRisk dispatch", () => {
  it("routes by dialect", () => {
    expect(assessRisk("DELETE FROM users", "sql").level).toBe("dangerous");
    expect(assessRisk("db.users.drop()", "mongodb").level).toBe("dangerous");
    expect(assessRisk("FLUSHALL", "redis").level).toBe("dangerous");
  });

  it("does not apply SQL rules to a Redis command", () => {
    // "DEL foo" would look like nothing to the SQL assessor.
    expect(assessRisk("DEL foo", "redis").level).toBe("warn");
  });
});
