/**
 * Index health analysis.
 *
 * Reads a table's index list and reports indexes that are probably not earning
 * their keep. Every index costs write throughput and disk, so a table that has
 * accumulated overlapping indexes over time is paying for all of them on every
 * INSERT.
 *
 * Everything here is a *finding*, never an action: the analysis suggests what to
 * look at, and dropping an index remains an explicit, confirmed decision. That
 * matters because each rule below has a legitimate exception the analyzer cannot
 * see — an index may exist for a nightly report that has not run since the
 * statistics were reset, or to support a query in a service that is currently
 * scaled to zero.
 *
 * Kept free of `server-only` so it can be unit-tested directly.
 */

import type { IndexInfo } from './adapters/types';

export type IndexIssueKind = 'duplicate' | 'redundant' | 'unused' | 'large';

export interface IndexIssue {
  kind: IndexIssueKind;
  /** The index the finding is about — the one a user would consider dropping. */
  indexName: string;
  /** The index that makes this one redundant, for `duplicate`/`redundant`. */
  relatedIndex?: string;
  /** Why it was flagged, phrased for someone deciding whether to act. */
  message: string;
  severity: 'info' | 'warn';
}

/**
 * An index at least this much larger than its table is worth a look.
 *
 * Indexes legitimately exceed their table's heap size — a multi-column index on
 * a narrow table easily does — so this is deliberately not a 1:1 ratio. It is
 * set where the size is more likely to be a surprise than a design choice.
 */
const LARGE_INDEX_TABLE_RATIO = 1.5;

/** Absolute floor, so a 200 KB index on a 100 KB table is not "large". */
const LARGE_INDEX_MIN_BYTES = 10 * 1024 * 1024;

/** True when `shorter` is a leading subsequence of `longer`. */
function isColumnPrefix(shorter: string[], longer: string[]): boolean {
  if (shorter.length >= longer.length) return false;
  return shorter.every((column, i) => column === longer[i]);
}

function sameColumns(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((column, i) => column === b[i]);
}

/**
 * Whether an index may be reported as droppable.
 *
 * The primary key is never a candidate: on most engines it is not an index you
 * can lose independently of the constraint it implements. Unique indexes are
 * excluded from the *coverage* rules for the same reason — a longer index does
 * not enforce the shorter one's uniqueness, so "redundant" would be wrong — but
 * they can still be flagged as large.
 */
function isConstraintIndex(index: IndexInfo): boolean {
  return index.isPrimary || index.isUnique;
}

/**
 * Whether an index may take part in the coverage rules at all.
 *
 * Partial indexes are excluded in *both* directions, and the second direction is
 * the important one. A partial index covers only the rows matching its
 * predicate, so telling a user to drop a full index on (a) because a partial
 * index on (a) WHERE deleted_at IS NULL exists would silently remove the only
 * index serving every other row. The reverse is merely unhelpful: a partial
 * index is deliberately narrower than the full index it resembles, so calling it
 * a duplicate misreads a considered choice as an accident.
 *
 * Comparing predicates for real containment is a job for the planner, not string
 * equality, so neither participates.
 */
function canCompareCoverage(index: IndexInfo): boolean {
  return !index.isPartial;
}

/**
 * Findings for one table's indexes.
 *
 * `tableSizeBytes` is optional and only enables the size rule; the coverage and
 * usage rules need nothing but the index list. Output is ordered by index name
 * then kind, so a caller rendering it gets a stable list.
 */
export function analyzeIndexHealth(
  indexes: IndexInfo[],
  options: { tableSizeBytes?: number } = {}
): IndexIssue[] {
  const issues: IndexIssue[] = [];

  // An index reported as a duplicate is not also reported as redundant or
  // unused — the duplicate finding already tells the user to drop it, and three
  // findings for one index reads as three problems.
  const covered = new Set<string>();

  const candidates = indexes.filter((index) => !index.isPrimary);
  const comparable = candidates.filter(canCompareCoverage);

  // ── Duplicates: identical column lists ────────────────────────────────────
  //
  // Pairwise over the candidates, keeping the first of each set and reporting
  // the rest. Which one is "the duplicate" is arbitrary to the engine but not to
  // the user, so a plain index is always reported in preference to a unique one:
  // dropping the unique index would drop a constraint too.
  for (let i = 0; i < comparable.length; i++) {
    for (let j = i + 1; j < comparable.length; j++) {
      const a = comparable[i];
      const b = comparable[j];
      if (!sameColumns(a.columns, b.columns)) continue;

      const droppable = a.isUnique && !b.isUnique ? b : a;
      const keep = droppable === a ? b : a;
      if (covered.has(droppable.name)) continue;

      covered.add(droppable.name);
      issues.push({
        kind: 'duplicate',
        indexName: droppable.name,
        relatedIndex: keep.name,
        message: `Indexes the same columns as ${keep.name} (${droppable.columns.join(', ')}). One of the two is paying for itself on every write for nothing.`,
        severity: 'warn',
      });
    }
  }

  // ── Redundant: columns are a leading prefix of a wider index ──────────────
  //
  // A B-tree on (a, b, c) already serves lookups on (a) and (a, b), so a
  // separate index on (a) adds write cost and no read capability. Only the
  // leading prefix counts: an index on (b) is NOT served by (a, b, c).
  for (const index of comparable) {
    if (covered.has(index.name) || isConstraintIndex(index)) continue;

    const wider = comparable.find(
      (other) =>
        other.name !== index.name &&
        !covered.has(other.name) &&
        isColumnPrefix(index.columns, other.columns)
    );
    if (!wider) continue;

    covered.add(index.name);
    issues.push({
      kind: 'redundant',
      indexName: index.name,
      relatedIndex: wider.name,
      message: `Its columns (${index.columns.join(', ')}) are a leading prefix of ${wider.name} (${wider.columns.join(', ')}), which can already serve the same lookups.`,
      severity: 'warn',
    });
  }

  // ── Unused: the planner has never chosen it ───────────────────────────────
  //
  // Requires real statistics. `scans` is undefined when the engine cannot tell
  // us, and treating that as zero would accuse every index on MySQL of being
  // unused — so absence is skipped, not defaulted.
  //
  // Unique indexes are exempt: they enforce a constraint whether or not a query
  // ever reads them.
  for (const index of candidates) {
    if (covered.has(index.name) || isConstraintIndex(index)) continue;
    if (index.scans === undefined || index.scans > 0) continue;

    issues.push({
      kind: 'unused',
      indexName: index.name,
      message:
        'The planner has not used this index since statistics were last reset. Confirm no periodic job needs it before dropping.',
      severity: 'warn',
    });
  }

  // ── Large: disproportionate to the table it indexes ───────────────────────
  //
  // Informational only. A large index is not a problem in itself — it is a
  // prompt to check that its size is intended.
  const tableSizeBytes = options.tableSizeBytes;
  if (tableSizeBytes && tableSizeBytes > 0) {
    for (const index of indexes) {
      const size = index.sizeBytes;
      if (size === undefined) continue;
      if (size < LARGE_INDEX_MIN_BYTES) continue;
      if (size < tableSizeBytes * LARGE_INDEX_TABLE_RATIO) continue;

      issues.push({
        kind: 'large',
        indexName: index.name,
        message: `Occupies ${formatBytes(size)}, more than ${LARGE_INDEX_TABLE_RATIO}× the table's own ${formatBytes(tableSizeBytes)}.`,
        severity: 'info',
      });
    }
  }

  return issues.sort(
    (a, b) => a.indexName.localeCompare(b.indexName) || a.kind.localeCompare(b.kind)
  );
}

/** Byte count as a short human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
