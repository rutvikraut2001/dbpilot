'use client';

import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MethodPill } from '../method-pill';
import { useApiStudioStore } from '@/lib/stores/api-studio';
import { isHttpResponse } from '@/lib/api-studio/types';

function formatRelative(at: number) {
  const diff = Date.now() - at;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(at).toLocaleDateString();
}

export function HistoryList() {
  const history = useApiStudioStore((s) => s.history);
  const clearHistory = useApiStudioStore((s) => s.clearHistory);
  const openScratch = useApiStudioStore((s) => s.openScratchTab);
  const updateDraft = useApiStudioStore((s) => s.updateDraft);

  const replaySnapshot = (id: string) => {
    const entry = history.find((h) => h.id === id);
    if (!entry) return;
    const tabId = openScratch();
    updateDraft(tabId, {
      name: entry.requestSnapshot.name,
      method: entry.requestSnapshot.method,
      url: entry.requestSnapshot.url,
      params: entry.requestSnapshot.params,
      headers: entry.requestSnapshot.headers,
      body: entry.requestSnapshot.body,
      auth: entry.requestSnapshot.auth,
      captures: entry.requestSnapshot.captures,
    });
  };

  if (history.length === 0) {
    return (
      <div className="p-3 text-center text-xs text-muted-foreground">
        Sent requests will appear here.
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1">
      <div className="flex items-center justify-between pb-1">
        <span className="text-xs text-muted-foreground">{history.length} entries</span>
        <Button size="sm" variant="ghost" onClick={clearHistory}>
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Clear
        </Button>
      </div>
      {history.map((h) => {
        const r = h.result;
        const status = isHttpResponse(r) ? r.status : null;
        return (
          <button
            type="button"
            key={h.id}
            onClick={() => replaySnapshot(h.id)}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted text-left"
          >
            <MethodPill method={h.requestSnapshot.method} />
            <span className="flex-1 truncate font-mono">{h.requestSnapshot.url || 'no url'}</span>
            {status != null && (
              <span className="font-mono text-[10px] text-muted-foreground">{status}</span>
            )}
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {formatRelative(h.at)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
