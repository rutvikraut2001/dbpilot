'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Copy,
  Database,
  Info,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
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
import { useSelectedTable } from '@/lib/stores/studio';
import { apiFetch, errorMessage } from '@/lib/utils/api-client';
import { formatBytes, type IndexIssue } from '@/lib/index-health';
import type { ColumnInfo, IndexInfo } from '@/lib/adapters/types';
import { CreateIndexDialog, type CreateIndexRequest } from './create-index-dialog';
import { DangerousQueryDialog } from '@/components/query-editor/dangerous-query-dialog';

interface IndexesResponse {
  indexes: IndexInfo[];
  issues: IndexIssue[];
  canManage: boolean;
}

const ISSUE_LABEL: Record<IndexIssue['kind'], string> = {
  duplicate: 'Duplicate',
  redundant: 'Redundant',
  unused: 'Unused',
  large: 'Large',
};

/**
 * Index management for the selected table.
 *
 * Listing, health findings, creation and dropping. Read-only mode disables both
 * write actions here, but that is presentation only — the server refuses them
 * regardless, which is what actually makes read-only a guarantee.
 */
export function IndexManager() {
  const activeConnection = useActiveConnection();
  const readOnlyMode = useReadOnlyMode();
  const selectedTable = useSelectedTable();

  const [data, setData] = useState<IndexesResponse | null>(null);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<IndexInfo | null>(null);
  const [isDropping, setIsDropping] = useState(false);

  const connectionId = activeConnection?.id;

  const load = useCallback(async () => {
    if (!connectionId || !selectedTable) return;

    setIsLoading(true);
    setError(null);

    try {
      // The column list feeds the create dialog. Fetched alongside rather than
      // when the dialog opens, so the form is populated the moment it appears.
      const [indexes, schema] = await Promise.all([
        apiFetch<IndexesResponse>(
          `/api/indexes?connectionId=${connectionId}&table=${encodeURIComponent(selectedTable)}`
        ),
        apiFetch<{ schema: ColumnInfo[] }>(
          `/api/schema?connectionId=${connectionId}&table=${encodeURIComponent(selectedTable)}`
        ).catch(() => ({ schema: [] as ColumnInfo[] })),
      ]);

      setData(indexes);
      setColumns(schema.schema ?? []);
    } catch (err) {
      setError(errorMessage(err));
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, selectedTable]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (request: CreateIndexRequest) => {
    if (!connectionId || !selectedTable) return;

    setIsCreating(true);
    try {
      await apiFetch('/api/indexes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId,
          table: selectedTable,
          ...request,
        }),
      });

      toast.success(`Created index ${request.name}`);
      setShowCreate(false);
      await load();
    } catch (err) {
      // Kept open with the message in a toast: the engine's complaint is
      // usually about the form's own contents (a duplicate name, a unique index
      // on non-unique data), so discarding the input would make the user retype
      // everything to change one field.
      toast.error('Could not create index', { description: errorMessage(err) });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDrop = async () => {
    if (!connectionId || !selectedTable || !pendingDrop) return;

    setIsDropping(true);
    try {
      await apiFetch(
        `/api/indexes?connectionId=${connectionId}&table=${encodeURIComponent(selectedTable)}&name=${encodeURIComponent(pendingDrop.name)}`,
        { method: 'DELETE' }
      );

      toast.success(`Dropped index ${pendingDrop.name}`);
      setPendingDrop(null);
      await load();
    } catch (err) {
      toast.error('Could not drop index', { description: errorMessage(err) });
    } finally {
      setIsDropping(false);
    }
  };

  if (!activeConnection) return null;

  if (!selectedTable) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center text-sm text-muted-foreground">
          <Database className="mx-auto mb-3 h-8 w-8 opacity-40" />
          Select a table to see its indexes.
        </div>
      </div>
    );
  }

  const issuesFor = (name: string) =>
    data?.issues.filter((issue) => issue.indexName === name) ?? [];

  const canWrite = Boolean(data?.canManage) && !readOnlyMode;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate text-sm font-medium">{selectedTable}</span>
          {data && (
            <Badge variant="secondary" className="shrink-0 text-xs">
              {data.indexes.length}{' '}
              {data.indexes.length === 1 ? 'index' : 'indexes'}
            </Badge>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => void load()}
            disabled={isLoading}
            aria-label="Refresh indexes"
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
                    disabled={!canWrite}
                    onClick={() => setShowCreate(true)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Create index
                  </Button>
                </span>
              </TooltipTrigger>
              {!canWrite && (
                <TooltipContent>
                  {data && !data.canManage
                    ? 'This database does not support adding indexes after the table is created.'
                    : 'Read-only mode. Enable write access to create an index.'}
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {error && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2">
          <span className="text-xs text-destructive">{error}</span>
          <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="divide-y">
          {isLoading && !data && (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading indexes…
            </div>
          )}

          {data && data.indexes.length === 0 && !isLoading && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              This table has no indexes.
            </div>
          )}

          {data?.indexes.map((index) => {
            const issues = issuesFor(index.name);

            return (
              <div key={index.name} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {index.isPrimary && (
                        <KeyRound className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                      )}
                      <span className="font-mono text-sm">{index.name}</span>

                      {index.isPrimary && (
                        <Badge variant="secondary" className="text-[10px]">
                          PRIMARY
                        </Badge>
                      )}
                      {index.isUnique && !index.isPrimary && (
                        <Badge variant="secondary" className="text-[10px]">
                          UNIQUE
                        </Badge>
                      )}
                      {index.isPartial && (
                        <Badge variant="secondary" className="text-[10px]">
                          PARTIAL
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px]">
                        {index.type}
                      </Badge>
                    </div>

                    <p className="truncate font-mono text-xs text-muted-foreground">
                      ({index.columns.join(', ')})
                    </p>

                    <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                      {index.sizeBytes !== undefined && (
                        <span>{formatBytes(index.sizeBytes)}</span>
                      )}
                      {/* Zero scans is a finding, so it must read differently
                          from an engine that cannot report scans at all. */}
                      {index.scans !== undefined && (
                        <span>
                          {index.scans.toLocaleString()}{' '}
                          {index.scans === 1 ? 'scan' : 'scans'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {index.definition && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label={`Copy definition of ${index.name}`}
                        onClick={() => {
                          void navigator.clipboard.writeText(index.definition!);
                          toast.success('Definition copied');
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    )}

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              aria-label={`Drop index ${index.name}`}
                              disabled={!canWrite || index.isPrimary}
                              onClick={() => setPendingDrop(index)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </span>
                        </TooltipTrigger>
                        {index.isPrimary && (
                          <TooltipContent>
                            The primary key cannot be dropped on its own.
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>

                {issues.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {issues.map((issue) => (
                      <div
                        key={`${issue.kind}-${issue.indexName}`}
                        className={
                          issue.severity === 'warn'
                            ? 'flex items-start gap-1.5 rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-400'
                            : 'flex items-start gap-1.5 rounded border bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground'
                        }
                      >
                        {issue.severity === 'warn' ? (
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        ) : (
                          <Info className="mt-0.5 h-3 w-3 shrink-0" />
                        )}
                        <span>
                          <span className="font-medium">
                            {ISSUE_LABEL[issue.kind]}:
                          </span>{' '}
                          {issue.message}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {showCreate && (
        <CreateIndexDialog
          table={selectedTable}
          databaseType={activeConnection.type}
          columns={columns}
          existingNames={data?.indexes.map((index) => index.name) ?? []}
          isSubmitting={isCreating}
          onCancel={() => setShowCreate(false)}
          onCreate={(request) => void handleCreate(request)}
        />
      )}

      {pendingDrop && (
        // Reuses the query editor's confirmation gate rather than a second
        // dialog with its own rules: dropping an index is irreversible in the
        // same way a DROP statement is, and the typed-verb requirement is what
        // stops it being dismissed by muscle memory.
        <DangerousQueryDialog
          risk={{
            level: 'dangerous',
            verb: 'DROP',
            reasons: [
              `Permanently drops the index ${pendingDrop.name}. Rebuilding it on a large table can take a long time and will lock or load the server.`,
              ...(pendingDrop.scans !== undefined && pendingDrop.scans > 0
                ? [
                    `The planner has used it ${pendingDrop.scans.toLocaleString()} times, so queries currently depend on it.`,
                  ]
                : []),
            ],
            canEstimateRows: false,
            estimatedRows: null,
            isEstimating: false,
          }}
          query={pendingDrop.definition ?? `DROP INDEX ${pendingDrop.name}`}
          environmentLabel={activeConnection.environment}
          onCancel={() => {
            if (!isDropping) setPendingDrop(null);
          }}
          onConfirm={() => void handleDrop()}
        />
      )}
    </div>
  );
}
