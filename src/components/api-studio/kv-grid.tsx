'use client';

import { Trash2, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/api-studio/checkbox';
import type { KV } from '@/lib/api-studio/types';
import { newKV } from '@/lib/api-studio/ids';

interface KvGridProps {
  rows: KV[];
  onChange: (rows: KV[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  showDescription?: boolean;
  disabled?: boolean;
  valueInput?: (kv: KV, update: (patch: Partial<KV>) => void) => React.ReactNode;
}

export function KvGrid({
  rows,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  showDescription = false,
  disabled,
  valueInput,
}: KvGridProps) {
  const update = (id: string, patch: Partial<KV>) => {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const remove = (id: string) => {
    onChange(rows.filter((r) => r.id !== id));
  };
  const add = () => {
    onChange([...rows, newKV()]);
  };

  return (
    <div className="border rounded-md overflow-hidden">
      <div
        className={`grid bg-muted/40 text-xs font-medium text-muted-foreground px-2 py-1.5 gap-2 ${
          showDescription ? 'grid-cols-[28px_1fr_1fr_1fr_32px]' : 'grid-cols-[28px_1fr_1fr_32px]'
        }`}
      >
        <span />
        <span>Key</span>
        <span>Value</span>
        {showDescription && <span>Description</span>}
        <span />
      </div>
      {rows.length === 0 && (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">
          No entries. Click &ldquo;Add&rdquo; below.
        </div>
      )}
      {rows.map((kv) => (
        <div
          key={kv.id}
          className={`grid items-center px-2 py-1 gap-2 border-t ${
            showDescription ? 'grid-cols-[28px_1fr_1fr_1fr_32px]' : 'grid-cols-[28px_1fr_1fr_32px]'
          }`}
        >
          <Checkbox
            checked={kv.enabled}
            onChange={(v) => update(kv.id, { enabled: v })}
            disabled={disabled}
          />
          <Input
            value={kv.key}
            onChange={(e) => update(kv.id, { key: e.target.value })}
            placeholder={keyPlaceholder}
            className="h-8 text-sm"
            disabled={disabled}
          />
          {valueInput ? (
            valueInput(kv, (patch) => update(kv.id, patch))
          ) : (
            <Input
              value={kv.value}
              onChange={(e) => update(kv.id, { value: e.target.value })}
              placeholder={valuePlaceholder}
              className="h-8 text-sm font-mono"
              disabled={disabled}
            />
          )}
          {showDescription && (
            <Input
              value={kv.description ?? ''}
              onChange={(e) => update(kv.id, { description: e.target.value })}
              placeholder="Description"
              className="h-8 text-sm"
              disabled={disabled}
            />
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => remove(kv.id)}
            disabled={disabled}
            aria-label="Remove row"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <div className="border-t px-2 py-1">
        <Button variant="ghost" size="sm" onClick={add} disabled={disabled}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </div>
    </div>
  );
}
