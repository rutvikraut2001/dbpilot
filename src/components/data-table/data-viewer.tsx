'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
  ColumnResizeMode,
  RowSelectionState,
} from '@tanstack/react-table';
import {
  Trash2,
  X,
  XCircle,
  Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  TooltipProvider,
} from '@/components/ui/tooltip';
import { useStudioStore } from '@/lib/stores/studio';
import { useActiveConnection, useReadOnlyMode } from '@/lib/stores/connection';
import { PaginatedResult } from '@/lib/adapters/types';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { SmartCellDisplay, RedisCellDisplay } from './cell-renderer';
import { EditRowDialog, EditSingleFieldDialog } from './edit-row-drawer';
import { DataTableToolbar } from './data-table-toolbar';
import { DataTablePagination } from './data-table-pagination';

type RowData = Record<string, unknown>;

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

  // Full row edit state
  const [editDrawerOpen, setEditDrawerOpen] = useState(false);
  const [editingRowData, setEditingRowData] = useState<RowData | null>(null);

  // Single field edit state
  const [editingField, setEditingField] = useState<string | null>(null);

  // Delete state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<RowData | null>(null);

  // Flush All state
  const [flushAllDialogOpen, setFlushAllDialogOpen] = useState(false);
  const [isFlushing, setIsFlushing] = useState(false);

  // Row selection state
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

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
        return;
      }

      setData(result.data);
      setTotalRows(result.total);
      setRowSelection({});
    } catch {
      // fetch error — silently fail, toolbar shows stale state
    } finally {
      setIsLoading(false);
    }
  }, [activeConnection, tableName, page, pageSize, sortBy, sortOrder, filter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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

  const handleFKClick = useCallback(
    (foreignKeyRef: { table: string; column: string }, value: unknown) => {
      addDataTab(foreignKeyRef.table, {
        column: foreignKeyRef.column,
        value,
      });
    },
    [addDataTab]
  );

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
        toast.success(isRedis ? 'Key deleted' : 'Row deleted');
        fetchData();
      } else {
        toast.error('Failed to delete', { description: result.error });
      }
    } catch {
      toast.error('Failed to delete');
    }
  };

  // Bulk delete state
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const selectedRowCount = Object.keys(rowSelection).length;

  const handleBulkDelete = async () => {
    if (!activeConnection || selectedRowCount === 0) return;

    setIsBulkDeleting(true);
    let successCount = 0;
    let failCount = 0;

    const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);

    for (const row of selectedRows) {
      try {
        const primaryKey = getPrimaryKey(row);
        const response = await fetch(
          `/api/data?connectionId=${activeConnection.id}&table=${tableName}&primaryKey=${encodeURIComponent(JSON.stringify(primaryKey))}&readOnly=${readOnlyMode}`,
          { method: 'DELETE' }
        );
        const result = await response.json();
        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      }
    }

    setIsBulkDeleting(false);
    setBulkDeleteDialogOpen(false);
    setRowSelection({});

    if (failCount === 0) {
      toast.success(`${successCount} ${isRedis ? 'key' : 'row'}${successCount > 1 ? 's' : ''} deleted`);
    } else {
      toast.error(`Deleted ${successCount}, failed ${failCount}`);
    }
    fetchData();
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
        toast.success('All databases flushed');
        fetchData();
      } else {
        toast.error('Failed to flush', { description: result.error });
      }
    } catch {
      toast.error('Failed to flush all databases');
    } finally {
      setIsFlushing(false);
    }
  };

  const canEdit = !readOnlyMode && !isRedis;
  const canDelete = !readOnlyMode;

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

    const cols: ColumnDef<RowData, unknown>[] = [];

    // Checkbox selection column (only when not read-only)
    if (canDelete) {
      cols.push({
        id: 'select',
        header: ({ table: t }) => (
          <input
            type="checkbox"
            checked={t.getIsAllPageRowsSelected()}
            onChange={t.getToggleAllPageRowsSelectedHandler()}
            className="h-3.5 w-3.5 rounded accent-primary cursor-pointer"
          />
        ),
        cell: ({ row: r }) => (
          <input
            type="checkbox"
            checked={r.getIsSelected()}
            onChange={r.getToggleSelectedHandler()}
            onClick={(e) => e.stopPropagation()}
            className="h-3.5 w-3.5 rounded accent-primary cursor-pointer"
          />
        ),
        size: 40,
        minSize: 40,
        maxSize: 40,
        enableResizing: false,
      });
    }

    const dataCols: ColumnDef<RowData, unknown>[] = Object.keys(data[0]).map((key) => ({
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

    cols.push(...dataCols);
    return cols;
  }, [data, sortBy, sortOrder, isRedis, canDelete]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode,
    enableRowSelection: canDelete,
    onRowSelectionChange: setRowSelection,
    onColumnSizingChange: setColumnSizing,
    state: {
      columnSizing,
      rowSelection,
    },
  });


  return (
    <div className="flex flex-col h-full overflow-hidden">
      <DataTableToolbar
        tableName={tableName}
        totalRows={totalRows}
        isRedis={isRedis}
        isLoading={isLoading}
        readOnlyMode={readOnlyMode}
        filter={filter}
        selectedCount={selectedRowCount}
        onRefresh={fetchData}
        onExportCSV={handleExportCSV}
        onFlushAll={isRedis ? () => setFlushAllDialogOpen(true) : undefined}
        onBulkDelete={canDelete && selectedRowCount > 0 ? () => setBulkDeleteDialogOpen(true) : undefined}
      />

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
                    className={cn(
                      'relative text-left px-4 py-3 border-b border-r border-border/50 bg-muted/80 first:border-l-0',
                      header.column.id === 'select' && 'sticky left-0 z-[2] px-3'
                    )}
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
                {/* Action column header */}
                {(canEdit || canDelete) && (
                  <th className="w-20 bg-muted/80 border-b border-border/50" />
                )}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td
                  colSpan={columns.length + (canEdit || canDelete ? 1 : 0)}
                  className="h-32 text-center text-muted-foreground"
                >
                  <div className="space-y-3 px-4">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex gap-4">
                        {Array.from({ length: Math.min(columns.length || 4, 6) }).map((_, j) => (
                          <div
                            key={j}
                            className="h-6 bg-muted rounded animate-pulse flex-1"
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (canEdit || canDelete ? 1 : 0)}
                  className="h-32 text-center text-muted-foreground"
                >
                  No data found
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row, rowIndex) => {
                const isSelected = row.getIsSelected();
                return (
                <tr
                  key={row.id}
                  className={cn(
                    'border-b border-border/30 transition-colors group',
                    isSelected
                      ? 'bg-primary/10 hover:bg-primary/15'
                      : rowIndex % 2 === 0
                        ? 'bg-background hover:bg-muted/30'
                        : 'bg-muted/20 hover:bg-muted/40'
                  )}
                >
                  {row.getVisibleCells().map((cell) => {
                    const columnId = cell.column.id;
                    const isSelectCol = columnId === 'select';
                    const value = cell.getValue();
                    const fkInfo = fkLookup[columnId];
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          'px-4 py-2 border-r border-border/30 relative',
                          canEdit && !isSelectCol && 'cursor-pointer',
                          isSelectCol && 'sticky left-0 z-[1] px-3 bg-inherit'
                        )}
                        style={{ width: cell.column.getSize() }}
                        onDoubleClick={() => {
                          if (canEdit && !isSelectCol) {
                            setEditingRowData(row.original);
                            setEditingField(columnId);
                          }
                        }}
                      >
                        {isSelectCol ? (
                          flexRender(cell.column.columnDef.cell, cell.getContext())
                        ) : isRedis ? (
                          <RedisCellDisplay
                            columnId={columnId}
                            value={value}
                          />
                        ) : (
                          <SmartCellDisplay
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
                  {/* Action column */}
                  {(canEdit || canDelete) && (
                    <td className="w-20 px-2 py-2">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 hover:bg-primary/10 text-muted-foreground/50 hover:text-primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingRowData(row.original);
                              setEditingField(null);
                              setEditDrawerOpen(true);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canDelete && (
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
                        )}
                      </div>
                    </td>
                  )}
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <DataTablePagination
        page={page}
        totalPages={totalPages}
        pageSize={pageSize}
        isRedis={isRedis}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />

      {/* Single field edit (double-click) */}
      {editingRowData && activeConnection && editingField && (
        <EditSingleFieldDialog
          open={!!editingField}
          onOpenChange={(open) => {
            if (!open) {
              setEditingField(null);
              setEditingRowData(null);
            }
          }}
          tableName={tableName}
          row={editingRowData}
          columnName={editingField}
          columnType={tableSchema.find((c) => c.name === editingField)?.type || 'text'}
          schema={tableSchema}
          connectionId={activeConnection.id}
          readOnly={readOnlyMode}
          onSaved={fetchData}
        />
      )}

      {/* Full row edit (pencil button) */}
      {editingRowData && activeConnection && !editingField && editDrawerOpen && (
        <EditRowDialog
          open={editDrawerOpen}
          onOpenChange={(open) => {
            setEditDrawerOpen(open);
            if (!open) setEditingRowData(null);
          }}
          tableName={tableName}
          row={editingRowData}
          schema={tableSchema}
          connectionId={activeConnection.id}
          readOnly={readOnlyMode}
          onSaved={fetchData}
        />
      )}

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

      {/* Bulk Delete Confirmation Dialog */}
      <Dialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selectedRowCount} {isRedis ? 'key' : 'row'}{selectedRowCount > 1 ? 's' : ''}</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{selectedRowCount}</strong> selected {isRedis ? 'key' : 'row'}{selectedRowCount > 1 ? 's' : ''}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBulkDeleteDialogOpen(false)}
              disabled={isBulkDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={isBulkDeleting}
            >
              {isBulkDeleting ? `Deleting...` : `Delete ${selectedRowCount} ${isRedis ? 'key' : 'row'}${selectedRowCount > 1 ? 's' : ''}`}
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
    setSelectedTable,
    dataTabs,
    activeDataTabId,
    setActiveDataTab,
    removeDataTab,
    clearAllDataTabs,
  } = useStudioStore();

  const isRedis = activeConnection?.type === 'redis';

  // Determine what to show: active data tab or selected table
  const activeTab = dataTabs.find((t) => t.id === activeDataTabId);

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full overflow-hidden bg-background relative">
        {/* Data tabs bar - show when there are any tabs */}
        {dataTabs.length > 0 && (
          <div className="flex items-center border-b bg-muted/20 shrink-0">
            <div className="flex items-center overflow-x-auto flex-1 min-w-0">
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
                    onClick={() => {
                      setActiveDataTab(tab.id);
                      if (!tab.filter) {
                        setSelectedTable(tab.tableName);
                      }
                    }}
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
            {dataTabs.length >= 2 && (
              <button
                onClick={clearAllDataTabs}
                className="px-2 py-2 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                title="Close all tabs"
              >
                <XCircle className="h-4 w-4" />
              </button>
            )}
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
