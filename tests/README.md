# Tests

Three layers, each runnable on its own.

| Layer | Location | Needs a database? | Command |
| --- | --- | --- | --- |
| Unit | `tests/unit` | no | `npm test` |
| API / integration | `tests/integration` | PostgreSQL and MySQL for some files | `npm test` |
| End-to-end | `tests/e2e` | yes | `npm run test:e2e` |

Suites that need a database skip themselves when their environment variable is
unset, so `npm test` is always safe to run with nothing else running.

## Starting the fixture databases

```bash
docker compose --profile with-db up -d postgres mysql
```

That publishes PostgreSQL on `localhost:5432` as `postgres/postgres` and MySQL
on `localhost:3306` as `root/mysql`, both with database `testdb`.

## Running everything

```bash
# Unit + API tests (no database required)
npm test

# Add the PostgreSQL integration suite
TEST_POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/testdb npm test

# Add the MySQL integration suites
TEST_MYSQL_URL=mysql://root:mysql@localhost:3306/testdb npm test

# End-to-end
E2E_POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/testdb npm run test:e2e

# End-to-end, interactive
E2E_POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/testdb npm run test:e2e:ui
```

The E2E runner builds the app and serves it in production mode on port 3123
(override with `E2E_PORT`). It raises `RATE_LIMIT_MAX_REQUESTS` for that server:
the limiter keys on client IP, and the whole suite arrives from one address, so
at the default of 100/min it would start returning 429 partway through.

## What each layer covers

**`tests/unit/query-guard.test.ts`** — the SQL tokenizer behind read-only mode:
statement splitting around string literals, dollar-quoted bodies and nesting
block comments, plus write detection for SQL, MongoDB and Redis.

**`tests/unit/server-state.test.ts`** — read-only state transitions, including
that reconnecting never downgrades a connection and that `FORCE_READ_ONLY`
cannot be overridden.

**`tests/integration/read-only-enforcement.test.ts`** — calls the API route
handlers directly with hostile requests (client-supplied `readOnly=false`, write
SQL, multi-statement batches, Redis flush, index create/drop) and asserts both
the 403 *and* that the adapter method was never reached. Database drivers are
mocked; this is about whether a write ever gets that far. Index *listing* is
asserted to still succeed — read-only restricts writes, not visibility.

**`tests/integration/postgres-read-only.test.ts`** — the same guarantees against
a real PostgreSQL, going straight through the adapter so the keyword pre-flight
is bypassed entirely. Covers what no parser can catch: writes inside `VOLATILE`
functions, `DO` blocks, data-modifying CTEs, and a write as the second statement
of a batch. Requires `TEST_POSTGRES_URL`.

**`tests/integration/mysql-read-only.test.ts`** — the same guarantees as the
PostgreSQL suite above, against a real MySQL and through the adapter, so the
keyword pre-flight is bypassed entirely. Covers what no parser can catch: a
write inside a `CALL`ed stored procedure, DDL, `REPLACE`, `INSERT ... ON
DUPLICATE KEY UPDATE`, and `GRANT`. Also asserts the pooled connection is
neither left read-only nor mid-transaction afterwards — it is a small pool, so a
leaked session setting would refuse the next legitimate write. Requires
`TEST_MYSQL_URL`.

**`tests/integration/mysql-schema.test.ts`** — introspection and CRUD where
MySQL differs from PostgreSQL, which is where this adapter can be wrong while
still looking right: enum members parsed out of `COLUMN_TYPE` (there is no
catalogue to join), insert and update reading the row back because there is no
`RETURNING`, `tinyint(1)` receiving the grid's string `"false"`, and a bigint key
arriving as text rather than a rounded number. Requires `TEST_MYSQL_URL`.

**`tests/integration/mysql-performance.test.ts`** — the same paging, bulk-delete
and estimation contract as the PostgreSQL suite, so both adapters are held to one
standard. The row estimates assert exact numbers: MySQL reports
`filtered: 100.00` for *every* DML plan, so a scoped `DELETE` matching half the
table would otherwise be previewed as the whole table. Requires
`TEST_MYSQL_URL`.

**`tests/unit/mysql-connection.test.ts`** — everything about MySQL support that
needs no server: connection strings rejected before a socket is opened (with the
reason, not a ten-second timeout), the `mariadb://` alias, the dialect that
decides which read-only enforcement applies, the Unix-socket fallback
strategies, and credential redaction in error messages.

**`tests/unit/database-name.test.ts`** — database name handling, which is
deliberately *not* the identifier validation used for tables and columns. A real
PostgreSQL server used during development held databases called `CR-DB`,
`next-plugin` and `ugp_bos_2.0`: five of its sixteen would have been unreachable
had `columnNameRegex` been reused here. Safety comes from quoting instead, so
most of the suite is about names that must be accepted, plus the doubling escape
that keeps a name like `x"; DROP DATABASE postgres; --` one identifier rather
than two statements.

**`tests/integration/postgres-databases.test.ts`** — connecting with no database
named, then listing, creating and switching. Pins that a failed switch leaves the
adapter on its previous database rather than with no pool at all, and that the
table list follows the switch. Requires `TEST_POSTGRES_URL`.

**`tests/integration/mysql-databases.test.ts`** — the same contract where the
"no database selected" state is genuinely null rather than a driver default, so
`getTables()` returning an empty list instead of throwing is the behaviour under
test. Requires `TEST_MYSQL_URL`.

