'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
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
  AlertCircle,
  RefreshCw,
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
import { PaginatedResult, ColumnInfo } from '@/lib/adapters/types';
import { cn } from '@/lib/utils';
import { rowsToCsv, rowsToJson, exportFilename } from '@/lib/utils/export';
import { apiFetch, errorMessage } from '@/lib/utils/api-client';
import { toast } from 'sonner';
import { SmartCellDisplay, RedisCellDisplay } from './cell-renderer';
import { EditRowDialog, EditSingleFieldDialog } from './edit-row-drawer';
import { DataTableToolbar } from './data-table-toolbar';
import { DataTablePagination } from './data-table-pagination';

type RowData = Record<string, unknown>;

const SKELETON_ROW_KEYS = ['sk-row-0', 'sk-row-1', 'sk-row-2', 'sk-row-3', 'sk-row-4'] as const;
const SKELETON_CELL_KEYS = ['sk-cell-0', 'sk-cell-1', 'sk-cell-2', 'sk-cell-3', 'sk-cell-4', 'sk-cell-5'] as const;

const REDIS_COLUMN_SIZES: Record<string, number> = {
  key: 280,
  value: 450,
  type: 100,
  ttl: 130,
};

function getColumnSize(isRedis: boolean, key: string): number {
  if (!isRedis) return 150;
  return REDIS_COLUMN_SIZES[key] ?? 120;
}

function getRowBgClass(isSelected: boolean, rowIndex: number): string {
  if (isSelected) return 'bg-primary/10 hover:bg-primary/15';
  if (rowIndex % 2 === 0) return 'bg-background hover:bg-muted/30';
  return 'bg-muted/20 hover:bg-muted/40';
}

function pluralize(count: number, singular: string): string {
  return count > 1 ? `${singular}s` : singular;
}

/**
 * Sort state for a column header, exposed to assistive tech. The visible arrow
 * is aria-hidden, so this is the only place the sort direction is announced.
 */
function getAriaSort(
  columnId: string,
  sortBy: string | undefined,
  sortOrder: 'asc' | 'desc'
): 'ascending' | 'descending' | undefined {
  if (columnId === 'select' || sortBy !== columnId) return undefined;
  return sortOrder === 'asc' ? 'ascending' : 'descending';
}

function displayRowKey(key: unknown): string {
  if (key === null || key === undefined) return '';
  if (typeof key === 'object') return JSON.stringify(key);
  if (typeof key === 'string') return key;
  if (typeof key === 'number' || typeof key === 'boolean' || typeof key === 'bigint') {
    return String(key);
  }
  return '';
}

interface CellContentProps {
  isSelectCol: boolean;
  isRedis: boolean;
  cell: import('@tanstack/react-table').Cell<RowData, unknown>;
  columnId: string;
  value: unknown;
  fkRef: { table: string; column: string } | undefined;
  isForeignKey: boolean | undefined;
  onFKClick: (() => void) | undefined;
}

interface DataCellProps {
  cell: import('@tanstack/react-table').Cell<RowData, unknown>;
  rowOriginal: RowData;
  isRedis: boolean;
  canEdit: boolean;
  fkLookup: Record<string, { isForeignKey: boolean; foreignKeyRef?: { table: string; column: string } }>;
  onEditField: (row: RowData, field: string) => void;
  onFKClick: (ref: { table: string; column: string }, value: unknown) => void;
}

function DataCell({
  cell,
  rowOriginal,
  isRedis,
  canEdit,
  fkLookup,
  onEditField,
  onFKClick,
}: Readonly<DataCellProps>) {
  const columnId = cell.column.id;
  const isSelectCol = columnId === 'select';
  const value = cell.getValue();
  const fkInfo = fkLookup[columnId];
  const fkRef = fkInfo?.foreignKeyRef;
  const handleDoubleClick = () => {
    if (canEdit && !isSelectCol) onEditField(rowOriginal, columnId);
  };
  const handleFKClick = fkRef ? () => onFKClick(fkRef, value) : undefined;

  return (
    <td
      className={cn(
        'px-4 py-2 border-r border-border/30 relative',
        canEdit && !isSelectCol && 'cursor-pointer',
        isSelectCol && 'sticky left-0 z-1 px-3 bg-inherit'
      )}
      style={{ width: cell.column.getSize() }}
      onDoubleClick={handleDoubleClick}
    >
      <CellContent
        isSelectCol={isSelectCol}
        isRedis={isRedis}
        cell={cell}
        columnId={columnId}
        value={value}
        fkRef={fkRef}
        isForeignKey={fkInfo?.isForeignKey}
        onFKClick={handleFKClick}
      />
    </td>
  );
}

