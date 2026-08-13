/**
 * SQL/NoSQL query inspection used by read-only enforcement.
 *
 * IMPORTANT: nothing in this file is the security boundary. Keyword matching on
 * user-supplied SQL is a denylist, and denylists on a language as large as SQL
 * always leak. The real guarantee comes from the database engine itself —
 * `SET TRANSACTION READ ONLY` for PostgreSQL, `readonly=1` for ClickHouse.
 * These helpers exist to (a) reject obviously-wrong input early with a clear
 * message, and (b) enforce read-only for MongoDB/Redis, which have no
 * per-session equivalent we can set.
 *
 * Kept free of `server-only` so it can be unit-tested directly.
 */

type SqlSegmentKind = "code" | "comment" | "string";

interface SqlSegment {
  kind: SqlSegmentKind;
  text: string;
}

const IDENT_CHAR = /[A-Za-z0-9_$]/;
const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/**
 * Tokenize SQL into code / comment / string-literal segments.
 *
 * Handles the constructs that let a naive regex be fooled: line and (nesting)
 * block comments, standard `''`-escaped strings, `E'\''` escape strings,
 * double-quoted identifiers, and dollar-quoted bodies like `$$ ... $$`.
 */
export function scanSql(sql: string): SqlSegment[] {
  const segments: SqlSegment[] = [];
  let code = "";
  let i = 0;
  const n = sql.length;

  const flushCode = () => {
    if (code) {
      segments.push({ kind: "code", text: code });
      code = "";
    }
  };

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    // -- line comment
    if (ch === "-" && next === "-") {
      flushCode();
      const newline = sql.indexOf("\n", i);
      const stop = newline === -1 ? n : newline;
      segments.push({ kind: "comment", text: sql.slice(i, stop) });
      i = stop;
      continue;
    }

    // /* block comment */ — PostgreSQL nests these, so track depth.
    if (ch === "/" && next === "*") {
      flushCode();
      const start = i;
      let depth = 0;
      while (i < n) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
          continue;
        }
        if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
          if (depth === 0) break;
          continue;
        }
        i++;
      }
      segments.push({ kind: "comment", text: sql.slice(start, i) });
      continue;
    }

    // 'string literal' — backslash escapes only apply to E'...' strings.
    if (ch === "'") {
      const prev = sql[i - 1];
      const beforePrev = sql[i - 2];
      const isEscapeString =
        (prev === "E" || prev === "e") &&
        !(beforePrev !== undefined && IDENT_CHAR.test(beforePrev));

      flushCode();
      const start = i;
      i++; // consume opening quote
      while (i < n) {
        if (isEscapeString && sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      segments.push({ kind: "string", text: sql.slice(start, i) });
      continue;
    }

    // "quoted identifier"
    if (ch === '"') {
      flushCode();
      const start = i;
      i++;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      segments.push({ kind: "string", text: sql.slice(start, i) });
      continue;
    }

    // $tag$ dollar-quoted body $tag$ (also bare $$ ... $$)
    if (ch === "$") {
      const match = DOLLAR_TAG.exec(sql.slice(i));
      if (match) {
        flushCode();
        const tag = match[0];
        const start = i;
        const close = sql.indexOf(tag, i + tag.length);
        i = close === -1 ? n : close + tag.length;
        segments.push({ kind: "string", text: sql.slice(start, i) });
        continue;
      }
    }

    code += ch;
    i++;
  }

  flushCode();
  return segments;
}

/**
 * Replace comments and string literals with a single space, leaving only the
 * structural SQL. Keyword matching runs against this so a keyword hidden in a
 * comment or a string can neither trigger nor evade a match.
 */
export function sqlWithoutNoise(sql: string): string {
  return scanSql(sql)
    .map((segment) => (segment.kind === "code" ? segment.text : " "))
    .join("");
}

/**
 * Split SQL on statement-terminating semicolons, ignoring semicolons that sit
 * inside comments, string literals, or dollar-quoted bodies.
 * Empty/whitespace-only statements (e.g. a trailing `;`) are dropped.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let buffer = "";

  for (const segment of scanSql(sql)) {
    if (segment.kind !== "code") {
      buffer += segment.text;
      continue;
    }

    let rest = segment.text;
    let idx = rest.indexOf(";");
    while (idx !== -1) {
      buffer += rest.slice(0, idx);
      statements.push(buffer);
      buffer = "";
      rest = rest.slice(idx + 1);
      idx = rest.indexOf(";");
    }
    buffer += rest;
  }

  statements.push(buffer);
  return statements.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * True when the input contains more than one SQL statement.
 *
 * `pool.query(sql)` with no bind parameters uses PostgreSQL's simple query
 * protocol, which happily executes `SELECT 1; DROP TABLE users;` as a batch.
 * Read-only mode rejects multi-statement input outright so that a leading
 * harmless statement can't smuggle a second one past the keyword check.
 */
export function hasMultipleStatements(sql: string): boolean {
  return splitSqlStatements(sql).length > 1;
}

/**
 * Keywords that begin a statement capable of changing data, schema, or session
 * state. Transaction control is included because read-only execution owns the
 * surrounding transaction — a user-issued BEGIN/COMMIT would fight it.
 */
