'use client';

import { useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Play, Plus, X, Clock, Download, Loader2, AlertTriangle } from 'lucide-react';
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
import { useActiveConnection, useReadOnlyMode } from '@/lib/stores/connection';

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

  const activeTab = queryTabs.find((tab) => tab.id === activeQueryTabId);

  const executeQuery = useCallback(async () => {
    if (!activeConnection || !activeTab || !activeTab.query.trim()) return;

    updateQueryTab(activeTab.id, { isExecuting: true, result: null });

    try {
      const response = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: activeConnection.id,
          query: activeTab.query,
          readOnly: readOnlyMode,
        }),
      });

      const result = await response.json();

      updateQueryTab(activeTab.id, { result, isExecuting: false });
      addToHistory(activeTab.query, activeConnection.name);
    } catch {
      updateQueryTab(activeTab.id, {
        result: {
          rows: [],
          columns: [],
          rowCount: 0,
          executionTimeMs: 0,
          error: 'Failed to execute query',
        },
        isExecuting: false,
      });
    }
  }, [activeConnection, activeTab, readOnlyMode, updateQueryTab, addToHistory]);

  const handleEditorChange = (value: string | undefined) => {
    if (activeTab && value !== undefined) {
      updateQueryTab(activeTab.id, { query: value });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl/Cmd + Enter to execute
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      executeQuery();
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
          <Button
            size="sm"
            onClick={executeQuery}
            disabled={!activeTab?.query.trim() || activeTab?.isExecuting}
          >
            <Play className="h-4 w-4 mr-1" />
            {activeTab?.isExecuting ? 'Running...' : 'Run'}
          </Button>
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
                      <>
                        <span className="text-sm font-medium">
                          {activeTab.result.rowCount} row{activeTab.result.rowCount !== 1 ? 's' : ''}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {activeTab.result.executionTimeMs}ms
                        </span>
                      </>
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
    </div>
  );
}
