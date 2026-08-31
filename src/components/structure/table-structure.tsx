'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Columns3,
  Database,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useActiveConnection, useReadOnlyMode } from '@/lib/stores/connection';
import { useSelectedTable, useStudioStore } from '@/lib/stores/studio';
import { apiFetch, errorMessage } from '@/lib/utils/api-client';
import type { ColumnInfo, SchemaChange } from '@/lib/adapters/types';
import { ColumnEditorDialog } from './column-editor-dialog';
import { ApplyChangesDialog, type ChangePlan } from './apply-changes-dialog';

interface SchemaResponse {
  schema: ColumnInfo[];
}

/** One-line summary of a staged change, for the pending list. */
function describe(change: SchemaChange): string {
  switch (change.kind) {
    case 'addColumn':
      return `Add ${change.column.name} ${change.column.type}`;
    case 'dropColumn':
      return `Drop ${change.name}`;
    case 'renameColumn':
      return `Rename ${change.from} to ${change.to}`;
    case 'setType':
      return `Change ${change.name} to ${change.type}`;
    case 'setNullable':
      return `${change.name} ${change.nullable ? 'allows nulls' : 'is NOT NULL'}`;
    case 'setDefault':
      return change.defaultValue === null
        ? `Drop default on ${change.name}`
        : `Default ${change.name} to ${change.defaultValue}`;
  }
}

/**
 * Edit a table's columns.
 *
 * Changes are staged rather than applied as you make them, then rendered as the
 * exact statements that will run. For an operation that discards a column or
 * rewrites a table, confirming SQL you can read is meaningfully different from
 * confirming a sentence describing it.
 */
