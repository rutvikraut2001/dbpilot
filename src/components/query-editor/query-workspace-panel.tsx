'use client';

import { useMemo, useState } from 'react';
import {
  Check,
  Clock,
  History,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { QueryHistoryEntry, SavedQuery } from '@/lib/stores/studio';

interface QueryWorkspacePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  history: QueryHistoryEntry[];
  savedQueries: SavedQuery[];
  onLoadQuery: (query: string) => void;
  onSaveQuery: (query: string) => void;
  onRemoveSaved: (id: string) => void;
  onClearHistory: () => void;
}

function relativeTime(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function QuerySnippet({ query }: Readonly<{ query: string }>) {
  return (
    <code className="block truncate font-mono text-xs text-foreground">
      {query.replace(/\s+/g, ' ').trim()}
    </code>
  );
}

/**
 * History and saved queries.
 *
 * The history was already being recorded — `addToHistory` had been filling the
 * store since before this panel existed — but nothing ever rendered it.
 */
export function QueryWorkspacePanel({
  open,
  onOpenChange,
  history,
  savedQueries,
  onLoadQuery,
  onSaveQuery,
  onRemoveSaved,
  onClearHistory,
}: Readonly<QueryWorkspacePanelProps>) {
  const [tab, setTab] = useState<'history' | 'saved'>('history');
  const [filter, setFilter] = useState('');

  const needle = filter.trim().toLowerCase();

  const visibleHistory = useMemo(
    () =>
      needle
        ? history.filter((entry) => entry.query.toLowerCase().includes(needle))
        : history,
    [history, needle]
  );

  const visibleSaved = useMemo(
    () =>
      needle
        ? savedQueries.filter(
            (entry) =>
              entry.query.toLowerCase().includes(needle) ||
              entry.name.toLowerCase().includes(needle)
          )
        : savedQueries,
    [savedQueries, needle]
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Query workspace</SheetTitle>
          <SheetDescription>
            Recent runs and the queries you have kept.
          </SheetDescription>
        </SheetHeader>

        <div className="shrink-0 space-y-3 px-4 pb-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'history' | 'saved')}>
            <TabsList className="w-full">
              <TabsTrigger value="history" className="flex-1">
                <History className="mr-1.5 h-3.5 w-3.5" />
                History ({history.length})
              </TabsTrigger>
              <TabsTrigger value="saved" className="flex-1">
                <Star className="mr-1.5 h-3.5 w-3.5" />
                Saved ({savedQueries.length})
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search queries..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {tab === 'history' && (
            <HistoryList
              entries={visibleHistory}
              hasAny={history.length > 0}
              onLoadQuery={onLoadQuery}
              onSaveQuery={onSaveQuery}
            />
          )}
          {tab === 'saved' && (
            <SavedList
              entries={visibleSaved}
              hasAny={savedQueries.length > 0}
              onLoadQuery={onLoadQuery}
              onRemoveSaved={onRemoveSaved}
            />
          )}
        </div>

        {tab === 'history' && history.length > 0 && (
          <div className="shrink-0 border-t px-4 py-3">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={onClearHistory}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Clear history
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function HistoryList({
  entries,
  hasAny,
  onLoadQuery,
  onSaveQuery,
}: Readonly<{
  entries: QueryHistoryEntry[];
  hasAny: boolean;
  onLoadQuery: (query: string) => void;
  onSaveQuery: (query: string) => void;
}>) {
  if (entries.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {hasAny ? 'No queries match that search.' : 'No queries run yet.'}
      </p>
    );
  }

  return (
    <ul className="space-y-1.5">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="group rounded-md border p-2 transition-colors hover:bg-muted/50"
        >
          <button
            type="button"
            onClick={() => onLoadQuery(entry.query)}
            className="block w-full text-left"
            title="Load into the editor"
          >
            <QuerySnippet query={entry.query} />
            <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
              {entry.success ? (
                <Check className="h-3 w-3 shrink-0 text-emerald-500" />
              ) : (
                <X className="h-3 w-3 shrink-0 text-destructive" />
              )}
              <span>{relativeTime(entry.timestamp)}</span>
              {entry.durationMs !== undefined && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {entry.durationMs}ms
                </span>
              )}
              {entry.rowCount !== undefined && entry.success && (
                <span>
                  {entry.rowCount} row{entry.rowCount === 1 ? '' : 's'}
                </span>
              )}
              <span className="truncate">{entry.database}</span>
            </div>
            {!entry.success && entry.error && (
              <p className="mt-1 truncate text-[11px] text-destructive">
                {entry.error}
              </p>
            )}
          </button>
          <div className="mt-1.5 flex justify-end opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => onSaveQuery(entry.query)}
            >
              <Star className="mr-1 h-3 w-3" />
              Save
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function SavedList({
  entries,
  hasAny,
  onLoadQuery,
  onRemoveSaved,
}: Readonly<{
  entries: SavedQuery[];
  hasAny: boolean;
  onLoadQuery: (query: string) => void;
  onRemoveSaved: (id: string) => void;
}>) {
  if (entries.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {hasAny
          ? 'No queries match that search.'
          : 'Nothing saved yet. Save a query from the toolbar or from history.'}
      </p>
    );
  }

  return (
    <ul className="space-y-1.5">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="group flex items-start gap-2 rounded-md border p-2 transition-colors hover:bg-muted/50"
        >
          <button
            type="button"
            onClick={() => onLoadQuery(entry.query)}
            className="min-w-0 flex-1 text-left"
            title="Load into the editor"
          >
            <span className="block truncate text-sm font-medium">
              {entry.name}
            </span>
            <QuerySnippet query={entry.query} />
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
            onClick={() => onRemoveSaved(entry.id)}
            aria-label={`Delete ${entry.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </li>
      ))}
    </ul>
  );
}
