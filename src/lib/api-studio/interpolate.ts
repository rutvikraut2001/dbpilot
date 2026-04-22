import type { KV } from './types';

const TOKEN_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

function buildLookup(layers: KV[][]): Map<string, string> {
  // Later layers override earlier ones.
  const map = new Map<string, string>();
  for (const layer of layers) {
    for (const kv of layer) {
      if (!kv.enabled || !kv.key) continue;
      map.set(kv.key, kv.value ?? '');
    }
  }
  return map;
}

export interface InterpolationResult {
  value: string;
  unresolved: string[];          // list of variable names that were not found
}

/**
 * Resolve {{var}} tokens against a stack of KV layers.
 * Precedence: later layers in the array win (so pass as [global, collection, env, request]).
 * Unresolved tokens are left as literal `{{name}}` and collected into `unresolved`.
 */
export function resolve(input: string, layers: KV[][]): InterpolationResult {
  if (!input) return { value: input, unresolved: [] };
  const lookup = buildLookup(layers);
  const unresolved: string[] = [];
  const value = input.replaceAll(TOKEN_RE, (_match, raw: string) => {
    const name = raw.trim();
    const hit = lookup.get(name);
    if (hit !== undefined) return hit;
    if (!unresolved.includes(name)) unresolved.push(name);
    return `{{${name}}}`;
  });
  return { value, unresolved };
}

/**
 * Convenience: resolve but discard the unresolved list.
 */
export function resolveString(input: string, layers: KV[][]): string {
  return resolve(input, layers).value;
}

/**
 * Resolve every enabled KV in `pairs`.
 * Disabled entries are dropped entirely (no key / value emitted).
 */
export function resolveKVs(pairs: KV[], layers: KV[][]): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const p of pairs) {
    if (!p.enabled) continue;
    const key = resolveString(p.key, layers);
    if (!key) continue;
    out.push({ key, value: resolveString(p.value ?? '', layers) });
  }
  return out;
}

/**
 * Collect *all* unresolved variable names across a full request (url, headers, body).
 * Used by the UI to show a "⚠ unresolved: foo, bar" chip.
 */
export function collectUnresolved(inputs: string[], layers: KV[][]): string[] {
  const seen = new Set<string>();
  for (const s of inputs) {
    if (!s) continue;
    for (const u of resolve(s, layers).unresolved) seen.add(u);
  }
  return Array.from(seen);
}

/**
 * Dotted-path JSON lookup — v1 subset, enough for response-capture use.
 * Supports: "$.data.token", "data.items[0].id", "items.0.id".
 */
export function jsonPathGet(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const normalized = path
    .replace(/^\$\.?/, '')
    .replaceAll(/\[(\d+)\]/g, '.$1');
  const parts = normalized.split('.').filter(Boolean);
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(part);
      if (!Number.isFinite(idx)) return undefined;
      cur = cur[idx];
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}
