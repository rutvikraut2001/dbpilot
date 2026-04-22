import type { HttpMethod } from './types';

export const HTTP_METHODS: HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

// Visual palette — method → Tailwind classes. Kept tiny so a dropdown, a pill,
// and the Flow Graph node all use the same mapping without divergence.
export const METHOD_COLORS: Record<HttpMethod, { text: string; bg: string; border: string }> = {
  GET:     { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  POST:    { text: 'text-amber-600 dark:text-amber-400',     bg: 'bg-amber-500/10',   border: 'border-amber-500/30' },
  PUT:     { text: 'text-blue-600 dark:text-blue-400',       bg: 'bg-blue-500/10',    border: 'border-blue-500/30' },
  PATCH:   { text: 'text-purple-600 dark:text-purple-400',   bg: 'bg-purple-500/10',  border: 'border-purple-500/30' },
  DELETE:  { text: 'text-red-600 dark:text-red-400',         bg: 'bg-red-500/10',     border: 'border-red-500/30' },
  HEAD:    { text: 'text-slate-600 dark:text-slate-400',     bg: 'bg-slate-500/10',   border: 'border-slate-500/30' },
  OPTIONS: { text: 'text-slate-600 dark:text-slate-400',     bg: 'bg-slate-500/10',   border: 'border-slate-500/30' },
};

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_HISTORY_ENTRIES = 200;
