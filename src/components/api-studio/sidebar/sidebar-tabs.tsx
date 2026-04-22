'use client';

import { FolderTree, History, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApiStudioStore } from '@/lib/stores/api-studio';
import type { SidebarTab } from '@/lib/api-studio/types';

const TABS: { id: SidebarTab; icon: typeof FolderTree; label: string }[] = [
  { id: 'collections', icon: FolderTree, label: 'Collections' },
  { id: 'history', icon: History, label: 'History' },
  { id: 'environments', icon: Globe, label: 'Environments' },
];

export function SidebarTabs() {
  const sidebarTab = useApiStudioStore((s) => s.sidebarTab);
  const setSidebarTab = useApiStudioStore((s) => s.setSidebarTab);

  return (
    <div className="flex border-b">
      {TABS.map((t) => {
        const active = sidebarTab === t.id;
        const Icon = t.icon;
        return (
          <button
            type="button"
            key={t.id}
            onClick={() => setSidebarTab(t.id)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium border-b-2 transition-colors',
              active
                ? 'border-[var(--color-api-mid)] text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
