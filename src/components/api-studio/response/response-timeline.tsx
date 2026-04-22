'use client';

import type { ResponseTimings } from '@/lib/api-studio/types';

function formatMs(n: number | undefined) {
  if (n == null) return '—';
  if (n < 1) return '<1 ms';
  return `${Math.round(n)} ms`;
}

export function ResponseTimeline({ timings }: Readonly<{ timings: ResponseTimings }>) {
  const total = Math.max(timings.total, 1);
  const ttfb = timings.ttfb ?? 0;
  const download = timings.download ?? Math.max(total - ttfb, 0);

  const bars = [
    { label: 'TTFB', value: ttfb, color: 'bg-[var(--color-api-start)]' },
    { label: 'Download', value: download, color: 'bg-[var(--color-api-end)]' },
  ];

  return (
    <div className="p-3 space-y-3">
      <p className="text-xs text-muted-foreground">
        Total time: <span className="font-mono">{formatMs(total)}</span>
      </p>
      <div className="space-y-2">
        {bars.map((b) => (
          <div key={b.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span>{b.label}</span>
              <span className="font-mono text-muted-foreground">{formatMs(b.value)}</span>
            </div>
            <div className="h-2 bg-muted rounded overflow-hidden">
              <div
                className={`h-full ${b.color}`}
                style={{ width: `${(b.value / total) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Browser-side timing is approximate. For per-phase DNS/TCP/TLS splits, a server-side
        tracing hook would be required.
      </p>
    </div>
  );
}
