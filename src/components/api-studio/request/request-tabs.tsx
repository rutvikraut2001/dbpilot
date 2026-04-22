'use client';

import { X, Plus, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MethodPill } from '../method-pill';
import { useApiStudioStore } from '@/lib/stores/api-studio';
import { cn } from '@/lib/utils';

export function RequestTabsStrip() {
  const openTabs = useApiStudioStore((s) => s.openTabs);
  const activeTabId = useApiStudioStore((s) => s.activeTabId);
  const setActive = useApiStudioStore((s) => s.setActiveTab);
  const close = useApiStudioStore((s) => s.closeTab);
  const openScratch = useApiStudioStore((s) => s.openScratchTab);

  return (
    <div className="flex items-center gap-0.5 px-2 border-b overflow-x-auto bg-muted/20">
      {openTabs.map((t) => {
        const active = t.id === activeTabId;
        return (
          <button
            type="button"
            key={t.id}
            onClick={() => setActive(t.id)}
            className={cn(
              'group relative flex items-center gap-2 max-w-60 shrink-0 px-3 py-2 text-xs border-b-2 transition-colors',
              active
                ? 'border-[var(--color-api-mid)] text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <MethodPill method={t.draft.method} />
            <span className="truncate">
              {t.draft.name || 'Untitled'}
            </span>
            {t.dirty && (
              <Circle className="h-2 w-2 fill-current text-[var(--color-api-mid)]" />
            )}
            <span
              role="button"
              aria-label="Close tab"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                close(t.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  close(t.id);
                }
              }}
              className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted rounded p-0.5"
            >
              <X className="h-3 w-3" />
            </span>
          </button>
        );
      })}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => openScratch()}
        title="New request"
        className="shrink-0"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}
