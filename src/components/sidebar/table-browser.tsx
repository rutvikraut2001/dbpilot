'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
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
import { TABLE_DRAG_MIME } from '@/lib/constants';

export function TableBrowser() {
  const activeConnection = useActiveConnection();
  const readOnlyMode = useReadOnlyMode();
  const filteredTables = useFilteredTables();
  const {
    selectedTable,
    setSelectedTable,
    openTableTab,
    setTables,
    setTableSchema,
    setActiveTab,
    setSchemaFocusTable,
    tableFilter,
    setTableFilter,
    isLoadingTables,
    setIsLoadingTables,
    setIsLoadingSchema,
    setError,
  } = useStudioStore();

  const [flushDialogOpen, setFlushDialogOpen] = useState(false);
  const [isFlushing, setIsFlushing] = useState(false);
  const [localFilter, setLocalFilter] = useState(tableFilter);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const response = await fetch(
        `/api/tables?connectionId=${activeConnection.id}`
      );
      const data = await response.json();

      if (data.error) {
        setError(data.error);
      } else {
        setTables(data.tables);
      }
    } catch {
      setError('Failed to load tables');
    } finally {
      setIsLoadingTables(false);
    }
  }, [activeConnection, setTables, setIsLoadingTables, setError]);

  const fetchTableSchema = useCallback(
    async (tableName: string) => {
      if (!activeConnection) return;

      setIsLoadingSchema(true);

      try {
        const response = await fetch(
          `/api/schema?connectionId=${activeConnection.id}&table=${encodeURIComponent(tableName)}`
        );
        const data = await response.json();

        if (!data.error) {
          setTableSchema(data.schema);
        }
      } catch {
        // schema load failed silently
      } finally {
        setIsLoadingSchema(false);
      }
    },
    [activeConnection, setTableSchema, setIsLoadingSchema]
  );

  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

  const handleTableSelect = (tableName: string) => {
    openTableTab(tableName);
    fetchTableSchema(tableName);
  };

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
      const response = await fetch('/api/redis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: activeConnection.id,
          action: 'flushdb',
        }),
      });

      const result = await response.json();
      if (result.success) {
        setFlushDialogOpen(false);
        setSelectedTable('');
        fetchTables();
      } else {
        alert(result.error || 'Failed to flush database');
      }
    } catch {
      alert('Failed to flush database');
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
      <ScrollArea className="flex-1 overflow-auto">
        <div className="p-2">
          {isLoadingTables ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              Loading...
            </div>
          ) : filteredTables.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {tableFilter
                ? (isRedis ? 'No matching key patterns' : 'No matching tables')
                : (isRedis ? 'No keys found' : 'No tables found')}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredTables.map((table) => {
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
                  <ContextMenu key={table.name}>
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
