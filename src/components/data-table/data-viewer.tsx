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
import { useStudioStore } from '@/lib/stores/studio';
import { useActiveConnection, useReadOnlyMode } from '@/lib/stores/connection';
import { PaginatedResult } from '@/lib/adapters/types';
import { cn } from '@/lib/utils';

type RowData = Record<string, unknown>;

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

// Display cell for non-editing mode
function DisplayCell({ value }: { value: unknown }) {
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

  return (
    <span className="max-w-50 truncate block text-sm">{String(value)}</span>
  );
}

export function DataViewer() {
  const activeConnection = useActiveConnection();
  const readOnlyMode = useReadOnlyMode();
  const { selectedTable, tableSchema } = useStudioStore();

  const [data, setData] = useState<RowData[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [isLoading, setIsLoading] = useState(false);
  const [sortBy, setSortBy] = useState<string | undefined>();
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Editing state - use ref for edited data to avoid re-renders
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const editedDataRef = useRef<RowData | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<RowData | null>(null);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);

  // Column resizing
  const [columnResizeMode] = useState<ColumnResizeMode>('onChange');
  const [columnSizing, setColumnSizing] = useState({});

  const totalPages = Math.ceil(totalRows / pageSize);

  const fetchData = useCallback(async () => {
    if (!activeConnection || !selectedTable) return;

    setIsLoading(true);

    try {
      const params = new URLSearchParams({
        connectionId: activeConnection.id,
        table: selectedTable,
        page: page.toString(),
        pageSize: pageSize.toString(),
      });

      if (sortBy) {
        params.set('sortBy', sortBy);
        params.set('sortOrder', sortOrder);
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
  }, [activeConnection, selectedTable, page, pageSize, sortBy, sortOrder]);

  // Fetch data when dependencies change
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset page when table changes
  useEffect(() => {
    setPage(1);
  }, [selectedTable]);

  // Keyboard shortcuts for editing
  useEffect(() => {
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
  }, [editingRow]);

  const getPrimaryKey = useCallback(
    (row: RowData): Record<string, unknown> => {
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
    [tableSchema]
  );

  const handleStartEdit = useCallback(
    (rowIndex: number, rowData: RowData) => {
      if (readOnlyMode) return;
      editedDataRef.current = { ...rowData };
      setEditingRow(rowIndex);
    },
    [readOnlyMode]
  );

  const handleCancelEdit = useCallback(() => {
    editedDataRef.current = null;
    setEditingRow(null);
  }, []);

  const handleSaveRowClick = useCallback(() => {
    if (editingRow === null) return;
    setUpdateDialogOpen(true);
  }, [editingRow]);

  const handleConfirmUpdate = async () => {
    if (editingRow === null || !activeConnection || !selectedTable) return;

    try {
      const originalRow = data[editingRow];
      const primaryKey = getPrimaryKey(originalRow);

      const response = await fetch('/api/data', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: activeConnection.id,
          table: selectedTable,
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
    if (!rowToDelete || !activeConnection || !selectedTable) return;

    try {
      const primaryKey = getPrimaryKey(rowToDelete);

      const response = await fetch(
        `/api/data?connectionId=${activeConnection.id}&table=${selectedTable}&primaryKey=${encodeURIComponent(JSON.stringify(primaryKey))}&readOnly=${readOnlyMode}`,
        { method: 'DELETE' }
      );

      const result = await response.json();

      if (result.success) {
        setDeleteDialogOpen(false);
        setRowToDelete(null);
        fetchData();
      } else {
        alert(result.error || 'Failed to delete row');
      }
    } catch (error) {
      console.error('Failed to delete row:', error);
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
    a.download = `${selectedTable}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Memoize columns to prevent unnecessary re-renders
  const columns: ColumnDef<RowData, unknown>[] = useMemo(() => {
    if (data.length === 0) return [];

    const dataColumns: ColumnDef<RowData, unknown>[] = Object.keys(data[0]).map(
      (key) => ({
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
        size: 150,
        minSize: 60,
        maxSize: 600,
      })
    );

    return dataColumns;
  }, [data, sortBy, sortOrder]);

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

  if (!selectedTable) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select a table from the sidebar to view data
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full overflow-hidden bg-background relative">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30 shrink-0">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-base">{selectedTable}</h3>
            <span className="text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {totalRows.toLocaleString()} rows
            </span>
          </div>

          <div className="flex items-center gap-2">
            {!readOnlyMode && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-2">
                    <Info className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">
                      Double-click to edit
                    </span>
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
            <Button
              variant="outline"
              size="sm"
              onClick={fetchData}
              disabled={isLoading}
              className="h-8"
            >
              <RefreshCw
                className={cn('h-3.5 w-3.5 mr-1.5', isLoading && 'animate-spin')}
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

        {/* Table Container */}
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
                      {/* Resize handle */}
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
                          style={{
                            transform: 'translateX(50%)',
                          }}
                        />
                      )}
                    </th>
                  ))}
                  {/* Extra column for delete button */}
                  {!readOnlyMode && (
                    <th className="w-10 bg-muted/80 border-b border-border/50" />
                  )}
                </tr>
              ))}
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td
                    colSpan={columns.length + (readOnlyMode ? 0 : 1)}
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
                    colSpan={columns.length + (readOnlyMode ? 0 : 1)}
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
                        if (!isEditing) {
                          handleStartEdit(row.index, row.original);
                        }
                      }}
                    >
                      {row.getVisibleCells().map((cell, cellIndex) => {
                        const columnId = cell.column.id;
                        const value = cell.getValue();
                        return (
                          <td
                            key={cell.id}
                            className={cn(
                              'px-4 py-2 border-r border-border/30 relative',
                              !readOnlyMode &&
                                !isEditing &&
                                'cursor-pointer'
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
                            ) : (
                              <DisplayCell value={value} />
                            )}
                          </td>
                        );
                      })}
                      {/* Delete button column */}
                      {!readOnlyMode && (
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
            <span className="text-muted-foreground">Rows per page:</span>
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
              <DialogTitle>Delete Row</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this row? This action cannot be
                undone.
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
        <Dialog
          open={updateDialogOpen}
          onOpenChange={(open) => {
            setUpdateDialogOpen(open);
          }}
        >
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
      </div>
    </TooltipProvider>
  );
}
