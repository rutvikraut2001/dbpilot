'use client';

import { useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Play, Plus, X, Clock, Download, Loader2 } from 'lucide-react';
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
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
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

export function QueryEditor() {
  const activeConnection = useActiveConnection();
  const readOnlyMode = useReadOnlyMode();
  const {
    queryTabs,
    activeQueryTabId,
    addQueryTab,
    removeQueryTab,
    setActiveQueryTab,
    updateQueryTab,
    addToHistory,
  } = useStudioStore();

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
    return 'sql';
  };

  

  return (
    <div className="flex flex-col h-full" onKeyDown={handleKeyDown}>
      {/* Tabs Bar */}
      <div className="flex items-center justify-between border-b px-2">
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

      {/* Editor */}
      <div className="flex-1 min-h-[200px]">
        <MonacoEditor
          language={getLanguage()}
          value={activeTab?.query || ''}
          onChange={handleEditorChange}
        />
      </div>

      {/* Results */}
      {activeTab?.result && (
        <div className="border-t flex flex-col h-[300px]">
          {/* Results Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
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

          {/* Results Content */}
          <ScrollArea className="flex-1">
            {activeTab.result.error ? (
              <div className="p-4 text-destructive">
                <pre className="text-sm whitespace-pre-wrap">
                  {activeTab.result.error}
                </pre>
              </div>
            ) : activeTab.result.rows.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Query executed successfully. No rows returned.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {activeTab.result.columns.map((col) => (
                      <TableHead key={col} className="whitespace-nowrap">
                        {col}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeTab.result.rows.map((row, i) => (
                    <TableRow key={i}>
                      {activeTab.result!.columns.map((col) => (
                        <TableCell key={col} className="py-1.5">
                          {row[col] === null || row[col] === undefined ? (
                            <span className="text-muted-foreground italic">NULL</span>
                          ) : typeof row[col] === 'object' ? (
                            <code className="text-xs bg-muted px-1 py-0.5 rounded">
                              {JSON.stringify(row[col])}
                            </code>
                          ) : (
                            String(row[col])
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
