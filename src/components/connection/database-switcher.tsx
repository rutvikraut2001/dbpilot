'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  Check,
  Loader2,
  Plus,
  Database,
  Zap,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useConnectionStore, useConnections } from '@/lib/stores/connection';
import { useStudioStore } from '@/lib/stores/studio';
import { ConnectionConfig } from '@/lib/adapters/types';

const DB_CONFIG: Record<
  string,
  {
    label: string;
    color: string;
    bgColor: string;
    borderColor: string;
    dotColor: string;
    badgeBg: string;
  }
> = {
  postgresql: {
    label: 'PostgreSQL',
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
    dotColor: 'bg-blue-500',
    badgeBg: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  },
  mongodb: {
    label: 'MongoDB',
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/30',
    dotColor: 'bg-green-500',
    badgeBg: 'bg-green-500/10 text-green-600 dark:text-green-400',
  },
  clickhouse: {
    label: 'ClickHouse',
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    dotColor: 'bg-amber-500',
    badgeBg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  redis: {
    label: 'Redis',
    color: 'text-red-500',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/30',
    dotColor: 'bg-red-500',
    badgeBg: 'bg-red-500/10 text-red-600 dark:text-red-400',
  },
};

function DbIcon({ type, className }: { type: string; className?: string }) {
  if (type === 'redis') {
    return <Zap className={className} />;
  }
  return <Database className={className} />;
}

interface DatabaseSwitcherProps {
  activeConnection: ConnectionConfig;
}

export function DatabaseSwitcher({ activeConnection }: DatabaseSwitcherProps) {
  const router = useRouter();
  const connections = useConnections();
  const { setActiveConnection } = useConnectionStore();
  const reset = useStudioStore((s) => s.reset);

  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSwitching = switchingTo !== null;
  const activeConfig = DB_CONFIG[activeConnection.type] ?? DB_CONFIG.postgresql;

  const handleSwitch = async (connection: ConnectionConfig) => {
    if (connection.id === activeConnection.id) {
      setOpen(false);
      return;
    }

    setSwitchingTo(connection.id);
    setError(null);
    setOpen(false);

    // Clear stale data immediately so the user sees a loading state, not old data
    reset();

    try {
      // Check if a healthy server-side adapter already exists for this connection
      const healthRes = await fetch(`/api/connect?connectionId=${connection.id}`);
      const healthData = await healthRes.json().catch(() => ({ exists: false, healthy: false }));

      if (!healthData.exists || !healthData.healthy) {
        // Need to (re)establish the server-side adapter.
        // Send `connectionId` (not `id`) — that's the field the API route reads to cache the adapter.
        const res = await fetch('/api/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: connection.type,
            connectionString: connection.connectionString,
            connectionId: connection.id,
          }),
        });

        // The connect route returns HTTP 200 even when the DB test fails — check the body too
        const connectData = await res.json().catch(() => ({}));
        if (!res.ok || !connectData.success) {
          throw new Error(connectData.message || connectData.error || 'Failed to connect');
        }
      }

      // Adapter is ready — activate the new connection (triggers TableBrowser to reload)
      setActiveConnection(connection.id);
    } catch (err) {
      console.error('Failed to switch connection:', err);
      setError(err instanceof Error ? err.message : 'Failed to switch');
    } finally {
      setSwitchingTo(null);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all duration-200',
            'hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:opacity-60 group',
            activeConfig.borderColor,
            error ? 'border-destructive' : '',
          )}
          disabled={isSwitching}
        >
          {isSwitching ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground shrink-0" />
          ) : (
            <span
              className={cn(
                'inline-block h-2 w-2 rounded-full shrink-0',
                activeConfig.dotColor,
              )}
            />
          )}

          <span className="font-medium text-sm max-w-[140px] truncate">
            {activeConnection.name}
          </span>

          <Badge
            variant="outline"
            className={cn(
              'text-[10px] px-1.5 py-0 h-4 border font-medium',
              activeConfig.badgeBg,
              activeConfig.borderColor,
            )}
          >
            {activeConfig.label}
          </Badge>

          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 shrink-0',
              open ? 'rotate-180' : 'rotate-0',
              'group-hover:text-foreground',
            )}
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="w-72 p-1.5 shadow-lg"
      >
        {/* Header */}
        <div className="px-2 py-1.5 mb-0.5">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
            Connections
          </p>
        </div>

        {/* Connection list */}
        <div className="space-y-0.5">
          {connections.map((conn) => {
            const config = DB_CONFIG[conn.type] ?? DB_CONFIG.postgresql;
            const isActive = conn.id === activeConnection.id;
            const isSwitchingToThis = switchingTo === conn.id;

            return (
              <button
                key={conn.id}
                onClick={() => handleSwitch(conn)}
                disabled={isSwitching}
                className={cn(
                  'w-full flex items-center gap-3 px-2 py-2.5 rounded-md text-left transition-all duration-150',
                  'hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive && 'bg-muted/50',
                  isSwitching && !isSwitchingToThis && 'opacity-40 pointer-events-none',
                )}
              >
                {/* DB icon */}
                <div
                  className={cn(
                    'h-9 w-9 rounded-lg flex items-center justify-center shrink-0 border',
                    config.bgColor,
                    config.borderColor,
                  )}
                >
                  <DbIcon type={conn.type} className={cn('h-4 w-4', config.color)} />
                </div>

                {/* Connection info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-sm font-medium truncate leading-tight">
                      {conn.name}
                    </span>
                    {isActive && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 shrink-0">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                        LIVE
                      </span>
                    )}
                  </div>
                  <span className={cn('text-[11px] font-medium', config.color)}>
                    {config.label}
                  </span>
                </div>

                {/* Status icon */}
                {isSwitchingToThis ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                ) : isActive ? (
                  <Check className="h-4 w-4 text-green-500 shrink-0" />
                ) : (
                  <div className="h-4 w-4 shrink-0" /> /* spacer */
                )}
              </button>
            );
          })}

          {connections.length === 0 && (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">
              No saved connections
            </div>
          )}
        </div>

        <DropdownMenuSeparator className="my-1.5" />

        {/* New connection */}
        <button
          onClick={() => {
            setOpen(false);
            router.push('/');
          }}
          className={cn(
            'w-full flex items-center gap-3 px-2 py-2 rounded-md text-left transition-all duration-150',
            'hover:bg-muted/70 text-muted-foreground hover:text-foreground',
          )}
        >
          <div className="h-8 w-8 rounded-lg border border-dashed border-muted-foreground/30 flex items-center justify-center shrink-0">
            <Plus className="h-3.5 w-3.5" />
          </div>
          <span className="text-sm">Add Connection</span>
        </button>

        {/* Error state */}
        {error && (
          <div className="mt-1.5 px-2 py-2 rounded-md bg-destructive/10 border border-destructive/20">
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
