'use client';

import type { HttpResponse } from '@/lib/api-studio/types';

export function ResponseHeaders({ response }: Readonly<{ response: HttpResponse }>) {
  const entries = Object.entries(response.headers);
  if (entries.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        No response headers.
      </div>
    );
  }
  return (
    <div className="p-3">
      <div className="border rounded-md overflow-hidden">
        <div className="grid grid-cols-[1fr_2fr] bg-muted/40 text-xs font-medium text-muted-foreground px-3 py-1.5">
          <span>Header</span>
          <span>Value</span>
        </div>
        {entries.map(([key, value]) => (
          <div
            key={key}
            className="grid grid-cols-[1fr_2fr] px-3 py-1.5 text-sm border-t gap-3"
          >
            <span className="font-mono text-xs break-all">{key}</span>
            <span className="font-mono text-xs break-all text-muted-foreground">
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
