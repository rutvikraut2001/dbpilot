'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
  ColumnResizeMode,
} from '@tanstack/react-table';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  RefreshCw,
  Download,
  Trash2,
  Save,
  X,
  Info,
  ArrowUpRight,
  Filter,
  Flame,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { useStudioStore } from '@/lib/stores/studio';
import { useActiveConnection, useReadOnlyMode } from '@/lib/stores/connection';
import { PaginatedResult } from '@/lib/adapters/types';
import { cn, formatTTL, formatBytes } from '@/lib/utils';

type RowData = Record<string, unknown>;

// Redis type badge colors
const REDIS_TYPE_COLORS: Record<string, string> = {
  string: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30',
  hash: 'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30',
  list: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30',
  set: 'bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30',
  zset: 'bg-pink-500/15 text-pink-700 dark:text-pink-400 border-pink-500/30',
  stream: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/30',
};

// Separate component for editable cell - manages its own state completely
function EditableCell({
  initialValue,
  columnKey,
  editedDataRef,
  autoFocus,
}: {
  initialValue: unknown;
  columnKey: string;
  editedDataRef: React.RefObject<RowData | null>;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState(String(initialValue ?? ''));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [autoFocus]);

  return (
    <Input
      ref={inputRef}
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        if (editedDataRef.current) {
          editedDataRef.current[columnKey] = e.target.value;
        }
      }}
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="h-7 text-xs border-primary/50 focus-visible:ring-primary/30 bg-background"
    />
  );
}

// Redis-specific cell renderer
function RedisCellDisplay({
  columnId,
  value,
}: {
  columnId: string;
  value: unknown;
}) {
  if (columnId === 'key') {
    return (
      <span className="font-mono text-sm select-all cursor-text break-all">
        {String(value ?? '')}
      </span>
    );
  }

  if (columnId === 'type') {
    const typeStr = String(value ?? 'unknown');
    const colorClass = REDIS_TYPE_COLORS[typeStr] || 'bg-muted text-muted-foreground border-border';
    return (
      <Badge variant="outline" className={cn('text-xs font-medium', colorClass)}>
        {typeStr}
      </Badge>
    );
  }

  if (columnId === 'ttl') {
    const ttlVal = value as number | null;
    const formatted = formatTTL(ttlVal);
    const isExpiring = ttlVal !== null && ttlVal !== undefined && ttlVal > 0;
    return (
      <span className={cn(
        'text-sm select-text',
        isExpiring ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-muted-foreground'
      )}>
        {formatted}
      </span>
    );
  }

  if (columnId === 'memory') {
    const memVal = value as number | null;
    if (memVal === null || memVal === undefined) {
      return <span className="text-muted-foreground/60 italic text-xs">N/A</span>;
    }
    return (
      <span className="text-sm text-muted-foreground select-text">{formatBytes(memVal)}</span>
    );
  }

  if (columnId === 'value') {
    if (value === null || value === undefined) {
      return <span className="text-muted-foreground/60 italic text-xs">NULL</span>;
    }
    const str = String(value);
    return (
      <pre className="text-sm font-mono whitespace-pre-wrap break-all select-all cursor-text m-0 bg-transparent">
        {str}
      </pre>
    );
  }

  // Fallback
  return <span className="text-sm select-text break-all">{String(value ?? '')}</span>;
}

// Display cell for non-editing mode
function DisplayCell({
  value,
  isForeignKey,
  foreignKeyRef,
  onFKClick,
}: {
  value: unknown;
  isForeignKey?: boolean;
  foreignKeyRef?: { table: string; column: string };
  onFKClick?: () => void;
}) {
  if (value === null || value === undefined) {
    return (
      <span className="text-muted-foreground/60 italic text-xs">NULL</span>
    );
  }

  if (typeof value === 'object') {
    return (
      <code className="text-xs bg-muted/50 px-1.5 py-0.5 rounded max-w-50 truncate block font-mono">
        {JSON.stringify(value)}
      </code>
    );
  }

  // FK cell - show value with clickable arrow
  if (isForeignKey && foreignKeyRef && onFKClick) {
    return (
      <div className="flex items-center gap-1.5 max-w-50">
        <span className="truncate text-sm">{String(value)}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFKClick();
          }}
          className="shrink-0 p-0.5 rounded hover:bg-primary/10 text-primary cursor-pointer transition-colors"
          title={`Open ${foreignKeyRef.table} where ${foreignKeyRef.column} = ${String(value)}`}
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <span className="max-w-50 truncate block text-sm">{String(value)}</span>
  );
}

