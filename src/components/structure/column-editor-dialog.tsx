'use client';

import { useState } from 'react';
import { Columns3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { ColumnInfo, DatabaseType, SchemaChange } from '@/lib/adapters/types';

/**
 * Types offered per engine.
 *
 * Kept in step with each adapter's own allowlist — offering a type the adapter
 * would reject turns a clear form error into a failed round trip. Anything more
 * exotic belongs in the query editor, where the whole statement is visible.
 */
const TYPES: Record<string, string[]> = {
  postgresql: [
    'text', 'varchar(255)', 'char(1)', 'integer', 'bigint', 'smallint',
    'numeric(10, 2)', 'real', 'double precision', 'boolean',
    'date', 'timestamptz', 'timestamp', 'time', 'interval',
    'uuid', 'jsonb', 'json', 'bytea', 'inet',
  ],
  mysql: [
    'varchar(255)', 'text', 'longtext', 'char(1)', 'int', 'bigint', 'smallint',
    'tinyint(1)', 'decimal(10, 2)', 'float', 'double',
    'date', 'datetime', 'timestamp', 'time', 'year',
    'json', 'blob', 'binary(16)',
  ],
};

interface ColumnEditorDialogProps {
  databaseType: DatabaseType;
  /** Present when editing; absent when adding. */
  existing?: ColumnInfo;
  existingNames: string[];
  onCancel: () => void;
  onStage: (changes: SchemaChange[]) => void;
}

/**
 * Describe one column, as an addition or an edit.
 *
 * Produces staged `SchemaChange`s rather than applying anything: an edit is
 * reviewed as SQL before it runs.
 */
export function ColumnEditorDialog({
  databaseType,
  existing,
  existingNames,
  onCancel,
  onStage,
}: Readonly<ColumnEditorDialogProps>) {
  const types = TYPES[databaseType] ?? TYPES.postgresql;
  const isEdit = Boolean(existing);

  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState(existing?.type ?? types[0]);
  const [nullable, setNullable] = useState(existing?.nullable ?? true);
  const [defaultValue, setDefaultValue] = useState(existing?.defaultValue ?? '');

  const trimmedName = name.trim();
  const trimmedType = type.trim();
  const trimmedDefault = defaultValue.trim();

  const nameChanged = isEdit && trimmedName !== existing!.name;
  const nameTaken =
    trimmedName !== existing?.name && existingNames.includes(trimmedName);

  const validName = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmedName);
  const canSubmit =
    trimmedName.length > 0 && validName && !nameTaken && trimmedType.length > 0;

  const submit = () => {
    if (!canSubmit) return;

    if (!isEdit) {
      onStage([
        {
          kind: 'addColumn',
          column: {
            name: trimmedName,
            type: trimmedType,
            nullable,
            defaultValue: trimmedDefault || null,
          },
        },
      ]);
      return;
    }

    // Only what actually differs is staged, so the review shows the real edit
    // rather than a rewrite of every property.
    const changes: SchemaChange[] = [];
    const from = existing!;

    if (nameChanged) {
      changes.push({ kind: 'renameColumn', from: from.name, to: trimmedName });
    }
    if (trimmedType !== from.type) {
      changes.push({ kind: 'setType', name: trimmedName, type: trimmedType });
    }
    if (nullable !== from.nullable) {
      changes.push({ kind: 'setNullable', name: trimmedName, nullable });
    }
    if (trimmedDefault !== (from.defaultValue ?? '')) {
      changes.push({
        kind: 'setDefault',
        name: trimmedName,
        defaultValue: trimmedDefault || null,
      });
    }

    onStage(changes);
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Columns3 className="h-5 w-5 shrink-0" />
            {isEdit ? `Edit ${existing!.name}` : 'Add column'}
          </DialogTitle>
          <DialogDescription>
            Changes are staged for review — nothing runs until you apply them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="column-name">Name</Label>
            <Input
              id="column-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              autoFocus
              className="font-mono text-sm"
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            />
            {trimmedName && !validName && (
              <p className="text-xs text-destructive">
                A column name must start with a letter or underscore and contain
                only letters, digits and underscores.
              </p>
            )}
            {nameTaken && (
              <p className="text-xs text-destructive">
                This table already has a column called {trimmedName}.
              </p>
            )}
            {nameChanged && validName && !nameTaken && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Renaming breaks any query or code still using {existing!.name}.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="column-type">Type</Label>
            <Input
              id="column-type"
              list="column-type-options"
              value={type}
              onChange={(e) => setType(e.target.value)}
              autoComplete="off"
              className="font-mono text-sm"
            />
            <datalist id="column-type-options">
              {types.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
            {isEdit && trimmedType !== existing!.type && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Changing the type rewrites the table.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="column-nullable">Allow nulls</Label>
              <p className="text-xs text-muted-foreground">
                {nullable
                  ? 'The column may be left empty.'
                  : 'Every row must have a value.'}
              </p>
            </div>
            <Switch
              id="column-nullable"
              checked={nullable}
              onCheckedChange={setNullable}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="column-default">
              Default{' '}
              <span className="font-normal text-muted-foreground">
                — optional, written as SQL
              </span>
            </Label>
            <Input
              id="column-default"
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
              placeholder="'none' or 0 or now()"
              autoComplete="off"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Quote text values, as you would in a query.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {isEdit ? 'Stage changes' : 'Stage column'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
