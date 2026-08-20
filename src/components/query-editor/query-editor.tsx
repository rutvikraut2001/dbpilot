'use client';

import { useCallback, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Play,
  Plus,
  X,
  Clock,
  Download,
  Loader2,
  AlertTriangle,
  History,
  Star,
  Square,
  TextSelect,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { useStudioStore } from '@/lib/stores/studio';
import { QueryResult } from '@/lib/adapters/types';
import { useActiveConnection, useReadOnlyMode } from '@/lib/stores/connection';
import { apiFetch, errorMessage } from '@/lib/utils/api-client';
import { assessRisk } from '@/lib/query-guard';
import { dialectForConnection } from '@/lib/utils/dialect';
import {
  DangerousQueryDialog,
  QueryRiskDetails,
} from './dangerous-query-dialog';
import { QueryWorkspacePanel } from './query-workspace-panel';
import { SaveQueryDialog } from './save-query-dialog';
import { toast } from 'sonner';

// Dynamically import Monaco editor to avoid SSR issues
const MonacoEditor = dynamic(
  () => import('./monaco-editor').then((mod) => mod.MonacoEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading editor...
      </div>
    ),
  }
);

// Fixed row height, applied to each <tr> so the virtualizer's arithmetic and the
// rendered layout agree exactly. Cells are nowrap, so rows never grow past it.
const RESULT_ROW_HEIGHT = 33;

function ResultCell({ value }: Readonly<{ value: unknown }>) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">NULL</span>;
  }
  if (typeof value === 'object') {
    return (
      <code className="text-xs bg-muted px-1 py-0.5 rounded">
        {JSON.stringify(value)}
      </code>
    );
  }
  return <>{String(value)}</>;
}

/**
 * Virtualized query results.
 *
 * A query can return far more rows than a browser can lay out — this previously
 * rendered every returned row as a real <tr>, so a large result froze the tab.
 * Only the visible window is mounted now; spacer rows above and below preserve
 * the scroll height, which keeps the table's own layout algorithm intact
 * (absolutely positioning rows would break column alignment).
 */
