'use client';

import {
  RefreshCw,
  Download,
  Filter,
  Flame,
  Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface DataTableToolbarProps {
  tableName: string;
  totalRows: number;
  isRedis: boolean;
  isLoading: boolean;
  readOnlyMode: boolean;
  filter?: { column: string; value: unknown };
  onRefresh: () => void;
  onExportCSV: () => void;
  onFlushAll?: () => void;
}

export function DataTableToolbar({
  tableName,
  totalRows,
  isRedis,
  isLoading,
  readOnlyMode,
  filter,
  onRefresh,
  onExportCSV,
  onFlushAll,
}: DataTableToolbarProps) {
  const canEdit = !readOnlyMode && !isRedis;

  return (
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
                <Pencil className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Click row to edit</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Click the edit button or double-click any row to edit</p>
            </TooltipContent>
          </Tooltip>
        )}

        {isRedis && !readOnlyMode && onFlushAll && (
          <Button
            variant="outline"
            size="sm"
            onClick={onFlushAll}
            className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
          >
            <Flame className="h-3.5 w-3.5 mr-1.5" />
            Flush All
          </Button>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
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
          onClick={onExportCSV}
          className="h-8"
        >
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Export
        </Button>
      </div>
    </div>
  );
}