// Inner table component that renders data for a specific table/filter
function DataTable({
  tableName,
  filter,
}: {
  tableName: string;
  filter?: { column: string; value: unknown };
}) {
  const activeConnection = useActiveConnection();
  const readOnlyMode = useReadOnlyMode();
  const { tableSchema, addDataTab } = useStudioStore();

  const isRedis = activeConnection?.type === 'redis';

  const [data, setData] = useState<RowData[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [isLoading, setIsLoading] = useState(false);
  const [sortBy, setSortBy] = useState<string | undefined>();
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Editing state (disabled for Redis)
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const editedDataRef = useRef<RowData | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<RowData | null>(null);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);

  // Flush All state
  const [flushAllDialogOpen, setFlushAllDialogOpen] = useState(false);
  const [isFlushing, setIsFlushing] = useState(false);

  // Column resizing
  const [columnResizeMode] = useState<ColumnResizeMode>('onChange');
  const [columnSizing, setColumnSizing] = useState({});

  const totalPages = Math.ceil(totalRows / pageSize);

  const fetchData = useCallback(async () => {
    if (!activeConnection || !tableName) return;

    setIsLoading(true);

    try {
      const params = new URLSearchParams({
        connectionId: activeConnection.id,
        table: tableName,
        page: page.toString(),
        pageSize: pageSize.toString(),
      });

      if (sortBy) {
        params.set('sortBy', sortBy);
        params.set('sortOrder', sortOrder);
      }

      if (filter) {
        params.set(
          'filters',
          JSON.stringify({ [filter.column]: filter.value })
        );
      }

      const response = await fetch(`/api/data?${params}`);
      const result: PaginatedResult = await response.json();

      if (!result.data) {
        console.error('Failed to fetch data:', result);
        return;
      }

      setData(result.data);
      setTotalRows(result.total);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [activeConnection, tableName, page, pageSize, sortBy, sortOrder, filter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Keyboard shortcuts for editing (non-Redis only)
  useEffect(() => {
    if (isRedis) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingRow === null) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        editedDataRef.current = null;
        setEditingRow(null);
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setUpdateDialogOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingRow, isRedis]);

  // Build FK lookup from tableSchema
  const fkLookup = useMemo(() => {
    const map: Record<
      string,
      {
        isForeignKey: boolean;
        foreignKeyRef?: { table: string; column: string };
      }
    > = {};
    tableSchema.forEach((col) => {
      if (col.isForeignKey && col.foreignKeyRef) {
        map[col.name] = {
          isForeignKey: true,
          foreignKeyRef: col.foreignKeyRef,
        };
      }
    });
    return map;
  }, [tableSchema]);

  const getPrimaryKey = useCallback(
    (row: RowData): Record<string, unknown> => {
      // For Redis, the primary key is always the 'key' field
      if (isRedis) {
        return { key: row.key };
      }

      const pkColumns = tableSchema.filter((col) => col.isPrimaryKey);
      if (pkColumns.length === 0) {
        const idCol = tableSchema.find(
          (col) => col.name === '_id' || col.name === 'id'
        );
        if (idCol) {
          return { [idCol.name]: row[idCol.name] };
        }
        return {};
      }

      const pk: Record<string, unknown> = {};
      pkColumns.forEach((col) => {
        pk[col.name] = row[col.name];
      });
      return pk;
    },
    [tableSchema, isRedis]
  );

  const handleStartEdit = useCallback(
    (rowIndex: number, rowData: RowData) => {
      if (readOnlyMode || isRedis) return;
      editedDataRef.current = { ...rowData };
      setEditingRow(rowIndex);
    },
    [readOnlyMode, isRedis]
  );

  const handleCancelEdit = useCallback(() => {
    editedDataRef.current = null;
    setEditingRow(null);
  }, []);

  const handleSaveRowClick = useCallback(() => {
    if (editingRow === null) return;
    setUpdateDialogOpen(true);
  }, [editingRow]);

  const handleFKClick = useCallback(
    (foreignKeyRef: { table: string; column: string }, value: unknown) => {
      if (editingRow !== null) return;
      addDataTab(foreignKeyRef.table, {
        column: foreignKeyRef.column,
        value,
      });
    },
    [editingRow, addDataTab]
  );

  const handleConfirmUpdate = async () => {
    if (editingRow === null || !activeConnection) return;

    try {
      const originalRow = data[editingRow];
      const primaryKey = getPrimaryKey(originalRow);

      const response = await fetch('/api/data', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: activeConnection.id,
          table: tableName,
          primaryKey,
          data: editedDataRef.current,
          readOnly: readOnlyMode,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setUpdateDialogOpen(false);
        setEditingRow(null);
        editedDataRef.current = null;
        fetchData();
      } else {
        alert(result.error || 'Failed to update row');
      }
    } catch (error) {
      console.error('Failed to update row:', error);
    }
  };

  const handleDeleteRow = async () => {
    if (!rowToDelete || !activeConnection) return;

    try {
      const primaryKey = getPrimaryKey(rowToDelete);

      const response = await fetch(
        `/api/data?connectionId=${activeConnection.id}&table=${tableName}&primaryKey=${encodeURIComponent(JSON.stringify(primaryKey))}&readOnly=${readOnlyMode}`,
        { method: 'DELETE' }
      );

      const result = await response.json();

      if (result.success) {
        setDeleteDialogOpen(false);
        setRowToDelete(null);
        fetchData();
      } else {
        alert(result.error || 'Failed to delete');
      }
    } catch (error) {
      console.error('Failed to delete:', error);
    }
  };

  const handleFlushAll = async () => {
    if (!activeConnection) return;

    setIsFlushing(true);
    try {
      const response = await fetch('/api/redis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: activeConnection.id,
          action: 'flushall',
        }),
      });

      const result = await response.json();
      if (result.success) {
        setFlushAllDialogOpen(false);
        fetchData();
      } else {
        alert(result.error || 'Failed to flush');
      }
    } catch (error) {
      console.error('Flush all error:', error);
    } finally {
      setIsFlushing(false);
    }
  };

  const handleExportCSV = () => {
    if (data.length === 0) return;

    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map((row) =>
        headers
          .map((h) => {
            const val = row[h];
            if (val === null || val === undefined) return '';
            const str =
              typeof val === 'object' ? JSON.stringify(val) : String(val);
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
    a.download = `${tableName}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns: ColumnDef<RowData, unknown>[] = useMemo(() => {
    if (data.length === 0) return [];

    return Object.keys(data[0]).map((key) => ({
      accessorKey: key,
      header: () => (
        <button
          onClick={() => {
            if (sortBy === key) {
              setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
            } else {
              setSortBy(key);
              setSortOrder('asc');
            }
          }}
          className="flex items-center gap-1.5 font-semibold text-sm hover:text-primary transition-colors text-left w-full"
        >
          <span className="truncate">{key}</span>
          {sortBy === key && (
            <span className="text-primary shrink-0">
              {sortOrder === 'asc' ? '↑' : '↓'}
            </span>
          )}
        </button>
      ),
      size: isRedis
        ? (key === 'key' ? 280 : key === 'value' ? 450 : key === 'type' ? 100 : key === 'ttl' ? 130 : 120)
        : 150,
      minSize: 60,
      maxSize: isRedis && key === 'value' ? 1000 : 600,
    }));
  }, [data, sortBy, sortOrder, isRedis]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode,
    onColumnSizingChange: setColumnSizing,
    state: {
      columnSizing,
    },
  });

  const canEdit = !readOnlyMode && !isRedis;
  const canDelete = !readOnlyMode;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <h3 className="font-semibold text-base shrink-0">{tableName}</h3>
          <span className="text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0">
            {totalRows.toLocaleString()} {isRedis ? 'keys' : 'rows'}
          </span>

          {filter && (
            <div className="flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/20 px-2.5 py-1 rounded-full text-xs font-medium shrink-0">
              <Filter className="h-3 w-3" />
              <span>
                {filter.column} = {String(filter.value)}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {canEdit && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-2">
                  <Info className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Double-click to edit</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Double-click any cell to edit the row</p>
                <p className="text-muted-foreground">
                  Ctrl+Enter to save, Esc to cancel
                </p>
              </TooltipContent>
            </Tooltip>
          )}

          {isRedis && !readOnlyMode && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFlushAllDialogOpen(true)}
              className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
            >
              <Flame className="h-3.5 w-3.5 mr-1.5" />
              Flush All
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={fetchData}
            disabled={isLoading}
            className="h-8"
          >
            <RefreshCw
              className={cn(
                'h-3.5 w-3.5 mr-1.5',
                isLoading && 'animate-spin'
              )}
            />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            className="h-8"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto min-h-0">
        <table
          className="w-full border-collapse"
          style={{ minWidth: table.getTotalSize() || '100%' }}
        >
          <thead className="sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr
                key={headerGroup.id}
                className="bg-muted/50 backdrop-blur-sm"
              >
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="relative text-left px-4 py-3 border-b border-r border-border/50 bg-muted/80 first:border-l-0"
                    style={{ width: header.getSize() }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                    {header.column.getCanResize() && (
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onDoubleClick={() => header.column.resetSize()}
                        className={cn(
                          'absolute right-0 top-0 w-1 h-full cursor-col-resize select-none touch-none',
                          'hover:bg-primary/60 active:bg-primary',
                          'transition-colors duration-150',
                          header.column.getIsResizing()
                            ? 'bg-primary'
                            : 'bg-border/50 hover:bg-primary/40'
                        )}
                        style={{ transform: 'translateX(50%)' }}
                      />
                    )}
                  </th>
                ))}
                {canDelete && (
                  <th className="w-10 bg-muted/80 border-b border-border/50" />
                )}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td
                  colSpan={columns.length + (canDelete ? 1 : 0)}
                  className="h-32 text-center text-muted-foreground"
                >
                  <div className="flex items-center justify-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Loading...</span>
                  </div>
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (canDelete ? 1 : 0)}
                  className="h-32 text-center text-muted-foreground"
                >
                  No data found
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row, rowIndex) => {
                const isEditing = editingRow === row.index;
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      'border-b border-border/30 transition-colors group',
                      isEditing
                        ? 'bg-primary/5 ring-1 ring-inset ring-primary/20'
                        : rowIndex % 2 === 0
                          ? 'bg-background hover:bg-muted/30'
                          : 'bg-muted/20 hover:bg-muted/40'
                    )}
                    onDoubleClick={() => {
                      if (!isEditing && canEdit) {
                        handleStartEdit(row.index, row.original);
                      }
                    }}
                  >
                    {row.getVisibleCells().map((cell, cellIndex) => {
                      const columnId = cell.column.id;
                      const value = cell.getValue();
                      const fkInfo = fkLookup[columnId];
                      return (
                        <td
                          key={cell.id}
                          className={cn(
                            'px-4 py-2 border-r border-border/30 relative',
                            canEdit && !isEditing && 'cursor-pointer'
                          )}
                          style={{ width: cell.column.getSize() }}
                        >
                          {isEditing ? (
                            <EditableCell
                              key={`${row.id}-${columnId}-edit`}
                              initialValue={value}
                              columnKey={columnId}
                              editedDataRef={editedDataRef}
                              autoFocus={cellIndex === 0}
                            />
                          ) : isRedis ? (
                            <RedisCellDisplay
                              columnId={columnId}
                              value={value}
                            />
                          ) : (
                            <DisplayCell
                              value={value}
                              isForeignKey={fkInfo?.isForeignKey}
                              foreignKeyRef={fkInfo?.foreignKeyRef}
                              onFKClick={
                                fkInfo?.foreignKeyRef
                                  ? () =>
                                      handleFKClick(
                                        fkInfo.foreignKeyRef!,
                                        value
                                      )
                                  : undefined
                              }
                            />
                          )}
                        </td>
                      );
                    })}
                    {canDelete && (
                      <td className="w-10 px-2 py-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 hover:bg-destructive/10 text-muted-foreground/50 hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRowToDelete(row.original);
                            setDeleteDialogOpen(true);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Floating Edit Actions Bar */}
      {editingRow !== null && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-20">
          <div className="flex items-center gap-2 bg-background border shadow-lg rounded-lg px-4 py-2">
            <span className="text-sm text-muted-foreground mr-2">
              Editing row {editingRow + 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancelEdit}
              className="h-8"
            >
              <X className="h-3.5 w-3.5 mr-1.5" />
              Cancel
              <kbd className="ml-2 text-xs text-muted-foreground bg-muted px-1 rounded">
                Esc
              </kbd>
            </Button>
            <Button size="sm" onClick={handleSaveRowClick} className="h-8">
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save Changes
              <kbd className="ml-2 text-xs text-primary-foreground/70 bg-primary-foreground/20 px-1 rounded">
                Ctrl+Enter
              </kbd>
            </Button>
          </div>
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/30 shrink-0">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {isRedis ? 'Keys per page:' : 'Rows per page:'}
          </span>
          <Select
            value={pageSize.toString()}
            onValueChange={(v) => {
              setPageSize(parseInt(v));
              setPage(1);
            }}
          >
            <SelectTrigger className="h-8 w-18 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[25, 50, 100].map((size) => (
                <SelectItem key={size} value={size.toString()}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Page <span className="font-medium text-foreground">{page}</span>{' '}
            of{' '}
            <span className="font-medium text-foreground">
              {totalPages || 1}
            </span>
          </span>
          <div className="flex items-center gap-1 ml-2">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setPage(1)}
              disabled={page === 1}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isRedis ? 'Delete Key' : 'Delete Row'}</DialogTitle>
            <DialogDescription>
              {isRedis ? (
                <>Are you sure you want to delete the key <strong>{String(rowToDelete?.key ?? '')}</strong>? This action cannot be undone.</>
              ) : (
                'Are you sure you want to delete this row? This action cannot be undone.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteRow}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Update Confirmation Dialog */}
      <Dialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Update</DialogTitle>
            <DialogDescription>
              Are you sure you want to update this row? This will modify the
              data in your database.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUpdateDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirmUpdate}>Update</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Flush All Confirmation Dialog */}
      <Dialog open={flushAllDialogOpen} onOpenChange={setFlushAllDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Flush All Databases</DialogTitle>
            <DialogDescription>
              This will delete <strong>all keys from all Redis databases</strong> (0-15).
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFlushAllDialogOpen(false)}
              disabled={isFlushing}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleFlushAll}
              disabled={isFlushing}
            >
              {isFlushing ? 'Flushing...' : 'Flush All Databases'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Main DataViewer with tab management
export function DataViewer() {
  const activeConnection = useActiveConnection();
  const {
    selectedTable,
    dataTabs,
    activeDataTabId,
    setActiveDataTab,
    removeDataTab,
  } = useStudioStore();

  const isRedis = activeConnection?.type === 'redis';

  // Determine what to show: active data tab or selected table
  const activeTab = dataTabs.find((t) => t.id === activeDataTabId);

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full overflow-hidden bg-background relative">
        {/* Data tabs bar - only show when there are tabs */}
        {dataTabs.length > 0 && (
          <div className="flex items-center border-b bg-muted/20 shrink-0 overflow-x-auto">
            {/* Main table tab */}
            <button
              onClick={() => setActiveDataTab('')}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 text-sm border-r border-border/30 whitespace-nowrap transition-colors',
                !activeDataTabId
                  ? 'bg-background text-foreground font-medium border-b-2 border-b-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
              )}
            >
              {selectedTable || 'Data'}
            </button>

            {/* FK navigation tabs */}
            {dataTabs.map((tab) => (
              <div
                key={tab.id}
                className={cn(
                  'flex items-center border-r border-border/30 transition-colors',
                  activeDataTabId === tab.id
                    ? 'bg-background border-b-2 border-b-primary'
                    : 'hover:bg-muted/30'
                )}
              >
                <button
                  onClick={() => setActiveDataTab(tab.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap',
                    activeDataTabId === tab.id
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <span className="max-w-40 truncate">{tab.tableName}</span>
                  {tab.filter && (
                    <span className="text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                      {tab.filter.column}={String(tab.filter.value)}
                    </span>
                  )}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeDataTab(tab.id);
                  }}
                  className="p-1 mr-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {activeTab ? (
            <DataTable
              key={activeTab.id}
              tableName={activeTab.tableName}
              filter={activeTab.filter}
            />
          ) : selectedTable ? (
            <DataTable key={selectedTable} tableName={selectedTable} />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              {isRedis
                ? 'Select a key pattern from the sidebar to browse keys'
                : 'Select a table from the sidebar to view data'}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
