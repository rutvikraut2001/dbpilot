import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

/**
 * Connection string for the fixture database. Specs skip when unset so the
 * suite stays runnable without a database present.
 */
export const POSTGRES_URL = process.env.E2E_POSTGRES_URL;

const SEED_PATH = path.resolve(
  process.cwd(),
  "tests/fixtures/postgres/seed.sql"
);

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  if (!POSTGRES_URL) {
    throw new Error("E2E_POSTGRES_URL is not set");
  }
  const client = new Client({ connectionString: POSTGRES_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Drop and recreate the fixture schema, so each spec starts from a known state. */
export async function resetDatabase(): Promise<void> {
  const seed = readFileSync(SEED_PATH, "utf8");
  await withClient((client) => client.query(seed));
}

/** Read a single scalar — used to assert that a UI edit actually reached the DB. */
export async function queryScalar<T = unknown>(
  sql: string,
  params: unknown[] = []
): Promise<T> {
  return withClient(async (client) => {
    const result = await client.query(sql, params);
    return Object.values(result.rows[0])[0] as T;
  });
}

export async function rowCount(table: string): Promise<number> {
  return Number(await queryScalar(`SELECT count(*) FROM ${table}`));
}
