/**
 * Parser for the shell-style MongoDB statements the query editor accepts.
 *
 * Split out of the adapter so it can be unit-tested without a server: every bug
 * this module has had was a parsing bug, and reproducing those against a live
 * MongoDB is far more effort than they are worth.
 *
 * The guiding rule is that a rejection must say what is actually wrong. The
 * previous version answered every failure — a trailing newline, a missing quote
 * around a key, two statements at once — with the same "Invalid query format"
 * message, which sent users looking for a syntax error in a statement that was
 * already correct.
 */

export interface ParsedMongoQuery {
  collectionName: string;
  operation: string;
  args: unknown[];
}

/**
 * `db.users.find({...})` — the documented form.
 *
 * The collection name is an identifier here, which is why the accessor form
 * below also exists: it is the only way to name a collection that is not one.
 */
const SHELL_FORM = /^db\.(\w+)\.(\w+)\(([\s\S]*)\)$/;

/**
 * `db.getCollection('users').find({...})` and `db.collection('users').find(...)`.
 *
 * The first is what MongoDB's own documentation uses for names that are not
 * valid identifiers; the second is the Node driver's API, which is what someone
 * copying from application code will paste. Both mean the same thing, and
 * neither is worth an error message.
 */
const ACCESSOR_FORM =
  /^db\.(?:get)?[Cc]ollection\(\s*(?:'([^']*)'|"([^"]*)")\s*\)\.(\w+)\(([\s\S]*)\)$/;

/** A `db.` that begins a statement rather than appearing inside one. */
const STATEMENT_START = /(?:^|[\n;])\s*db\./g;

/**
 * Normalize a statement before matching.
 *
 * The editor sends its buffer verbatim and a buffer ends in a newline, so
 * without trimming, the anchored patterns above reject the exact syntax the
 * error message recommends. A trailing semicolon is stripped for the same
 * reason: it is muscle memory from SQL, mongosh accepts it, and being rejected
 * for one is baffling.
 */
function normalize(query: string): string {
  const trimmed = query.trim();

  // Walked rather than matched with /;+$/, which backtracks quadratically on a
  // string of semicolons.
  let end = trimmed.length;
  while (end > 0 && (trimmed[end - 1] === ';' || /\s/.test(trimmed[end - 1]))) {
    end--;
  }

  return trimmed.slice(0, end);
}

/**
 * Parse a single shell-style statement.
 *
 * Returns null when the input does not look like a MongoDB statement at all —
 * the caller turns that into general usage guidance. Throws with a specific
 * message when the input *is* recognisably a statement but cannot be run, since
 * at that point there is something concrete to say.
 */
export function parseMongoQuery(query: string): ParsedMongoQuery | null {
  const normalized = normalize(query);
  if (!normalized) return null;

  // One statement at a time. The greedy argument capture would otherwise
  // swallow everything between the first `(` and the last `)` across both
  // statements and fail complaining about the arguments, which is a long way
  // from the actual problem.
  const starts = normalized.match(STATEMENT_START);
  if (starts && starts.length > 1) {
    throw new Error(
      'Only one statement can be run at a time. Select the statement you want to run, or remove the others.'
    );
  }

  const accessor = ACCESSOR_FORM.exec(normalized);
  const shell = accessor ? null : SHELL_FORM.exec(normalized);

  // The accessor form captures the name in one of two groups depending on the
  // quote style; only one of them is ever set.
  const collectionName = accessor
    ? (accessor[1] ?? accessor[2])
    : shell?.[1];
  const operation = accessor ? accessor[3] : shell?.[2];
  const argsString = accessor ? accessor[4] : shell?.[3];

  if (!collectionName || !operation || argsString === undefined) {
    return null;
  }

  const trimmedArgs = argsString.trim();
  if (!trimmedArgs) {
    return { collectionName, operation, args: [] };
  }

  try {
    return { collectionName, operation, args: parseArgs(trimmedArgs) };
  } catch {
    // The overwhelmingly common cause: mongosh tolerates unquoted keys and
    // single quotes, JSON.parse does not, so `{age: 30}` fails here while
    // looking perfectly correct to someone who just used it in a shell.
    throw new Error(
      `Could not read the arguments to ${operation}(). They must be valid JSON — keys and strings need double quotes, as in { "age": 30 }.`
    );
  }
}

/** Split an argument list on top-level commas and JSON-parse each part. */
export function parseArgs(argsString: string): unknown[] {
  return splitTopLevelArgs(argsString).map((part) => JSON.parse(part));
}

/**
 * Split an argument list on the commas that separate arguments.
 *
 * Brace depth is tracked outside string literals only. Counting braces inside a
 * string would let a value like `{"pattern": "}"}` close the object early, and
 * the split would then land in the middle of an argument.
 */
function splitTopLevelArgs(argsString: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let inString: '"' | "'" | null = null;
  let escaped = false;

  const push = () => {
    if (current.trim()) parts.push(current.trim());
    current = '';
  };

  for (const char of argsString) {
    if (inString) {
      current += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === inString) inString = null;
      continue;
    }

    if (char === '"' || char === "'") {
      inString = char;
    } else if (char === '{' || char === '[') {
      depth++;
    } else if (char === '}' || char === ']') {
      depth--;
    } else if (char === ',' && depth === 0) {
      push();
      continue;
    }

    current += char;
  }

  push();
  return parts;
}
