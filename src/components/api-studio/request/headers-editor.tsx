'use client';

import { KvGrid } from '@/components/api-studio/kv-grid';
import type { KV } from '@/lib/api-studio/types';

const COMMON_HEADERS = [
  'Accept',
  'Accept-Encoding',
  'Accept-Language',
  'Authorization',
  'Cache-Control',
  'Content-Type',
  'Cookie',
  'Origin',
  'User-Agent',
  'X-Api-Key',
  'X-Requested-With',
];

export function HeadersEditor({
  headers,
  onChange,
}: Readonly<{
  headers: KV[];
  onChange: (next: KV[]) => void;
}>) {
  return (
    <div className="p-3 space-y-2">
      <p className="text-xs text-muted-foreground">
        HTTP headers sent with the request. Disabled rows are skipped.
      </p>
      <KvGrid
        rows={headers}
        onChange={onChange}
        keyPlaceholder="Header"
        valuePlaceholder="Value"
        valueInput={(kv, update) => (
          <input
            value={kv.value}
            onChange={(e) => update({ value: e.target.value })}
            placeholder="Value"
            className="h-8 text-sm font-mono rounded-md border border-input bg-transparent px-3 outline-none focus:border-ring"
            list={`common-headers-${kv.id}`}
          />
        )}
      />
      <datalist id="common-headers">
        {COMMON_HEADERS.map((h) => (
          <option key={h} value={h} />
        ))}
      </datalist>
    </div>
  );
}
