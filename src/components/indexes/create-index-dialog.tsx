'use client';

import { useMemo, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { ColumnInfo, DatabaseType } from '@/lib/adapters/types';

export interface CreateIndexRequest {
  name: string;
  columns: string[];
  unique: boolean;
  method: string;
  where?: string;
  concurrent: boolean;
}

/**
 * Index methods offered per engine, with the label a user of that engine would
 * recognise.
 *
 * Kept in step with each adapter's own allowlist — the adapter is what rejects
 * an unsupported method, and offering one it would refuse turns a clear form
 * error into a failed round trip.
 */
const METHODS: Record<string, { value: string; label: string }[]> = {
  postgresql: [
    { value: 'btree', label: 'B-tree (default)' },
    { value: 'hash', label: 'Hash — equality only' },
    { value: 'gin', label: 'GIN — arrays, JSONB, full text' },
    { value: 'gist', label: 'GiST — geometric, ranges' },
    { value: 'brin', label: 'BRIN — large, naturally ordered' },
    { value: 'spgist', label: 'SP-GiST — partitioned' },
  ],
  mysql: [
    { value: 'btree', label: 'B-tree (default)' },
    { value: 'hash', label: 'Hash — MEMORY tables' },
    { value: 'fulltext', label: 'Full text' },
    { value: 'spatial', label: 'Spatial' },
  ],
  mongodb: [
    { value: '1', label: 'Ascending (default)' },
    { value: '-1', label: 'Descending' },
    { value: 'text', label: 'Text' },
    { value: 'hashed', label: 'Hashed' },
    { value: '2dsphere', label: '2dsphere — geospatial' },
  ],
};

/** Engines whose index method cannot be UNIQUE. */
const NON_UNIQUE_METHODS = new Set(['fulltext', 'spatial', 'text', '2dsphere']);

/** Engines that support a predicate limiting which rows are indexed. */
const SUPPORTS_PARTIAL = new Set<DatabaseType>(['postgresql', 'mongodb']);

/** Engines that can build without blocking writes. */
const SUPPORTS_CONCURRENT = new Set<DatabaseType>(['postgresql', 'mysql']);

interface CreateIndexDialogProps {
  table: string;
  databaseType: DatabaseType;
  columns: ColumnInfo[];
  existingNames: string[];
  isSubmitting: boolean;
  onCancel: () => void;
  onCreate: (request: CreateIndexRequest) => void;
}

/**
 * Build an index.
 *
 * The column list is ordered, and the order is the point: a B-tree on
 * (a, b) serves lookups on `a` and on `a, b`, but not on `b` alone. Columns are
 * therefore added in click order and shown as a numbered sequence that can be
 * reordered, rather than as a set of checkboxes that would silently pick an
 * order for the user.
 */
export function CreateIndexDialog({
  table,
  databaseType,
  columns,
  existingNames,
  isSubmitting,
  onCancel,
  onCreate,
}: Readonly<CreateIndexDialogProps>) {
  const methods = METHODS[databaseType] ?? METHODS.postgresql;

  const [selected, setSelected] = useState<string[]>([]);
  const [method, setMethod] = useState(methods[0].value);
  const [unique, setUnique] = useState(false);
  const [where, setWhere] = useState('');
  const [concurrent, setConcurrent] = useState(false);
  // Empty means "derive from the columns"; typing takes over.
  const [name, setName] = useState('');

  const suggestedName = useMemo(() => {
    if (selected.length === 0) return '';
    // The convention most engines' own tooling uses, and short enough to stay
    // under the 64-character identifier limit on MySQL for typical column names.
    return `idx_${table.split('.').pop()}_${selected.join('_')}`.slice(0, 63);
  }, [table, selected]);

  const effectiveName = (name.trim() || suggestedName).trim();

  const uniqueAllowed = !NON_UNIQUE_METHODS.has(method);
  const partialAllowed = SUPPORTS_PARTIAL.has(databaseType);
  const concurrentAllowed = SUPPORTS_CONCURRENT.has(databaseType);

  const nameTaken = existingNames.includes(effectiveName);
  const canSubmit =
    selected.length > 0 && effectiveName.length > 0 && !nameTaken && !isSubmitting;

  const toggleColumn = (column: string) => {
    setSelected((prev) =>
      prev.includes(column)
        ? prev.filter((c) => c !== column)
        : [...prev, column]
    );
  };

  const moveColumn = (index: number, direction: -1 | 1) => {
    setSelected((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const submit = () => {
    if (!canSubmit) return;
    onCreate({
      name: effectiveName,
      columns: selected,
      unique: uniqueAllowed && unique,
      method,
      where: partialAllowed && where.trim() ? where.trim() : undefined,
      concurrent: concurrentAllowed && concurrent,
    });
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !isSubmitting) onCancel(); }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 shrink-0" />
            Create index
          </DialogTitle>
          <DialogDescription>
            On <code className="font-mono">{table}</code>. Building an index takes
            a lock and rewrites storage, so it is a write operation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Columns, in index order */}
          <div className="space-y-1.5">
            <Label>Columns</Label>
            <p className="text-xs text-muted-foreground">
              Order matters. An index on (a, b) serves lookups on <code>a</code>{' '}
              and on <code>a, b</code> — but not on <code>b</code> alone.
            </p>

            {selected.length > 0 && (
              <div className="flex flex-wrap gap-1.5 rounded-md border bg-muted/40 p-2">
                {selected.map((column, i) => (
                  <span
                    key={column}
                    className="inline-flex items-center gap-1 rounded bg-background border px-1.5 py-0.5 text-xs font-mono"
                  >
                    <span className="text-muted-foreground">{i + 1}.</span>
                    {column}
                    <button
                      type="button"
                      aria-label={`Move ${column} earlier`}
                      disabled={i === 0}
                      className="px-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                      onClick={() => moveColumn(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${column} later`}
                      disabled={i === selected.length - 1}
                      className="px-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                      onClick={() => moveColumn(i, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${column}`}
                      className="px-0.5 text-muted-foreground hover:text-destructive"
                      onClick={() => toggleColumn(column)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="max-h-40 overflow-y-auto rounded-md border divide-y">
              {columns.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  No columns found for this table.
                </p>
              )}
              {columns.map((column) => (
                <button
                  key={column.name}
                  type="button"
                  onClick={() => toggleColumn(column.name)}
                  className={cn(
                    'flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-muted',
                    selected.includes(column.name) && 'bg-muted'
                  )}
                >
                  <span className="font-mono">{column.name}</span>
                  <span className="text-muted-foreground">{column.type}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="index-name">Name</Label>
            <Input
              id="index-name"
              value={name}
              placeholder={suggestedName || 'Select columns first'}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
            />
            {nameTaken && (
              <p className="text-xs text-destructive">
                An index named {effectiveName} already exists on this table.
              </p>
            )}
          </div>

          {/* Method */}
          <div className="space-y-1.5">
            <Label htmlFor="index-method">
              {databaseType === 'mongodb' ? 'Type' : 'Method'}
            </Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="index-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {methods.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Unique */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="index-unique">Unique</Label>
              <p className="text-xs text-muted-foreground">
                {uniqueAllowed
                  ? 'Rejects duplicate values. Fails if the table already holds any.'
                  : `A ${method} index cannot be unique.`}
              </p>
            </div>
            <Switch
              id="index-unique"
              checked={uniqueAllowed && unique}
              disabled={!uniqueAllowed}
              onCheckedChange={setUnique}
            />
          </div>

          {/* Partial predicate */}
          {partialAllowed && (
            <div className="space-y-1.5">
              <Label htmlFor="index-where">
                {databaseType === 'mongodb'
                  ? 'Partial filter (JSON)'
                  : 'Partial index predicate'}{' '}
                <span className="text-muted-foreground font-normal">
                  — optional
                </span>
              </Label>
              <Input
                id="index-where"
                value={where}
                placeholder={
                  databaseType === 'mongodb'
                    ? '{"status":"active"}'
                    : 'deleted_at IS NULL'
                }
                onChange={(e) => setWhere(e.target.value)}
                autoComplete="off"
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Indexes only the matching rows, which keeps the index smaller.
              </p>
            </div>
          )}

          {/* Concurrent build */}
          {concurrentAllowed && (
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="index-concurrent">Build without locking</Label>
                <p className="text-xs text-muted-foreground">
                  {databaseType === 'postgresql'
                    ? 'CONCURRENTLY — slower, but does not block writes. A failed build leaves an invalid index to drop by hand.'
                    : 'Fails rather than silently copying the table if it cannot be done online.'}
                </p>
              </div>
              <Switch
                id="index-concurrent"
                checked={concurrent}
                onCheckedChange={setConcurrent}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create index
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
