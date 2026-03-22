'use client';

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface DataTablePaginationProps {
  page: number;
  totalPages: number;
  pageSize: number;
  isRedis: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export function DataTablePagination({
  page,
  totalPages,
  pageSize,
  isRedis,
  onPageChange,
  onPageSizeChange,
}: DataTablePaginationProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/30 shrink-0">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">
          {isRedis ? 'Keys per page:' : 'Rows per page:'}
        </span>
        <Select
          value={pageSize.toString()}
          onValueChange={(v) => onPageSizeChange(parseInt(v))}
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
            onClick={() => onPageChange(1)}
            disabled={page === 1}
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange(totalPages)}
            disabled={page >= totalPages}
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
