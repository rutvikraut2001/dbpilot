/**
 * Validation and quoting for database names.
 *
 * Deliberately separate from the table/column identifier rules in
 * `validation.ts`, because a database name is not an identifier of that kind.
 * `columnNameRegex` demands `^[a-zA-Z_][a-zA-Z0-9_]*$`, and real databases are
 * routinely called `CR-DB`, `next-plugin` or `ugp_bos_2.0` — every one of which
 * that pattern rejects. Applying it here would make a third of a typical server's
 * databases unreachable.
 *
 * The safety property is therefore quoting, not restriction: every engine below
 * has a quoted-identifier form that accepts arbitrary text, escaping the quote
 * character by doubling it. What is rejected is only what quoting cannot make
 * safe — control characters, and the handful of characters each engine forbids
 * outright.
 *
 * Kept free of `server-only` so it can be unit-tested directly.
 */

/** Longest name the engines here accept (PostgreSQL 63 bytes, MySQL 64). */
const MAX_NAME_BYTES = 63;

/**
 * Characters no amount of quoting makes safe.
 *
 * A NUL terminates the string inside the C client libraries, and other control
 * characters cannot be represented inside a quoted identifier at all.
 */
const CONTROL_CHARACTERS = /[\x00-\x1F\x7F]/;

export class InvalidDatabaseNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDatabaseNameError';
  }
}

/**
 * Reject a name that cannot be safely used, whatever the engine.
 *
 * Deliberately permissive: this is the floor every engine shares, and each
 * adapter adds its own rules on top.
 */
export function assertValidDatabaseName(name: string): void {
  if (!name?.trim()) {
    throw new InvalidDatabaseNameError('Database name cannot be empty');
  }

  if (name !== name.trim()) {
    // Leading or trailing spaces are legal when quoted but essentially always a
    // typo, and produce a database nobody can address without knowing.
    throw new InvalidDatabaseNameError(
      'Database name cannot start or end with a space'
    );
  }

  if (CONTROL_CHARACTERS.test(name)) {
    throw new InvalidDatabaseNameError(
      'Database name cannot contain control characters'
    );
  }

  // Byte length, not character length: both engines count bytes, so a name of
  // multi-byte characters runs out sooner than it looks.
  if (Buffer.byteLength(name, 'utf8') > MAX_NAME_BYTES) {
    throw new InvalidDatabaseNameError(
      `Database name cannot be longer than ${MAX_NAME_BYTES} bytes`
    );
  }
}

/**
 * Quote for PostgreSQL and any engine using double-quoted identifiers.
 *
 * The escape is doubling, so a name containing `"` stays intact rather than
 * terminating the identifier early — which is the whole mechanism preventing a
 * crafted name from becoming SQL.
 */
export function quoteDoubleQuoted(name: string): string {
  assertValidDatabaseName(name);
  return `"${name.replaceAll('"', '""')}"`;
}

/** Quote for MySQL and ClickHouse, which use backticks. */
export function quoteBackticked(name: string): string {
  assertValidDatabaseName(name);
  return `\`${name.replaceAll('`', '``')}\``;
}

/**
 * Characters MongoDB forbids in a database name.
 *
 * Unlike the SQL engines there is no quoting form to fall back on — the name
 * becomes part of a filesystem path, so the restriction is real rather than
 * syntactic.
 */
const MONGO_FORBIDDEN = /[/\\. "$*<>:|?]/;

export function assertValidMongoDatabaseName(name: string): void {
  assertValidDatabaseName(name);

  if (MONGO_FORBIDDEN.test(name)) {
    throw new InvalidDatabaseNameError(
      String.raw`A MongoDB database name cannot contain any of / \ . " $ * < > : | ? or a space`
    );
  }
}

/**
 * Parse a connection string, requiring a scheme *and* a host.
 *
 * `new URL` alone is not enough: it happily parses `localhost:6379` as scheme
 * `localhost:` with path `6379`, so a bare host:port DSN would look like a URL
 * whose "database" is the port number — and rewriting it would produce
 * `localhost:/newdb`. Demanding an authority is what separates a real
 * `scheme://host/db` from that.
 */
function parseConnectionUrl(
  connectionString: string
): { url: URL; scheme: string } | null {
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(connectionString)?.[1];
  if (!scheme) return null;

  // Schemes with a `+` (mongodb+srv) are not special-cased by the URL parser
  // and lose their structure, so they are swapped out and restored by callers.
  const parseable = scheme.includes('+')
    ? connectionString.replace(`${scheme}://`, 'placeholder://')
    : connectionString;

  try {
    const url = new URL(parseable);
    return url.host ? { url, scheme } : null;
  } catch {
    return null;
  }
}

/**
 * Replace the database portion of a connection string.
 *
 * Used when switching databases on engines that cannot change it on an open
 * connection, so the adapter can rebuild its pool against the new one. The name
 * is percent-encoded rather than quoted here: it is going into a URL path, where
 * a `/` or `?` in the name would otherwise silently re-parse the string.
 */
export function withDatabase(connectionString: string, database: string): string {
  assertValidDatabaseName(database);

  const parsed = parseConnectionUrl(connectionString);
  if (!parsed) {
    throw new InvalidDatabaseNameError(
      'Cannot change the database on a connection string that is not a scheme://host URL'
    );
  }

  const { url, scheme } = parsed;
  url.pathname = `/${encodeURIComponent(database)}`;

  const rebuilt = url.toString();
  return scheme.includes('+')
    ? rebuilt.replace('placeholder://', `${scheme}://`)
    : rebuilt;
}

/** The database named by a connection string, or null when it names none. */
export function databaseFromConnectionString(
  connectionString: string
): string | null {
  const parsed = parseConnectionUrl(connectionString);
  if (!parsed) return null;

  const path = parsed.url.pathname.replace(/^\//, '');
  if (!path) return null;

  try {
    return decodeURIComponent(path);
  } catch {
    // A stray `%` makes the path undecodable; the raw text is still the name.
    return path;
  }
}
