'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Table2,
  FileText,
  RefreshCw,
  Search,
  ChevronRight,
  Database,
  Key,
  Trash2,
  MoreVertical,
  GitBranch,
  Download,
  Copy,
  PanelRightOpen,
  FileJson,
  FileSpreadsheet,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useStudioStore, useFilteredTables } from '@/lib/stores/studio';
import { useActiveConnection, useReadOnlyMode } from '@/lib/stores/connection';
import { cn, formatBytes } from '@/lib/utils';
import { apiFetch, errorMessage } from '@/lib/utils/api-client';
import { DatabasePicker } from './database-picker';
import { TABLE_DRAG_MIME } from '@/lib/constants';
import { TableInfo } from '@/lib/adapters/types';

export function TableBrowser() {
  const activeConnection = useActiveConnection();
  const readOnlyMode = useReadOnlyMode();
  const filteredTables = useFilteredTables();
  // Per-field selectors: this component previously re-rendered on every store
  // write, including each keystroke in its own filter box and every entry
  // pushed onto the query history from a different tab.
  const selectedTable = useStudioStore((s) => s.selectedTable);
  const setSelectedTable = useStudioStore((s) => s.setSelectedTable);
  const openTableTab = useStudioStore((s) => s.openTableTab);
  const setTables = useStudioStore((s) => s.setTables);
  const setActiveTab = useStudioStore((s) => s.setActiveTab);
  const setSchemaFocusTable = useStudioStore((s) => s.setSchemaFocusTable);
  const tableFilter = useStudioStore((s) => s.tableFilter);
  const setTableFilter = useStudioStore((s) => s.setTableFilter);
  const isLoadingTables = useStudioStore((s) => s.isLoadingTables);
  const setIsLoadingTables = useStudioStore((s) => s.setIsLoadingTables);
  const setError = useStudioStore((s) => s.setError);
  const reset = useStudioStore((s) => s.reset);

  // undefined = not yet known, null = connected to the server with no database
  // chosen. The distinction matters: only the second is worth explaining.
  const [currentDatabase, setCurrentDatabase] = useState<string | null | undefined>(
    undefined
  );
  const error = useStudioStore((s) => s.error);

  const [flushDialogOpen, setFlushDialogOpen] = useState(false);
  const [isFlushing, setIsFlushing] = useState(false);
  const [localFilter, setLocalFilter] = useState(tableFilter);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Virtualized table list. Every row previously mounted a ContextMenu, a
  // Tooltip and a DropdownMenu — three Radix components each — so a database
  // with a few hundred tables paid that cost for every one of them, whether
  // on screen or not. Only the visible window is mounted now.
  const listRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filteredTables.length,
    getScrollElement: () => listRef.current,
    // Row is 32px tall plus the 4px gap that used to come from space-y-1.
    estimateSize: () => 36,
    overscan: 8,
  });

  const handleFilterChange = useCallback((value: string) => {
    setLocalFilter(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setTableFilter(value);
    }, 200);
  }, [setTableFilter]);

  // Sync local filter when store filter changes externally
  useEffect(() => {
    setLocalFilter(tableFilter);
  }, [tableFilter]);

  const isRedis = activeConnection?.type === 'redis';

  const fetchTables = useCallback(async () => {
    if (!activeConnection) return;

    setIsLoadingTables(true);
    setError(null);

    try {
      const data = await apiFetch<{ tables: TableInfo[] }>(
        `/api/tables?connectionId=${activeConnection.id}`
      );
      setTables(data.tables);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsLoadingTables(false);
    }
  }, [activeConnection, setTables, setIsLoadingTables, setError]);

  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

  // Opening a tab is all that's needed: DataViewer fetches the schema for
  // whichever table it is showing. This component used to fetch it as well, so
  // every table click issued the same /api/schema request twice.
  const handleTableSelect = (tableName: string) => {
    openTableTab(tableName);
  };

  /**
   * Rebuild the workspace after the connection moves to another database.
   *
   * Open tabs name tables in the database we just left, and those names need not
   * exist in the new one — leaving them would show tabs that error on click. The
   * table list is refetched rather than trusted, since the server has already
   * dropped its cache for this connection.
   */
  const handleDatabaseChanged = useCallback(() => {
    reset();
    void fetchTables();
  }, [reset, fetchTables]);

  const handleShowDiagram = (tableName: string) => {
    setSchemaFocusTable(tableName);
    setActiveTab('schema');
  };

  const handleExport = (tableName: string, format: 'csv' | 'json') => {
    if (!activeConnection) return;
    const url = `/api/export?connectionId=${activeConnection.id}&table=${encodeURIComponent(
      tableName
    )}&format=${format}`;
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success(`Exporting ${tableName} as ${format.toUpperCase()}…`);
  };

  const handleCopyName = async (tableName: string) => {
    try {
      await navigator.clipboard.writeText(tableName);
      toast.success('Table name copied');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const handleFlushDb = async () => {
    if (!activeConnection) return;

    setIsFlushing(true);
    try {
      await apiFetch<{ success: boolean }>('/api/redis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: activeConnection.id,
          action: 'flushdb',
        }),
      });

      setFlushDialogOpen(false);
      setSelectedTable('');
      toast.success('Database flushed');
      fetchTables();
    } catch (err) {
      toast.error('Failed to flush database', { description: errorMessage(err) });
    } finally {
      setIsFlushing(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm truncate">
              {activeConnection?.name || 'Database'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {isRedis && !readOnlyMode && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setFlushDialogOpen(true)}
                      aria-label="Flush current database"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Flush current database</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={fetchTables}
                    disabled={isLoadingTables}
                    aria-label={isRedis ? 'Refresh key patterns' : 'Refresh tables'}
                  >
                    <RefreshCw
                      className={cn(
                        'h-4 w-4',
                        isLoadingTables && 'animate-spin'
                      )}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {isRedis ? 'Refresh key patterns' : 'Refresh tables'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Which database on this server the connection is reading from. */}
        <div className="mb-2">
          <DatabasePicker
            onDatabaseChanged={handleDatabaseChanged}
            onCurrentChanged={setCurrentDatabase}
          />
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={isRedis ? 'Filter key patterns...' : 'Filter tables...'}
            value={localFilter}
            onChange={(e) => handleFilterChange(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      {/* Table List */}
      <ScrollArea className="flex-1 overflow-auto" viewportRef={listRef}>
        <div className="p-2">
          {isLoadingTables ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              Loading...
            </div>
          ) : error ? (
            // This branch used to not exist: a failed load wrote to the store's
            // `error` field, which nothing read, so the sidebar just said
            // "No tables found" as though the database were empty.
            <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <p className="text-sm font-medium">
                {isRedis ? 'Could not load keys' : 'Could not load tables'}
              </p>
              <p className="text-xs text-muted-foreground break-words">{error}</p>
              <Button variant="outline" size="sm" onClick={fetchTables}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Retry
              </Button>
            </div>
          ) : currentDatabase === null && !tableFilter ? (
            // Connected to the server, but pointed at no database. Saying "no
            // tables found" here describes the symptom and hides the cause.
            <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
              <Database className="h-5 w-5 text-muted-foreground" />
              <p className="text-sm font-medium">No database selected</p>
              <p className="text-xs text-muted-foreground">
                Your connection string does not name one. Pick a database above
                to see its tables.
              </p>
            </div>
          ) : filteredTables.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {tableFilter
                ? (isRedis ? 'No matching key patterns' : 'No matching tables')
                : (isRedis ? 'No keys found' : 'No tables found')}
            </div>
          ) : (
            <div
              className="relative"
              style={{ height: rowVirtualizer.getTotalSize() }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const table = filteredTables[virtualRow.index];
                const isActive = selectedTable === table.name;
                const TypeIcon =
                  table.type === 'keyspace'
                    ? Key
                    : table.type === 'view'
                    ? FileText
                    : Table2;

                const onDragStart = (e: React.DragEvent) => {
                  e.dataTransfer.setData(TABLE_DRAG_MIME, table.name);
                  e.dataTransfer.setData('text/plain', table.name);
                  e.dataTransfer.effectAllowed = 'copy';
                };

                return (
                  <div
                    key={table.name}
                    className="absolute left-0 top-0 w-full pb-1"
                    style={{
                      height: virtualRow.size,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <div
                        className={cn(
                          'group relative flex items-center rounded-lg transition-colors',
                          isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                        )}
                        draggable
                        onDragStart={onDragStart}
                      >
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => handleTableSelect(table.name)}
                                className="min-w-0 flex-1 flex items-center gap-2 px-2 py-1.5 text-left text-sm"
                              >
                                <TypeIcon className="h-4 w-4 shrink-0" />
                                <span className="truncate flex-1">{table.name}</span>
                                {isActive && (
                                  <ChevronRight className="h-4 w-4 shrink-0 opacity-0 group-hover:opacity-100" />
                                )}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-xs">
                              <div className="space-y-1">
                                <p className="font-medium">{table.name}</p>
                                {table.schema && (
                                  <p className="text-xs text-muted-foreground">
                                    Schema: {table.schema}
                                  </p>
                                )}
                                <div className="flex gap-2 text-xs">
                                  {table.rowCount !== undefined && (
                                    <Badge variant="secondary">
                                      {table.rowCount.toLocaleString()}{' '}
                                      {isRedis ? 'keys' : 'rows'}
                                    </Badge>
                                  )}
                                  {table.sizeBytes !== undefined && table.sizeBytes > 0 && (
                                    <Badge variant="secondary">
                                      {formatBytes(table.sizeBytes)}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>

                        {/* Three-dots menu */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              aria-label={`Actions for ${table.name}`}
                              draggable={false}
                              onClick={(e) => e.stopPropagation()}
                              className={cn(
                                'mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100',
                                isActive
                                  ? 'hover:bg-primary-foreground/20'
                                  : 'hover:bg-muted-foreground/15'
                              )}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            {!isRedis && (
                              <DropdownMenuItem onSelect={() => handleShowDiagram(table.name)}>
                                <GitBranch className="h-4 w-4" />
                                Show diagram
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onSelect={() => handleTableSelect(table.name)}>
                              <PanelRightOpen className="h-4 w-4" />
                              Open in data tab
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger>
                                <Download className="h-4 w-4" />
                                Export data
                              </DropdownMenuSubTrigger>
                              <DropdownMenuSubContent>
                                <DropdownMenuItem onSelect={() => handleExport(table.name, 'csv')}>
                                  <FileSpreadsheet className="h-4 w-4" />
                                  Export as CSV
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => handleExport(table.name, 'json')}>
                                  <FileJson className="h-4 w-4" />
                                  Export as JSON
                                </DropdownMenuItem>
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => handleCopyName(table.name)}>
                              <Copy className="h-4 w-4" />
                              Copy name
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-52">
                      {!isRedis && (
                        <ContextMenuItem onSelect={() => handleShowDiagram(table.name)}>
                          <GitBranch className="h-4 w-4" />
                          Show diagram
                        </ContextMenuItem>
                      )}
                      <ContextMenuItem onSelect={() => handleTableSelect(table.name)}>
                        <PanelRightOpen className="h-4 w-4" />
                        Open in data tab
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>
                          <Download className="h-4 w-4" />
                          Export data
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                          <ContextMenuItem onSelect={() => handleExport(table.name, 'csv')}>
                            <FileSpreadsheet className="h-4 w-4" />
                            Export as CSV
                          </ContextMenuItem>
                          <ContextMenuItem onSelect={() => handleExport(table.name, 'json')}>
                            <FileJson className="h-4 w-4" />
                            Export as JSON
                          </ContextMenuItem>
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                      <ContextMenuSeparator />
                      <ContextMenuItem onSelect={() => handleCopyName(table.name)}>
                        <Copy className="h-4 w-4" />
                        Copy name
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-2 border-t text-xs text-muted-foreground text-center shrink-0">
        {isRedis
          ? `${filteredTables.length} key pattern${filteredTables.length !== 1 ? 's' : ''}`
          : `${filteredTables.length} table${filteredTables.length !== 1 ? 's' : ''}`}
      </div>

      {/* Flush DB Confirmation Dialog */}
      <Dialog open={flushDialogOpen} onOpenChange={setFlushDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Flush Database</DialogTitle>
            <DialogDescription>
              This will delete <strong>all keys</strong> in the current Redis database.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFlushDialogOpen(false)}
              disabled={isFlushing}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleFlushDb}
              disabled={isFlushing}
            >
              {isFlushing ? 'Flushing...' : 'Flush Database'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