interface DataRowProps {
  row: import('@tanstack/react-table').Row<RowData>;
  rowIndex: number;
  isRedis: boolean;
  canEdit: boolean;
  canDelete: boolean;
  fkLookup: Record<string, { isForeignKey: boolean; foreignKeyRef?: { table: string; column: string } }>;
  onEditField: (row: RowData, field: string) => void;
  onEditRow: (row: RowData) => void;
  onDeleteRow: (row: RowData) => void;
  onFKClick: (ref: { table: string; column: string }, value: unknown) => void;
  // Lets the virtualizer measure this row's real height; cell content varies,
  // so heights are measured rather than assumed.
  measureRef?: (node: HTMLTableRowElement | null) => void;
}

function DataRow({
  row,
  rowIndex,
  isRedis,
  canEdit,
  canDelete,
  fkLookup,
  onEditField,
  onEditRow,
  onDeleteRow,
  onFKClick,
  measureRef,
}: Readonly<DataRowProps>) {
  const isSelected = row.getIsSelected();
  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEditRow(row.original);
  };
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDeleteRow(row.original);
  };
  return (
    <tr
      ref={measureRef}
      data-index={rowIndex}
      className={cn('border-b border-border/30 transition-colors group', getRowBgClass(isSelected, rowIndex))}
    >
      {row.getVisibleCells().map((cell) => (
        <DataCell
          key={cell.id}
          cell={cell}
          rowOriginal={row.original}
          isRedis={isRedis}
          canEdit={canEdit}
          fkLookup={fkLookup}
          onEditField={onEditField}
          onFKClick={onFKClick}
        />
      ))}
      {(canEdit || canDelete) && (
        <td className="w-20 px-2 py-2">
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {canEdit && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-primary/10 text-muted-foreground/50 hover:text-primary"
                onClick={handleEdit}
                aria-label="Edit row"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-destructive/10 text-muted-foreground/50 hover:text-destructive"
                onClick={handleDelete}
                aria-label="Delete row"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}

function CellContent({
  isSelectCol,
  isRedis,
  cell,
  columnId,
  value,
  fkRef,
  isForeignKey,
  onFKClick,
}: Readonly<CellContentProps>) {
  if (isSelectCol) {
    return flexRender(cell.column.columnDef.cell, cell.getContext());
  }
  if (isRedis) {
    return <RedisCellDisplay columnId={columnId} value={value} />;
  }
  return (
    <SmartCellDisplay
      value={value}
      isForeignKey={isForeignKey}
      foreignKeyRef={fkRef}
      onFKClick={onFKClick}
    />
  );
}

function SelectAllHeader({ table: t }: Readonly<{ table: { getIsAllPageRowsSelected: () => boolean; getToggleAllPageRowsSelectedHandler: () => (e: unknown) => void } }>) {
  return (
    <input
      type="checkbox"
      checked={t.getIsAllPageRowsSelected()}
      onChange={t.getToggleAllPageRowsSelectedHandler()}
      className="h-3.5 w-3.5 rounded accent-primary cursor-pointer"
      aria-label="Select all rows on page"
    />
  );
}

function SelectRowCell({ row: r }: Readonly<{ row: { getIsSelected: () => boolean; getToggleSelectedHandler: () => (e: unknown) => void } }>) {
  return (
    <input
      type="checkbox"
      checked={r.getIsSelected()}
      onChange={r.getToggleSelectedHandler()}
      onClick={(e) => e.stopPropagation()}
      className="h-3.5 w-3.5 rounded accent-primary cursor-pointer"
      aria-label="Select row"
    />
  );
}

function SortableHeader({
  columnKey,
  sortBy,
  sortOrder,
  onSort,
}: Readonly<{
  columnKey: string;
  sortBy: string | undefined;
  sortOrder: 'asc' | 'desc';
  onSort: () => void;
}>) {
  return (
    <button
      type="button"
      onClick={onSort}
      className="flex items-center gap-1.5 font-semibold text-sm hover:text-primary transition-colors text-left w-full"
    >
      <span className="truncate">{columnKey}</span>
      {sortBy === columnKey && (
        // Decorative: the sort state is exposed to assistive tech via aria-sort
        // on the enclosing <th>. Leaving the glyph in the accessible name would
        // rename the button from "id" to "id ↑" as soon as it is sorted.
        <span aria-hidden="true" className="text-primary shrink-0">
          {sortOrder === 'asc' ? '↑' : '↓'}
        </span>
      )}
    </button>
  );
}

interface TableMeta {
  sortBy: string | undefined;
  sortOrder: 'asc' | 'desc';
  onSort: (key: string) => void;
}

function ColumnHeader({ column, table }: import('@tanstack/react-table').HeaderContext<RowData, unknown>) {
  const meta = table.options.meta as TableMeta;
  return (
    <SortableHeader
      columnKey={column.id}
      sortBy={meta.sortBy}
      sortOrder={meta.sortOrder}
      onSort={() => meta.onSort(column.id)}
    />
  );
}

// Inner table component that renders data for a specific table/filter
function DataTable({
  tableName,
  filter,
}: Readonly<{
  tableName: string;
  filter?: { column: string; value: unknown };
}>) {
  const activeConnection = useActiveConnection();
  const readOnlyMode = useReadOnlyMode();
  const tableSchema = useStudioStore((s) => s.tableSchema);
  const addDataTab = useStudioStore((s) => s.addDataTab);
  const setTableSchema = useStudioStore((s) => s.setTableSchema);
  const setIsLoadingSchema = useStudioStore((s) => s.setIsLoadingSchema);

  const isRedis = activeConnection?.type === 'redis';

  const [data, setData] = useState<RowData[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
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

      const result = await apiFetch<PaginatedResult>(`/api/data?${params}`);

      setData(result.data);
      setTotalRows(result.total);
      setRowSelection({});
      setLoadError(null);
    } catch (error) {
      // Previously swallowed: a failed load left the previous rows on screen, or
      // an empty grid reading "No data found", with no indication anything had
      // gone wrong. Surface it and let the user retry.
      setLoadError(errorMessage(error));
      setData([]);
      setTotalRows(0);
    } finally {
      setIsLoading(false);
    }
  }, [activeConnection, tableName, page, pageSize, sortBy, sortOrder, filter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset edit/delete dialogs when switching tables so stale data
  // from a previous table can't bleed into the new table's UI.
  useEffect(() => {
    setEditDrawerOpen(false);
    setEditingRowData(null);
    setEditingField(null);
    setDeleteDialogOpen(false);
    setRowToDelete(null);
  }, [tableName, activeConnection?.id]);

  // Refetch schema whenever the active table changes. The sidebar only fetches
  // when a sidebar item is clicked, so switching between already-open tabs
  // would otherwise leave tableSchema stale (showing the previous table's
  // columns/PKs in the edit dialog).
  useEffect(() => {
    const connectionId = activeConnection?.id;
    if (!connectionId || !tableName) return;
    let cancelled = false;
    setTableSchema([]);
    setIsLoadingSchema(true);
    apiFetch<{ schema: ColumnInfo[] }>(
      `/api/schema?connectionId=${connectionId}&table=${encodeURIComponent(tableName)}`
    )
      .then((data) => {
        if (!cancelled) setTableSchema(data.schema);
      })
      .catch((error) => {
        // Without the schema there are no primary keys, so editing and deleting
        // silently stop working. Say so rather than leaving a dead UI.
        if (cancelled) return;
        toast.error('Could not load table structure', {
          description: errorMessage(error),
        });
      })
      .finally(() => { if (!cancelled) setIsLoadingSchema(false); });
    return () => { cancelled = true; };
  }, [tableName, activeConnection?.id, setTableSchema, setIsLoadingSchema]);

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

  // Identity of the row being edited, used to force the edit dialogs to remount
  // when the target row changes. Derived from the primary key and recomputed
  // only when the row does — the previous key stringified the entire row object
  // on every render of the table.
  const editingRowKey = useMemo(
    () => (editingRowData ? JSON.stringify(getPrimaryKey(editingRowData)) : ''),
    [editingRowData, getPrimaryKey]
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

  const handleEditField = useCallback((rowData: RowData, field: string) => {
    setEditingRowData(rowData);
    setEditingField(field);
  }, []);

  const handleEditRow = useCallback((rowData: RowData) => {
    setEditingRowData(rowData);
    setEditingField(null);
    setEditDrawerOpen(true);
  }, []);

  const handleDeleteRowRequest = useCallback((rowData: RowData) => {
    setRowToDelete(rowData);
    setDeleteDialogOpen(true);
  }, []);

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

    const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);
    const primaryKeys = selectedRows.map(getPrimaryKey);

    // One request for the whole selection. This used to be a serial loop of one
    // DELETE per row, so deleting 100 rows meant 100 sequential round trips.
    try {
      const response = await fetch('/api/data/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: activeConnection.id,
          table: tableName,
          primaryKeys,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        toast.error('Failed to delete', { description: result.error });
      } else if (result.failed === 0) {
        toast.success(
          `${result.deleted} ${pluralize(result.deleted, isRedis ? 'key' : 'row')} deleted`
        );
      } else {
        toast.error(`Deleted ${result.deleted}, failed ${result.failed}`, {
          description: result.error,
        });
      }
    } catch {
      toast.error('Failed to delete');
    } finally {
      setIsBulkDeleting(false);
      setBulkDeleteDialogOpen(false);
      setRowSelection({});
      fetchData();
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

  const handleExport = (scope: 'page' | 'full', format: 'csv' | 'json') => {
    // Full table: stream all rows from the server via the export endpoint.
    if (scope === 'full') {
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
      toast.success(`Exporting full table as ${format.toUpperCase()}…`);
      return;
    }

    // Current page: serialize the in-memory rows client-side.
    if (data.length === 0) {
      toast.info('No rows to export');
      return;
    }
    const content = format === 'csv' ? rowsToCsv(data) : rowsToJson(data);
    const blob = new Blob([content], {
      type: format === 'csv' ? 'text/csv' : 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFilename(tableName, format);
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSortColumn = useCallback((key: string) => {
    if (sortBy === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortOrder('asc');
    }
  }, [sortBy]);

  // Derived from the column *names*, not the row data: previously any refetch
  // produced new ColumnDef objects and invalidated the table's column model
  // even when the shape had not changed.
  const columnKeys = data.length > 0 ? Object.keys(data[0]).join('\u0000') : '';

  const columns: ColumnDef<RowData, unknown>[] = useMemo(() => {
    if (columnKeys === '') return [];
    const keys = columnKeys.split('\u0000');

    const cols: ColumnDef<RowData, unknown>[] = [];

    if (canDelete) {
      cols.push({
        id: 'select',
        header: SelectAllHeader,
        cell: SelectRowCell,
        size: 40,
        minSize: 40,
        maxSize: 40,
        enableResizing: false,
      });
    }

    const dataCols: ColumnDef<RowData, unknown>[] = keys.map((key) => ({
      accessorKey: key,
      header: ColumnHeader,
      size: getColumnSize(isRedis, key),
      minSize: 60,
      maxSize: isRedis && key === 'value' ? 1000 : 600,
    }));

    cols.push(...dataCols);
    return cols;
  }, [columnKeys, isRedis, canDelete]);

  // Virtualized rows. The API now serves up to 500 rows per page, and cells can
  // be expensive (FK buttons, JSON badges, copy controls), so only the visible
  // window is mounted. Heights are measured rather than assumed because cell
  // content varies in height.
  const scrollRef = useRef<HTMLDivElement>(null);

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
    meta: {
      sortBy,
      sortOrder,
      onSort: handleSortColumn,
    } satisfies TableMeta,
  });

  const tableRows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 41,
    overscan: 10,
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
        onExport={handleExport}
        onFlushAll={isRedis ? () => setFlushAllDialogOpen(true) : undefined}
        onBulkDelete={canDelete && selectedRowCount > 0 ? () => setBulkDeleteDialogOpen(true) : undefined}
      />

      {/* Table */}
      <div ref={scrollRef} className="flex-1 overflow-auto min-h-0">
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
                    aria-sort={getAriaSort(header.column.id, sortBy, sortOrder)}
                    className={cn(
                      'relative text-left px-4 py-3 border-b border-r border-border/50 bg-muted/80 first:border-l-0',
                      header.column.id === 'select' && 'sticky left-0 z-2 px-3'
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
                      <button
                        type="button"
                        aria-label="Resize column"
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onDoubleClick={() => header.column.resetSize()}
                        className={cn(
                          'absolute right-0 top-0 w-1 h-full cursor-col-resize select-none touch-none p-0 border-0',
                          'hover:bg-primary/60 active:bg-primary',
                          'transition-colors duration-150',
                          header.column.getIsResizing() ? 'bg-primary' : 'bg-border/50 hover:bg-primary/40'
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
            {(() => {
              const colSpan = columns.length + (canEdit || canDelete ? 1 : 0);
              if (isLoading) {
                return (
                  <tr>
                    <td colSpan={colSpan} className="h-32 text-center text-muted-foreground">
                      <div className="space-y-3 px-4">
                        {SKELETON_ROW_KEYS.map((rowKey) => {
                          const cellCount = Math.min(columns.length || 4, 6);
                          return (
                            <div key={rowKey} className="flex gap-4">
                              {SKELETON_CELL_KEYS.slice(0, cellCount).map((cellKey) => (
                                <div
                                  key={`${rowKey}-${cellKey}`}
                                  className="h-6 bg-muted rounded animate-pulse flex-1"
                                />
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              }
              // An empty table and a failed request are different things and
              // used to render identically as "No data found".
              if (loadError) {
                return (
                  <tr>
                    <td colSpan={colSpan} className="h-32 px-4 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <div className="flex items-center gap-2 text-destructive">
                          <AlertCircle className="h-4 w-4 shrink-0" />
                          <span className="text-sm font-medium">
                            Could not load rows
                          </span>
                        </div>
                        <p className="max-w-md text-xs text-muted-foreground break-words">
                          {loadError}
                        </p>
                        <Button variant="outline" size="sm" onClick={fetchData}>
                          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                          Retry
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              }

              if (tableRows.length === 0) {
                return (
                  <tr>
                    <td colSpan={colSpan} className="h-32 text-center text-muted-foreground">
                      {filter
                        ? `No rows where ${filter.column} = ${displayRowKey(filter.value)}`
                        : 'This table is empty'}
                    </td>
                  </tr>
                );
              }

              const virtualRows = rowVirtualizer.getVirtualItems();
              const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
              const paddingBottom =
                virtualRows.length > 0
                  ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
                  : 0;

              return (
                <>
                  {paddingTop > 0 && (
                    <tr aria-hidden="true" style={{ height: paddingTop }}>
                      <td colSpan={colSpan} />
                    </tr>
                  )}
                  {virtualRows.map((virtualRow) => {
                    const row = tableRows[virtualRow.index];
                    return (
                      <DataRow
                        key={row.id}
                        row={row}
                        rowIndex={virtualRow.index}
                        isRedis={isRedis}
                        canEdit={canEdit}
                        canDelete={canDelete}
                        fkLookup={fkLookup}
                        onEditField={handleEditField}
                        onEditRow={handleEditRow}
                        onDeleteRow={handleDeleteRowRequest}
                        onFKClick={handleFKClick}
                        measureRef={rowVirtualizer.measureElement}
                      />
                    );
                  })}
                  {paddingBottom > 0 && (
                    <tr aria-hidden="true" style={{ height: paddingBottom }}>
                      <td colSpan={colSpan} />
                    </tr>
                  )}
                </>
              );
            })()}
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
          key={`single-${tableName}-${editingField}-${editingRowKey}`}
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
          key={`row-${tableName}-${editingRowKey}`}
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
                <>Are you sure you want to delete the key <strong>{displayRowKey(rowToDelete?.key)}</strong>? This action cannot be undone.</>
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
      {(() => {
        const bulkSingular = isRedis ? 'key' : 'row';
        const bulkNoun = pluralize(selectedRowCount, bulkSingular);
        return (
      <Dialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selectedRowCount} {bulkNoun}</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{selectedRowCount}</strong> selected {bulkNoun}? This action cannot be undone.
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
              {isBulkDeleting ? `Deleting...` : `Delete ${selectedRowCount} ${bulkNoun}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        );
      })()}
    </div>
  );
}

// Main DataViewer with tab management
export function DataViewer() {
  const activeConnection = useActiveConnection();
  const setSelectedTable = useStudioStore((s) => s.setSelectedTable);
  const dataTabs = useStudioStore((s) => s.dataTabs);
  const activeDataTabId = useStudioStore((s) => s.activeDataTabId);
  const setActiveDataTab = useStudioStore((s) => s.setActiveDataTab);
  const removeDataTab = useStudioStore((s) => s.removeDataTab);
  const clearAllDataTabs = useStudioStore((s) => s.clearAllDataTabs);

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
                    type="button"
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
                        {tab.filter.column}={displayRowKey(tab.filter.value)}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeDataTab(tab.id);
                    }}
                    className="p-1 mr-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={`Close tab ${tab.tableName}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
            {dataTabs.length >= 2 && (
              <button
                type="button"
                onClick={clearAllDataTabs}
                className="px-2 py-2 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                title="Close all tabs"
                aria-label="Close all tabs"
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