const SQL_WRITE_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "UPSERT",
  "DROP",
  "CREATE",
  "ALTER",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "COPY",
  "VACUUM",
  "ANALYZE",
  "REINDEX",
  "CLUSTER",
  "REFRESH",
  "COMMENT",
  "IMPORT",
  "DISCARD",
  "LOCK",
  // Procedural entry points — the body is opaque to keyword matching.
  "DO",
  "CALL",
  // Session/transaction state.
  "SET",
  "RESET",
  "BEGIN",
  "START",
  "COMMIT",
  "ROLLBACK",
  "SAVEPOINT",
] as const;

/**
 * The only data-modifying verbs PostgreSQL permits after a CTE. Matching just
 * these — rather than the full keyword list — keeps `WITH x AS (SELECT CASE
 * WHEN ... END ...)` from being misread as a write.
 */
const CTE_WRITE_VERBS = ["INSERT", "UPDATE", "DELETE", "MERGE"] as const;

function containsKeyword(normalized: string, keyword: string): boolean {
  return new RegExp(`(^|[^A-Z_])${keyword}([^A-Z_]|$)`).test(normalized);
}

function statementIsWrite(statement: string): boolean {
  const normalized = sqlWithoutNoise(statement)
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

  if (!normalized) return false;

  // Leading parentheses are legal before a SELECT; strip them to find the verb.
  const leading = normalized.replace(/^[(\s]+/, "");
  const firstWord = /^[A-Z]+/.exec(leading)?.[0] ?? "";

  if ((SQL_WRITE_KEYWORDS as readonly string[]).includes(firstWord)) {
    return true;
  }

  // WITH ... AS (...) INSERT/UPDATE/DELETE — the write verb trails the CTE.
  if (firstWord === "WITH") {
    return (CTE_WRITE_VERBS as readonly string[]).some((verb) =>
      containsKeyword(normalized, verb)
    );
  }

  // SELECT ... INTO new_table creates a table.
  if (firstWord === "SELECT" && containsKeyword(normalized, "INTO")) {
    return true;
  }

  return false;
}

/**
 * True if any statement in the input writes. Comments and string literals are
 * stripped first, so `/* x *​/ DELETE ...` and `SELECT 'DELETE'` are both
 * classified correctly.
 */
export function isWriteSql(sql: string): boolean {
  return splitSqlStatements(sql).some(statementIsWrite);
}

const MONGO_WRITE_OPERATIONS = [
  "insertOne",
  "insertMany",
  "updateOne",
  "updateMany",
  "deleteOne",
  "deleteMany",
  "drop",
  "createIndex",
  "dropIndex",
  "dropIndexes",
  "renameCollection",
  "replaceOne",
  "bulkWrite",
  "findOneAndUpdate",
  "findOneAndDelete",
  "findOneAndReplace",
  "createCollection",
  "dropDatabase",
] as const;

/** True if a MongoDB shell-style query invokes a write operation. */
export function isWriteMongoQuery(query: string): boolean {
  return MONGO_WRITE_OPERATIONS.some((op) => query.includes(`.${op}(`));
}

const REDIS_WRITE_COMMANDS = new Set([
  "SET", "SETNX", "SETEX", "PSETEX", "SETRANGE", "MSET", "MSETNX",
  "GETSET", "GETDEL",
  "DEL", "UNLINK",
  "INCR", "DECR", "INCRBY", "DECRBY", "INCRBYFLOAT",
  "APPEND",
  "LPUSH", "RPUSH", "LPUSHX", "RPUSHX", "LPOP", "RPOP", "BLPOP", "BRPOP",
  "LSET", "LTRIM", "LINSERT", "LREM", "LMOVE", "RPOPLPUSH",
  "SADD", "SREM", "SPOP", "SMOVE", "SDIFFSTORE", "SINTERSTORE", "SUNIONSTORE",
  "ZADD", "ZREM", "ZINCRBY", "ZPOPMIN", "ZPOPMAX",
  "ZRANGESTORE", "ZDIFFSTORE", "ZINTERSTORE", "ZUNIONSTORE", "ZREMRANGEBYSCORE",
  "ZREMRANGEBYRANK", "ZREMRANGEBYLEX",
  "HSET", "HSETNX", "HDEL", "HINCRBY", "HINCRBYFLOAT", "HMSET",
  "EXPIRE", "EXPIREAT", "PEXPIRE", "PEXPIREAT", "PERSIST",
  "RENAME", "RENAMENX",
  "FLUSHDB", "FLUSHALL", "SWAPDB",
  "XADD", "XDEL", "XTRIM", "XGROUP", "XACK", "XCLAIM",
  "PFADD", "PFMERGE",
  "RESTORE", "MIGRATE", "MOVE", "COPY",
  "SETBIT", "BITOP", "BITFIELD",
  "GEOADD",
  // Server-state mutation and arbitrary execution.
  "CONFIG", "SCRIPT", "EVAL", "EVALSHA", "FUNCTION", "SHUTDOWN", "DEBUG",
  "SLAVEOF", "REPLICAOF", "FAILOVER", "RESET", "CLIENT", "ACL",
  "BGSAVE", "SAVE", "BGREWRITEAOF",
  "MULTI", "EXEC", "DISCARD",
]);

/** True if a Redis command mutates data or server state. */
export function isWriteRedisCommand(query: string): boolean {
  const command = query.trim().split(/\s+/)[0]?.toUpperCase();
  if (!command) return false;
  return REDIS_WRITE_COMMANDS.has(command);
}
