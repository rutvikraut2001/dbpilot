'use client';

import { useEffect, useCallback } from 'react';
import { Table2, FileText, RefreshCw, Search, ChevronRight, Database } from 'lucide-react';
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
import { useStudioStore, useFilteredTables } from '@/lib/stores/studio';
import { useActiveConnection } from '@/lib/stores/connection';
import { cn, formatBytes } from '@/lib/utils';

export function TableBrowser() {
  const activeConnection = useActiveConnection();
  const filteredTables = useFilteredTables();
  const {
    selectedTable,
    setSelectedTable,
    setTables,
    setTableSchema,
    tableFilter,
    setTableFilter,
    isLoadingTables,
    setIsLoadingTables,
    setIsLoadingSchema,
    setActiveTab,
    setError,
  } = useStudioStore();

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
    } catch (error) {
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
      } catch (error) {
        console.error('Failed to load schema:', error);
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
    setSelectedTable(tableName);
    fetchTableSchema(tableName);
    setActiveTab('data');
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
              <TooltipContent>Refresh tables</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter tables..."
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
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
              {tableFilter ? 'No matching tables' : 'No tables found'}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredTables.map((table) => (
                <TooltipProvider key={table.name}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => handleTableSelect(table.name)}
                        className={cn(
                          'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm transition-colors',
                          selectedTable === table.name
                            ? 'bg-primary text-primary-foreground'
                            : 'hover:bg-muted'
                        )}
                      >
                        {table.type === 'view' ? (
                          <FileText className="h-4 w-4 shrink-0" />
                        ) : (
                          <Table2 className="h-4 w-4 shrink-0" />
                        )}
                        <span className="truncate flex-1">{table.name}</span>
                        {selectedTable === table.name && (
                          <ChevronRight className="h-4 w-4 shrink-0" />
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
                              {table.rowCount.toLocaleString()} rows
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
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-2 border-t text-xs text-muted-foreground text-center shrink-0">
        {filteredTables.length} table{filteredTables.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
