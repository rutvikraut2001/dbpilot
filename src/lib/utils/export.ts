// Shared row serialization helpers for exporting table/query data.
// Usable on both client (current-page export) and server (full-table export).

type Row = Record<string, unknown>;

function toCsvString(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  if (
    typeof val === 'string' ||
    typeof val === 'number' ||
    typeof val === 'boolean' ||
    typeof val === 'bigint'
  ) {
    return String(val);
  }
  return '';
}

/** Escape a single value for CSV, quoting when it contains a comma, quote, or newline. */
export function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = toCsvString(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

/** Serialize rows to a CSV string. Columns default to the union of keys in the first row. */
export function rowsToCsv(rows: Row[], columns?: string[]): string {
  if (rows.length === 0) return '';
  const headers = columns ?? Object.keys(rows[0]);
  return [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(',')),
  ].join('\n');
}

/** Serialize rows to a pretty-printed JSON string. */
export function rowsToJson(rows: Row[]): string {
  return JSON.stringify(rows, jsonReplacer, 2);
}

// BigInt is not serializable by JSON.stringify — coerce to string.
function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/** Build a `<table>_<date>.<ext>` filename for a download. */
export function exportFilename(tableName: string, ext: 'csv' | 'json'): string {
  const date = new Date().toISOString().split('T')[0];
  return `${tableName}_${date}.${ext}`;
}