function QueryResultsTable({
  columns,
  rows,
}: Readonly<{ columns: string[]; rows: Record<string, unknown>[] }>) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => RESULT_ROW_HEIGHT,
    overscan: 12,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? virtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0;

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto min-h-0">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-muted">
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col} className="whitespace-nowrap">
                {col}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {paddingTop > 0 && (
            <tr aria-hidden="true" style={{ height: paddingTop }}>
              <td colSpan={columns.length} />
            </tr>
          )}
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <TableRow key={virtualRow.index} style={{ height: RESULT_ROW_HEIGHT }}>
                {columns.map((col) => (
                  <TableCell key={col} className="py-1.5 whitespace-nowrap">
                    <ResultCell value={row[col]} />
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
          {paddingBottom > 0 && (
            <tr aria-hidden="true" style={{ height: paddingBottom }}>
              <td colSpan={columns.length} />
            </tr>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function QueryEditor() {
  const activeConnection = useActiveConnection();
  const readOnlyMode = useReadOnlyMode();
  const queryTabs = useStudioStore((s) => s.queryTabs);
  const activeQueryTabId = useStudioStore((s) => s.activeQueryTabId);
  const addQueryTab = useStudioStore((s) => s.addQueryTab);
  const removeQueryTab = useStudioStore((s) => s.removeQueryTab);
  const setActiveQueryTab = useStudioStore((s) => s.setActiveQueryTab);
  const updateQueryTab = useStudioStore((s) => s.updateQueryTab);
  const addToHistory = useStudioStore((s) => s.addToHistory);
  const clearHistory = useStudioStore((s) => s.clearHistory);
  const queryHistory = useStudioStore((s) => s.queryHistory);
  const savedQueries = useStudioStore((s) => s.savedQueries);
  const saveQueryToLibrary = useStudioStore((s) => s.saveQuery);
  const removeSavedQuery = useStudioStore((s) => s.removeSavedQuery);

  const activeTab = queryTabs.find((tab) => tab.id === activeQueryTabId);

  // Pending confirmation for a statement that changes data.
  const [pendingRisk, setPendingRisk] = useState<QueryRiskDetails | null>(null);
  const [pendingQuery, setPendingQuery] = useState('');
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [queryToSave, setQueryToSave] = useState<string | null>(null);

  // Running only the highlighted statement is the common case in a scratch pad
  // full of queries.
  const hasSelection = selectedText.trim().length > 0;
  const effectiveQuery = hasSelection ? selectedText : (activeTab?.query ?? '');

  const runQuery = useCallback(
    async (sql: string, fromSelection = false) => {
      if (!activeConnection || !activeTab || !sql.trim()) return;

      // Identifies this execution so it can be cancelled while in flight.
      const runId = crypto.randomUUID();
      updateQueryTab(activeTab.id, {
        isExecuting: true,
        result: null,
        runId,
        ranSelection: fromSelection,
      });

      try {
        // Note: `readOnly` is intentionally not sent. The server reads its own
        // state; a client-supplied value is ignored.
        // A SQL error is a result, not a transport failure: the response carries
        // the message *and* the execution time. Letting apiFetch throw on it
        // would drop the timing and row count the server already measured.
        const result = await apiFetch<QueryResult>(
          '/api/query',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              connectionId: activeConnection.id,
              query: sql,
              runId,
            }),
          },
          { bodyErrorIsFailure: false }
        );

        updateQueryTab(activeTab.id, {
          result,
          isExecuting: false,
          runId: undefined,
        });
        addToHistory({
          query: sql,
          database: activeConnection.name,
          durationMs: result.executionTimeMs,
          rowCount: result.rowCount,
          success: !result.error,
          error: result.error,
        });
      } catch (error) {
        // Report what actually went wrong — a rate limit, a lost connection, or a
        // rejected statement all used to collapse into "Failed to execute query".
        const message = errorMessage(error);
        updateQueryTab(activeTab.id, {
          result: {
            rows: [],
            columns: [],
            rowCount: 0,
            executionTimeMs: 0,
            error: message,
          },
          isExecuting: false,
          runId: undefined,
        });
        addToHistory({
          query: sql,
          database: activeConnection.name,
          success: false,
          error: message,
        });
      }
    },
    [activeConnection, activeTab, updateQueryTab, addToHistory]
  );

  /**
   * Ask the database to abort the running statement.
   *
   * PostgreSQL cancellation is out-of-band — the server signals the backend from
   * a separate connection — so the in-flight request resolves on its own with the
   * cancellation error rather than being aborted here.
   */
  const runId = activeTab?.runId;
  const cancelQuery = useCallback(async () => {
    if (!activeConnection || !runId) return;

    try {
      const { cancelled } = await apiFetch<{ cancelled: boolean }>(
        '/api/query/cancel',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            connectionId: activeConnection.id,
            runId,
          }),
        }
      );

      if (!cancelled) {
        toast.info('Nothing to cancel', {
          description: 'The query had already finished.',
        });
      }
    } catch (error) {
      toast.error('Could not cancel the query', {
        description: errorMessage(error),
      });
    }
  }, [activeConnection, runId]);

  /**
   * Gate execution behind a confirmation when the statement changes data.
   *
   * The risk assessment runs locally so a plain SELECT never pays a round trip.
   * The row estimate needs the planner, so it is fetched in the background while
   * the dialog is already on screen.
   */
  const executeQuery = useCallback(async () => {
    if (!activeConnection || !activeTab || !activeTab.query.trim()) return;

    const query = effectiveQuery;
    if (!query.trim()) return;

    // In read-only mode the server refuses writes outright, so a confirmation
    // dialog would be asking about something that cannot happen. Let it through
    // and surface the server's actual refusal instead.
    if (readOnlyMode) {
      await runQuery(query, hasSelection);
      return;
    }

    const risk = assessRisk(query, dialectForConnection(activeConnection.type));

    if (risk.level === 'safe') {
      await runQuery(query, hasSelection);
      return;
    }

    setPendingQuery(query);
    setPendingRisk({ ...risk, estimatedRows: null, isEstimating: risk.canEstimateRows });

    if (!risk.canEstimateRows) return;

    try {
      const analysis = await apiFetch<{ estimatedRows: number | null }>(
        '/api/query/analyze',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId: activeConnection.id, query }),
        }
      );
      setPendingRisk((current) =>
        current
          ? { ...current, estimatedRows: analysis.estimatedRows, isEstimating: false }
          : current
      );
    } catch {
      // A failed estimate must not block the decision — the dialog says it
      // could not be determined and the user chooses anyway.
      setPendingRisk((current) =>
        current ? { ...current, estimatedRows: null, isEstimating: false } : current
      );
    }
  }, [activeConnection, activeTab, effectiveQuery, hasSelection, readOnlyMode, runQuery]);

  const confirmPendingQuery = useCallback(async () => {
    const sql = pendingQuery;
    setPendingRisk(null);
    await runQuery(sql, sql !== activeTab?.query);
  }, [pendingQuery, runQuery, activeTab?.query]);

  const handleSaveQuery = useCallback((sql: string) => {
    const trimmed = sql.trim();
    if (trimmed) setQueryToSave(trimmed);
  }, []);

  const confirmSaveQuery = useCallback(
    (name: string) => {
      if (queryToSave) {
        saveQueryToLibrary(name, queryToSave);
        toast.success('Query saved');
      }
      setQueryToSave(null);
    },
    [queryToSave, saveQueryToLibrary]
  );

  const handleLoadQuery = useCallback(
    (sql: string) => {
      if (!activeTab) return;
      updateQueryTab(activeTab.id, { query: sql });
      setWorkspaceOpen(false);
    },
    [activeTab, updateQueryTab]
  );

  const handleEditorChange = (value: string | undefined) => {
    if (activeTab && value !== undefined) {
      updateQueryTab(activeTab.id, { query: value });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;

    // Ctrl/Cmd + Enter to execute (the selection, when there is one)
    if (e.key === 'Enter') {
      e.preventDefault();
      executeQuery();
      return;
    }

    // Ctrl/Cmd + S to save, rather than letting the browser save the page.
    if (e.key === 's') {
      e.preventDefault();
      handleSaveQuery(effectiveQuery);
    }
  };

  const handleExportResults = () => {
    if (!activeTab?.result?.rows.length) return;

    const { rows, columns } = activeTab.result;
    const csvContent = [
      columns.join(','),
      ...rows.map((row) =>
        columns
          .map((col) => {
            const val = row[col];
            if (val === null || val === undefined) return '';
            const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
            return str.includes(',') || str.includes('"') || str.includes('\n')
              ? `"${str.replace(/"/g, '""')}"`
              : str;
          })
          .join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `query_results_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getLanguage = () => {
    if (activeConnection?.type === 'mongodb') {
      return 'javascript';
    }
    if (activeConnection?.type === 'redis') {
      return 'plaintext';
    }
    return 'sql';
  };

  

  return (
    <div className="flex flex-col h-full" onKeyDown={handleKeyDown}>
      {/* Tabs Bar */}
      <div className="flex items-center justify-between border-b px-2 shrink-0">
        <div className="flex items-center">
          <Tabs value={activeQueryTabId || ''} className="h-10">
            <TabsList className="h-9 bg-transparent p-0">
              {queryTabs.map((tab) => (
                <div key={tab.id} className="flex items-center">
                  <TabsTrigger
                    value={tab.id}
                    onClick={() => setActiveQueryTab(tab.id)}
                    className="px-3 h-8 data-[state=active]:bg-muted rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                  >
                    {tab.name}
                  </TabsTrigger>
                  {queryTabs.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeQueryTab(tab.id);
                      }}
                      aria-label={`Close ${tab.name}`}
                      className="p-1 hover:bg-muted rounded"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </TabsList>
          </Tabs>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 ml-1"
            onClick={() => addQueryTab()}
            aria-label="New query tab"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2 py-1">
          {readOnlyMode && (
            <Badge variant="secondary" className="text-xs">
              Read-only
            </Badge>
          )}
          {hasSelection && (
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-400"
              title="Run will execute only the highlighted text"
            >
              <TextSelect className="h-3 w-3 mr-1" />
              Selection only
            </Badge>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => handleSaveQuery(effectiveQuery)}
            disabled={!effectiveQuery.trim()}
            aria-label="Save query"
            title="Save query (Ctrl/Cmd+S)"
          >
            <Star className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setWorkspaceOpen(true)}
            aria-label="Query history and saved queries"
            title="History and saved queries"
          >
            <History className="h-4 w-4" />
          </Button>

          {activeTab?.isExecuting && activeTab.runId ? (
            <Button size="sm" variant="destructive" onClick={cancelQuery}>
              <Square className="h-4 w-4 mr-1" />
              Cancel
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={executeQuery}
              disabled={!effectiveQuery.trim() || activeTab?.isExecuting}
            >
              <Play className="h-4 w-4 mr-1" />
              {activeTab?.isExecuting
                ? 'Running...'
                : hasSelection
                ? 'Run selection'
                : 'Run'}
            </Button>
          )}
        </div>
      </div>

      {/* Editor + Results (vertical resizable split) */}
      <ResizablePanelGroup orientation="vertical" className="flex-1 min-h-0">
        <ResizablePanel id="editor" defaultSize={activeTab?.result ? 55 : 100} minSize={20}>
          <div className="h-full min-h-[160px]">
            <MonacoEditor
              language={getLanguage()}
              value={activeTab?.query || ''}
              onChange={handleEditorChange}
              onSelectionChange={setSelectedText}
            />
          </div>
        </ResizablePanel>

        {activeTab?.result && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel id="results" defaultSize={45} minSize={15}>
              <div className="flex h-full flex-col border-t">
                {/* Results Header */}
                <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50 shrink-0">
                  <div className="flex items-center gap-3">
                    {activeTab.result.error ? (
                      <Badge variant="destructive">Error</Badge>
                    ) : (
                      <span className="text-sm font-medium">
                        {activeTab.result.rowCount} row{activeTab.result.rowCount !== 1 ? 's' : ''}
                      </span>
                    )}
                    {activeTab.ranSelection && (
                      <Badge
                        variant="outline"
                        className="border-amber-500/40 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-400"
                        title="Only the highlighted text was executed, not the whole editor"
                      >
                        <TextSelect className="mr-1 h-3 w-3" />
                        Ran selection only
                      </Badge>
                    )}
                    {/* Timing is shown either way — knowing a failing query took
                        5ms rather than 30s tells you where the problem is. */}
                    {activeTab.result.executionTimeMs > 0 && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {activeTab.result.executionTimeMs}ms
                      </span>
                    )}
                  </div>
                  {!activeTab.result.error && activeTab.result.rows.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={handleExportResults}>
                      <Download className="h-4 w-4 mr-1" />
                      Export
                    </Button>
                  )}
                </div>

                {/* Truncation notice — the server caps what it sends back. */}
                {activeTab.result.truncated && (
                  <div className="flex items-center gap-2 px-3 py-2 text-xs bg-amber-500/10 border-b border-amber-500/20 text-amber-700 dark:text-amber-400 shrink-0">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      Showing the first {activeTab.result.rows.length.toLocaleString()} of{' '}
                      {activeTab.result.totalRows?.toLocaleString()} rows. Add a
                      LIMIT clause to narrow the result, or export to get everything.
                    </span>
                  </div>
                )}

                {/* Results Content */}
                {activeTab.result.error ? (
                  <div className="flex-1 overflow-auto min-h-0 p-4 text-destructive">
                    <pre className="text-sm whitespace-pre-wrap">
                      {activeTab.result.error}
                    </pre>
                  </div>
                ) : activeTab.result.rows.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center min-h-0 text-muted-foreground text-sm">
                    Query executed successfully. No rows returned.
                  </div>
                ) : (
                  <QueryResultsTable
                    columns={activeTab.result.columns}
                    rows={activeTab.result.rows}
                  />
                )}
              </div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      {queryToSave !== null && (
        <SaveQueryDialog
          query={queryToSave}
          onCancel={() => setQueryToSave(null)}
          onSave={confirmSaveQuery}
        />
      )}

      <QueryWorkspacePanel
        open={workspaceOpen}
        onOpenChange={setWorkspaceOpen}
        history={queryHistory}
        savedQueries={savedQueries}
        onLoadQuery={handleLoadQuery}
        onSaveQuery={handleSaveQuery}
        onRemoveSaved={removeSavedQuery}
        onClearHistory={clearHistory}
      />

      {pendingRisk && (
      <DangerousQueryDialog
        risk={pendingRisk}
        query={pendingQuery}
        environmentLabel={
          activeConnection?.environment === 'production'
            ? `PRODUCTION — ${activeConnection.name}`
            : undefined
        }
        onCancel={() => setPendingRisk(null)}
        onConfirm={confirmPendingQuery}
      />
      )}
    </div>
  );
}
