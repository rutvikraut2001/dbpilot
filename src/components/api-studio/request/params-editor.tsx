'use client';

import { KvGrid } from '@/components/api-studio/kv-grid';
import type { KV } from '@/lib/api-studio/types';

export function ParamsEditor({
  params,
  onChange,
}: Readonly<{
  params: KV[];
  onChange: (next: KV[]) => void;
}>) {
  return (
    <div className="p-3">
      <p className="text-xs text-muted-foreground mb-2">
        Query parameters are appended to the URL. Use <code>{'{{var}}'}</code> to reference environment variables.
      </p>
      <KvGrid
        rows={params}
        onChange={onChange}
        keyPlaceholder="parameter"
        valuePlaceholder="value"
        showDescription
      />
    </div>
  );
}