export function TableStructure() {
  const activeConnection = useActiveConnection();
  const readOnlyMode = useReadOnlyMode();
  const selectedTable = useSelectedTable();
  const setError = useStudioStore((s) => s.setError);

  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);

  const [staged, setStaged] = useState<SchemaChange[]>([]);
  const [editing, setEditing] = useState<ColumnInfo | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [plan, setPlan] = useState<ChangePlan | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  const connectionId = activeConnection?.id;

  const load = useCallback(async () => {
    if (!connectionId || !selectedTable) return;

    setIsLoading(true);
    setLoadError(null);

    try {
      const [schema, settings] = await Promise.all([
        apiFetch<SchemaResponse>(
          `/api/schema?connectionId=${connectionId}&table=${encodeURIComponent(selectedTable)}`
        ),
        apiFetch<{ capabilities?: { supportsSchemaEdit?: boolean } }>(
          `/api/settings?connectionId=${connectionId}`
        ).catch(() => ({ capabilities: undefined })),
      ]);

      setColumns(schema.schema ?? []);
      setCanEdit(settings.capabilities?.supportsSchemaEdit !== false);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, selectedTable]);

  useEffect(() => {
    void load();
  }, [load]);

  // Staged changes describe the table as it was loaded; keeping them across a
  // table switch would apply one table's edit to another.
  useEffect(() => {
    setStaged([]);
  }, [selectedTable]);

  const stage = (changes: SchemaChange[]) => {
    setEditing(null);
    setIsAdding(false);
    if (changes.length > 0) setStaged((previous) => [...previous, ...changes]);
  };

  const review = async () => {
    if (!connectionId || !selectedTable || staged.length === 0) return;

    try {
      setPlan(
        await apiFetch<ChangePlan>('/api/schema/alter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            connectionId,
            table: selectedTable,
            changes: staged,
          }),
        })
      );
    } catch (err) {
      toast.error('Could not prepare the changes', {
        description: errorMessage(err),
      });
    }
  };

  const apply = async () => {
    if (!connectionId || !selectedTable) return;

    setIsApplying(true);
    try {
      await apiFetch('/api/schema/alter', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId,
          table: selectedTable,
          changes: staged,
        }),
      });

      toast.success('Table structure updated');
      setPlan(null);
      setStaged([]);
      setError(null);
      await load();
    } catch (err) {
      // The staged list survives: a failure is usually about one change, and
      // discarding the rest would mean rebuilding the whole edit.
      toast.error('Could not apply the changes', {
        description: errorMessage(err),
      });
      setPlan(null);
    } finally {
      setIsApplying(false);
    }
  };

  if (!activeConnection) return null;

  if (!selectedTable) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center text-sm text-muted-foreground">
          <Database className="mx-auto mb-3 h-8 w-8 opacity-40" />
          Select a table to see its structure.
        </div>
      </div>
    );
  }

  const writable = canEdit && !readOnlyMode;
  const existingNames = columns.map((column) => column.name);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{selectedTable}</span>
          <Badge variant="secondary" className="shrink-0 text-xs">
            {columns.length} {columns.length === 1 ? 'column' : 'columns'}
          </Badge>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => void load()}
            disabled={isLoading}
            aria-label="Refresh structure"
          >
            <RefreshCw className={isLoading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    size="sm"
                    className="h-8 gap-1.5"
                    disabled={!writable}
                    onClick={() => setIsAdding(true)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add column
                  </Button>
                </span>
              </TooltipTrigger>
              {!writable && (
                <TooltipContent>
                  {!canEdit
                    ? 'This database engine does not support editing table structure.'
                    : 'Read-only mode. Enable write access to change structure.'}
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {loadError && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2">
          <span className="text-xs text-destructive">{loadError}</span>
          <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="divide-y">
          {isLoading && columns.length === 0 && (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading structure…
            </div>
          )}

          {!isLoading && columns.length === 0 && (
            <p className="p-8 text-center text-sm text-muted-foreground">
              This table has no columns.
            </p>
          )}

          {columns.map((column) => (
            <div
              key={column.name}
              className="flex items-center justify-between gap-3 px-4 py-2.5"
            >
              <div className="flex min-w-0 items-center gap-2">
                {column.isPrimaryKey && (
                  <KeyRound className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                )}
                <span className="truncate font-mono text-sm">{column.name}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {column.type}
                </span>
                {!column.nullable && (
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    NOT NULL
                  </Badge>
                )}
                {column.defaultValue && (
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    = {column.defaultValue}
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={!writable}
                  aria-label={`Edit ${column.name}`}
                  onClick={() => setEditing(column)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          disabled={!writable || column.isPrimaryKey}
                          aria-label={`Drop ${column.name}`}
                          onClick={() =>
                            stage([{ kind: 'dropColumn', name: column.name }])
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {column.isPrimaryKey && (
                      <TooltipContent>
                        Dropping the primary key column needs the constraint
                        removed first — do it in the query editor.
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      {staged.length > 0 && (
        <div className="shrink-0 border-t bg-muted/40 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <Columns3 className="h-3.5 w-3.5" />
              {staged.length} pending{' '}
              {staged.length === 1 ? 'change' : 'changes'}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={() => setStaged([])}
              >
                <Undo2 className="h-3.5 w-3.5" />
                Discard
              </Button>
              <Button size="sm" className="h-7 px-2 text-xs" onClick={() => void review()}>
                Review SQL
              </Button>
            </div>
          </div>

          <ul className="space-y-1">
            {staged.map((change, index) => (
              <li
                key={`${change.kind}-${index}`}
                className="flex items-center justify-between gap-2 rounded bg-background px-2 py-1 text-xs"
              >
                <span className="truncate font-mono">{describe(change)}</span>
                <button
                  type="button"
                  aria-label="Remove this change"
                  className="shrink-0 px-1 text-muted-foreground hover:text-destructive"
                  onClick={() =>
                    setStaged((previous) =>
                      previous.filter((_, i) => i !== index)
                    )
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>

          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            Nothing runs until you review and apply.
          </p>
        </div>
      )}

      {(isAdding || editing) && (
        <ColumnEditorDialog
          databaseType={activeConnection.type}
          existing={editing ?? undefined}
          existingNames={existingNames}
          onCancel={() => {
            setIsAdding(false);
            setEditing(null);
          }}
          onStage={stage}
        />
      )}

      {plan && (
        <ApplyChangesDialog
          plan={plan}
          table={selectedTable}
          environmentLabel={activeConnection.environment}
          isApplying={isApplying}
          onCancel={() => setPlan(null)}
          onApply={() => void apply()}
        />
      )}
    </div>
  );
}
