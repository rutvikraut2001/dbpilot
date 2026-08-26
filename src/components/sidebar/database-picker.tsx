'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  ChevronsUpDown,
  Database,
  Loader2,
  Plus,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  useActiveConnection,
  useConnectionStore,
  useReadOnlyMode,
} from '@/lib/stores/connection';
import { apiFetch, errorMessage } from '@/lib/utils/api-client';
import { formatBytes } from '@/lib/index-health';
import type { DatabaseInfo } from '@/lib/adapters/types';
import { withDatabase } from '@/lib/database-name';
import { CreateDatabaseDialog } from './create-database-dialog';

interface DatabasesResponse {
  databases: DatabaseInfo[];
  current: string | null;
  canCreate: boolean;
}

interface DatabasePickerProps {
  /** Called after the connection has been pointed at a different database. */
  onDatabaseChanged: (name: string) => void;
  /**
   * Called whenever the current database is (re)read, including with null when
   * none is selected. Lets the table list say *why* it is empty rather than
   * claiming the database has no tables.
   */
  onCurrentChanged?: (current: string | null) => void;
}

/**
 * Choose which database on the server this connection is reading from.
 *
 * Exists because a connection string that names no database is legitimate and
 * common — every driver here quietly picks a default in that case (PostgreSQL
 * one named after the user, MongoDB `test`), so without this the user connects
 * successfully and sees an empty table list belonging to a database they never
 * chose.
 */
export function DatabasePicker({
  onDatabaseChanged,
  onCurrentChanged,
}: Readonly<DatabasePickerProps>) {
  const activeConnection = useActiveConnection();
  const readOnlyMode = useReadOnlyMode();
  const updateConnection = useConnectionStore((state) => state.updateConnection);

  const [open, setOpen] = useState(false);
  const [data, setData] = useState<DatabasesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSystem, setShowSystem] = useState(false);

  const connectionId = activeConnection?.id;
  const isRedis = activeConnection?.type === 'redis';

  const load = useCallback(async () => {
    if (!connectionId) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await apiFetch<DatabasesResponse>(
        `/api/databases?connectionId=${connectionId}`
      );
      setData(response);
      onCurrentChanged?.(response.current);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, onCurrentChanged]);

  // Fetched once on mount so the trigger can show the current database, then
  // refreshed whenever the list is opened — a database may have appeared since.
  useEffect(() => {
    void load();
  }, [load]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setFilter('');
      void load();
    }
  };

  const switchTo = async (name: string) => {
    if (!connectionId || name === data?.current) {
      setOpen(false);
      return;
    }

    setSwitchingTo(name);
    try {
      await apiFetch('/api/databases', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, name }),
      });

      // Remember the choice on the saved connection, so reloading the page
      // reconnects to the database the user picked rather than dropping back to
      // whatever the original string named — which is usually nothing.
      try {
        updateConnection(activeConnection.id, {
          connectionString: withDatabase(activeConnection.connectionString, name),
        });
      } catch {
        // A connection string the URL parser cannot rewrite (a Redis keyspace
        // number, an exotic DSN) still switches for this session; only the
        // remembering is skipped.
      }

      setOpen(false);
      onDatabaseChanged(name);
      await load();
      toast.success(`Switched to ${name}`);
    } catch (err) {
      toast.error('Could not switch database', {
        description: errorMessage(err),
      });
    } finally {
      setSwitchingTo(null);
    }
  };

  if (!activeConnection) return null;

  const current = data?.current ?? null;
  const canCreate = Boolean(data?.canCreate) && !readOnlyMode;

  const visible = (data?.databases ?? [])
    .filter((database) => showSystem || !database.isSystem || database.isCurrent)
    .filter((database) =>
      database.name.toLowerCase().includes(filter.trim().toLowerCase())
    );

  const systemCount = (data?.databases ?? []).filter((d) => d.isSystem).length;

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'h-7 w-full justify-between gap-1.5 px-2 text-xs font-normal',
              // Nothing selected is a state worth drawing attention to: it is
              // why the table list is empty.
              !current && 'border-amber-500/40 text-amber-600 dark:text-amber-400'
            )}
            aria-label="Select database"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <Database className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate font-mono">
                {current ?? 'Select a database'}
              </span>
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent
          className="flex w-72 flex-col overflow-hidden p-0"
          align="start"
          // Never taller than the space actually below the trigger, so a long
          // list on a short window scrolls instead of running off-screen.
          style={{
            maxHeight:
              'min(24rem, var(--radix-popover-content-available-height, 24rem))',
          }}
        >
          <div className="shrink-0 border-b p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={isRedis ? 'Filter by number…' : 'Filter databases…'}
                className="h-7 pl-8 text-xs"
              />
            </div>
          </div>

          {error && (
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-destructive/20 bg-destructive/10 px-3 py-2">
              <span className="text-xs text-destructive">{error}</span>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => void load()}
              >
                Retry
              </Button>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
              {isLoading && !data && (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading databases…
                </div>
              )}

              {data && visible.length === 0 && !isLoading && (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  {filter ? 'No database matches that filter.' : 'No databases found.'}
                </p>
              )}

              {visible.map((database) => (
                <button
                  key={database.name}
                  type="button"
                  disabled={switchingTo !== null}
                  onClick={() => void switchTo(database.name)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-60',
                    database.isCurrent && 'bg-muted'
                  )}
                >
                  <span className="w-3.5 shrink-0">
                    {switchingTo === database.name ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      database.isCurrent && <Check className="h-3.5 w-3.5" />
                    )}
                  </span>

                  <span className="min-w-0 flex-1 truncate font-mono">
                    {isRedis ? `db${database.name}` : database.name}
                  </span>

                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {/* Redis reports keys where the SQL engines report bytes. */}
                    {database.objectCount !== undefined
                      ? `${database.objectCount.toLocaleString()} keys`
                      : database.sizeBytes
                        ? formatBytes(database.sizeBytes)
                        : null}
                  </span>
                </button>
              ))}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-2 border-t p-1">
            {systemCount > 0 ? (
              <button
                type="button"
                className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => setShowSystem((previous) => !previous)}
              >
                {showSystem ? 'Hide' : 'Show'} system ({systemCount})
              </button>
            ) : (
              <span />
            )}

            {canCreate && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={() => {
                  setOpen(false);
                  setShowCreate(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                New database
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {showCreate && (
        <CreateDatabaseDialog
          databaseType={activeConnection.type}
          existingNames={(data?.databases ?? []).map((d) => d.name)}
          onCancel={() => setShowCreate(false)}
          onCreated={async (name) => {
            setShowCreate(false);
            await load();
            // Creating a database and then having to find it in the list is a
            // step nobody wants; switching to it is always what was meant.
            await switchTo(name);
          }}
        />
      )}
    </>
  );
}
