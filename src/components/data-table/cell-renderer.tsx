'use client';

import { useState } from 'react';
import { ArrowUpRight, Copy, Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn, formatTTL, formatBytes } from '@/lib/utils';

function isIdLikeValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  // UUID pattern
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return true;
  // ObjectId (24 hex chars)
  if (/^[0-9a-f]{24}$/i.test(value)) return true;
  return false;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-0.5 rounded hover:bg-muted transition-colors opacity-0 group-hover:opacity-100 shrink-0 cursor-pointer"
      title="Copy"
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground" />
      )}
    </button>
  );
}

// Redis type badge colors
const REDIS_TYPE_COLORS: Record<string, string> = {
  string: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30',
  hash: 'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30',
  list: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30',
  set: 'bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30',
  zset: 'bg-pink-500/15 text-pink-700 dark:text-pink-400 border-pink-500/30',
  stream: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/30',
};

// Smart cell display for non-Redis databases
export function SmartCellDisplay({
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

  if (typeof value === 'boolean') {
    return (
      <Badge
        variant="outline"
        className={cn(
          'text-xs font-medium',
          value
            ? 'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30'
            : 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30'
        )}
      >
        {String(value)}
      </Badge>
    );
  }

  if (typeof value === 'object') {
    return <JsonCellDisplay value={value} />;
  }

  const strValue = String(value);

  // Long strings: truncate with tooltip and copy button
  if (strValue.length > 80) {
    return (
      <div className="flex items-center gap-1 group max-w-50">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="truncate block text-sm cursor-default">
              {strValue}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-md">
            <p className="text-xs font-mono whitespace-pre-wrap break-all max-h-60 overflow-auto">
              {strValue}
            </p>
          </TooltipContent>
        </Tooltip>
        <CopyButton value={strValue} />
      </div>
    );
  }

  // FK cell - show value with clickable arrow
  if (isForeignKey && foreignKeyRef && onFKClick) {
    return (
      <div className="flex items-center gap-1.5 max-w-50">
        <span className="truncate text-sm">{strValue}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFKClick();
          }}
          className="shrink-0 p-0.5 rounded hover:bg-primary/10 text-primary cursor-pointer transition-colors"
          title={`Open ${foreignKeyRef.table} where ${foreignKeyRef.column} = ${strValue}`}
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // For ID-like values: monospace + copy
  if (isIdLikeValue(value)) {
    return (
      <div className="flex items-center gap-1 group max-w-50">
        <span className="truncate text-sm font-mono">{strValue}</span>
        <CopyButton value={strValue} />
      </div>
    );
  }

  // Default: value with copy on hover
  return (
    <div className="flex items-center gap-1 group max-w-50">
      <span className="truncate text-sm">{strValue}</span>
      <CopyButton value={strValue} />
    </div>
  );
}

// JSON/Object cell with expand popover
function JsonCellDisplay({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);
  const jsonStr = JSON.stringify(value, null, 2);
  const truncated = JSON.stringify(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          className="text-left max-w-50 truncate block text-xs font-mono bg-muted/50 px-1.5 py-0.5 rounded hover:bg-muted transition-colors cursor-pointer"
        >
          {truncated}
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-96 p-0">
        <pre className="text-xs font-mono p-3 max-h-80 overflow-auto whitespace-pre-wrap break-all">
          {jsonStr}
        </pre>
      </PopoverContent>
    </Popover>
  );
}

// Redis-specific cell renderer
export function RedisCellDisplay({
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
