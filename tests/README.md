# Tests

Three layers, each runnable on its own.

| Layer | Location | Needs a database? | Command |
| --- | --- | --- | --- |
| Unit | `tests/unit` | no | `npm test` |
| API / integration | `tests/integration` | PostgreSQL for one file | `npm test` |
| End-to-end | `tests/e2e` | yes | `npm run test:e2e` |

Suites that need a database skip themselves when their environment variable is
unset, so `npm test` is always safe to run with nothing else running.

## Starting the fixture databases

```bash
docker compose --profile with-db up -d postgres
```

That publishes PostgreSQL on `localhost:5432` as `postgres/postgres`, database
`testdb`.

## Running everything

```bash
# Unit + API tests (no database required)
npm test

# Add the PostgreSQL integration suite
TEST_POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/testdb npm test

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
SQL, multi-statement batches, Redis flush) and asserts both the 403 *and* that
the adapter method was never reached. Database drivers are mocked; this is about
whether a write ever gets that far.

**`tests/integration/postgres-read-only.test.ts`** — the same guarantees against
a real PostgreSQL, going straight through the adapter so the keyword pre-flight
is bypassed entirely. Covers what no parser can catch: writes inside `VOLATILE`
functions, `DO` blocks, data-modifying CTEs, and a write as the second statement
of a batch. Requires `TEST_POSTGRES_URL`.

**`tests/unit/cache-keys.test.ts`** — the row-count cache keys: filter keys are
order-independent (or the cache would miss every request), and a table's
invalidation prefix covers its own keys without matching a similarly-named table.

**`tests/integration/postgres-performance.test.ts`** — `includeTotal` returns the
same page with or without the count; `orderBy` is deterministic, validated, and
covers every row exactly once across a full walk; `deleteRows` removes exactly
the rows given in a single statement and rolls back entirely on failure.
Requires `TEST_POSTGRES_URL`.

**`tests/e2e`** — the workflows a user actually performs: connecting, browsing,
paginating, sorting, following a foreign key, editing and deleting rows, bulk
delete, running queries, and the read-only toggle agreeing with the server across
a reload. Requires `E2E_POSTGRES_URL`.

**`tests/e2e/virtualization.spec.ts`** — pins the virtualization contract: mounted
row count stays bounded no matter how large the result. A 5000-row query mounts
~19 rows. Asserted on DOM row count rather than timing, so a regression that
reverts to rendering every row fails loudly instead of just being slow.

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

Only PostgreSQL has a service in CI today, because only PostgreSQL has tests
that need one.
