/**
 * Derived relationship shape, shared by every adapter.
 *
 * Cardinality itself is read per engine — whether a foreign key's columns are
 * unique is a question only the catalogue can answer. What lives here is the
 * part derived purely from the relationship set, so PostgreSQL and MySQL cannot
 * disagree about it.
 *
 * Kept free of `server-only` so it can be unit-tested directly.
 */

import type { Relationship } from './adapters/types';

/**
 * Tables that could be junction tables on the evidence of relationships alone.
 *
 * Exported so an adapter can fetch column lists for just these few rather than
 * for every table in the database, without having to restate the rule.
 */
export function junctionCandidates(relationships: Relationship[]): string[] {
  const outgoingBySource = new Map<string, Relationship[]>();
  const referencedTables = new Set<string>();

  for (const relationship of relationships) {
    const existing = outgoingBySource.get(relationship.sourceTable);
    if (existing) existing.push(relationship);
    else outgoingBySource.set(relationship.sourceTable, [relationship]);

    referencedTables.add(relationship.targetTable);
  }

  const candidates: string[] = [];

  for (const [table, outgoing] of outgoingBySource) {
    // Nothing may depend on it as an entity in its own right.
    if (referencedTables.has(table)) continue;
    if (new Set(outgoing.map((r) => r.targetTable)).size !== 2) continue;
    candidates.push(table);
  }

  return candidates;
}

/**
 * Mark the relationships that form a many-to-many through a junction table.
 *
 * A junction table exists only to join two others: `post_tags(post_id, tag_id)`
 * is not an entity anyone models, it is the physical form of "posts have many
 * tags". Drawn as two ordinary one-to-many edges it reads as two unrelated
 * associations, which is why ER tools name the pattern rather than showing it
 * literally.
 *
 * The test used here is deliberately narrow, because the cost of a false
 * positive is mislabelling a real entity as plumbing:
 *
 *   - every column of the table participates in a foreign key
 *   - those foreign keys point at exactly two distinct other tables
 *   - the table is not the target of anything else, so nothing refers to it as
 *     an entity in its own right
 *
 * A join table carrying its own columns — `created_at`, a role, a quantity — is
 * therefore left alone. It has grown into an entity, and collapsing it would
 * hide data the user has.
 *
 * The two real foreign keys are still returned; they are only annotated, so the
 * diagram can render them as one many-to-many without the underlying schema
 * being misreported.
 */
export function markJunctionTables(
  relationships: Relationship[],
  /**
   * Column names for the candidate tables. A table missing from the map is left
   * alone rather than guessed at: without its columns there is no way to tell a
   * pure junction table from one that also carries data of its own.
   */
  columnsByTable: Map<string, string[]> = new Map()
): Relationship[] {
  const candidates = new Set(junctionCandidates(relationships));
  if (candidates.size === 0) return relationships;

  const foreignKeyColumnsByTable = new Map<string, Set<string>>();
  for (const relationship of relationships) {
    if (!candidates.has(relationship.sourceTable)) continue;
    const set =
      foreignKeyColumnsByTable.get(relationship.sourceTable) ??
      new Set<string>();
    set.add(relationship.sourceColumn);
    foreignKeyColumnsByTable.set(relationship.sourceTable, set);
  }

  const junctions = new Set<string>();

  for (const table of candidates) {
    const columns = columnsByTable.get(table);
    if (!columns || columns.length === 0) continue;

    // Every column must take part in one of the foreign keys. A join table that
    // has grown its own columns — a role, a quantity, a created_at — has become
    // an entity, and collapsing it would hide data the user has.
    const foreignKeyColumns = foreignKeyColumnsByTable.get(table);
    if (!foreignKeyColumns) continue;
    if (!columns.every((column) => foreignKeyColumns.has(column))) continue;

    junctions.add(table);
  }

  if (junctions.size === 0) return relationships;

  return relationships.map((relationship) =>
    junctions.has(relationship.sourceTable)
      ? {
          ...relationship,
          type: 'many-to-many' as const,
          viaJunctionTable: relationship.sourceTable,
        }
      : relationship
  );
}