**`tests/unit/index-health.test.ts`** — the index health rules, which decide
what the UI suggests *dropping*. The cases that matter are the false positives: a
partial index must never make a full index look redundant (dropping it would
leave every non-matching row unindexed), a unique index is never redundant
because a wider index does not enforce its constraint, and an engine that cannot
report scan counts must produce no "unused" findings rather than accusing every
index at once.

**`tests/integration/postgres-indexes.test.ts`** — listing and management against
a real PostgreSQL. Pins the column-order regression (reading key columns from
`pg_attribute` returns *table* order, so an index on `(b, a)` read back as
`(a, b)` — a different index, and one that defeats the prefix analysis), covers
expression and partial indexes, and asserts that a partial-index predicate
carrying a second statement is refused with the table still standing. Requires
`TEST_POSTGRES_URL`.

**`tests/integration/mysql-indexes.test.ts`** — the same contract against MySQL,
plus where it differs: FULLTEXT/SPATIAL as a CREATE prefix rather than a USING
clause, no partial indexes (refused rather than silently built full), and
`PRIMARY` as the primary key's name. Requires `TEST_MYSQL_URL`.

**`tests/unit/cache-keys.test.ts`** — the row-count cache keys: filter keys are
order-independent (or the cache would miss every request), and a table's
invalidation prefix covers its own keys without matching a similarly-named table.

**`tests/integration/postgres-performance.test.ts`** — `includeTotal` returns the
same page with or without the count; `orderBy` is deterministic, validated, and
covers every row exactly once across a full walk; `deleteRows` removes exactly
the rows given in a single statement and rolls back entirely on failure. Also
`estimateAffectedRows`: it reports 1000 rows for an unscoped DELETE **and the
table still holds 1000 rows afterwards**, which is the property that makes the
preview safe. And `cancelQuery`: a `pg_sleep(30)` aborts in ~300ms on both the
read-write and read-only paths, the connection stays usable afterwards, and
repeated cancellations do not leak pooled clients. Requires `TEST_POSTGRES_URL`.

**`tests/e2e`** — the workflows a user actually performs: connecting, browsing,
paginating, sorting, following a foreign key, editing and deleting rows, bulk
delete, running queries, and the read-only toggle agreeing with the server across
a reload. Requires `E2E_POSTGRES_URL`.

**`tests/e2e/virtualization.spec.ts`** — pins the virtualization contract: mounted
row count stays bounded no matter how large the result. A 5000-row query mounts
~19 rows. Asserted on DOM row count rather than timing, so a regression that
reverts to rendering every row fails loudly instead of just being slow.

**`tests/unit/api-client.test.ts`** — the shared fetch wrapper: transport
failures, non-2xx bodies, 429s with and without `Retry-After`, and a 2xx body
that carries an `error` field (several routes report failures that way and
callers used to read straight past it).

**`tests/e2e/error-handling.spec.ts`** — failures are visible and recoverable.
Intercepts requests to force a 500, a 429 and a dropped connection, then asserts
the UI names the problem, offers a retry, and does *not* show the empty-state
message. Also asserts the inverse: a genuinely empty table reads as empty.

**`tests/e2e/workspace-persistence.spec.ts`** — open tabs, unsaved query text and
the sidebar layout survive a reload; query *results* are not written to
localStorage; and tabs belonging to a different connection are not restored.

**`tests/unit/query-risk.test.ts`** — the destructive-statement classifier:
DELETE/UPDATE without a top-level WHERE, DROP, TRUNCATE, `ALTER ... DROP COLUMN`,
Mongo `drop()`/empty-filter bulk writes, Redis `FLUSHALL`. Includes the
parenthesis-depth cases — `UPDATE t SET x = (SELECT ... WHERE ...)` has no WHERE
of its own and must still be flagged as unscoped.

**`tests/e2e/query-safety.spec.ts`** — the confirmation gate end to end: a SELECT
runs unprompted; an unscoped DELETE requires the verb typed before the button
enables; cancelling leaves the data intact; a scoped DELETE shows an estimated
row count labelled as an estimate. Also the production treatment (stripe, badge,
required reason) and that a write grant is time-boxed with a live countdown.

**`tests/e2e/query-workspace.spec.ts`** — history (timing, row count, failures,
survives a reload, clearable), saved queries (save/load/delete), running only the
highlighted selection, and cancelling a long-running query.

**`tests/e2e/request-efficiency.spec.ts`** — guards against redundant network
work: opening a table fetches its schema once (the sidebar and the data viewer
both used to request it), and paging reuses the cached row count instead of
re-counting. Assertions are on request counts, which is what a user waits on and
what regresses silently when a new effect is added.

## Fixtures

`tests/fixtures/postgres/seed.sql` builds the schema the E2E suite expects: 120
users (more than one page at the default page size of 50), 300 orders with a
foreign key back to users, an enum, a JSONB column, nullable columns, and a
view. It is idempotent — `resetDatabase()` reruns it before each E2E test.

## Adding a database

The adapter interface is the seam. To cover MongoDB, ClickHouse or Redis the
same way:

1. add a fixture under `tests/fixtures/<engine>/`
2. add an integration suite guarded by a `TEST_<ENGINE>_URL` variable
3. add the service to `.github/workflows/ci.yml`

PostgreSQL and MySQL have services in CI; MongoDB, ClickHouse and Redis do not,
because they have no tests that need one yet.

The E2E suite is PostgreSQL-only. Its fixture and helpers are written against
`tests/fixtures/postgres/seed.sql`, so covering a second engine end to end means
parameterizing the harness rather than adding a file — the MySQL adapter is
covered at the integration layer instead, which is where the engine-specific
behaviour lives.
