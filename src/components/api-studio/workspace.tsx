'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { GitBranch, Inbox, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RequestTabsStrip } from './request/request-tabs';
import { RequestBuilder } from './request/request-builder';
import { SidebarTabs } from './sidebar/sidebar-tabs';
import { CollectionsTree } from './sidebar/collections-tree';
import { HistoryList } from './sidebar/history-list';
import { EnvList } from './sidebar/env-list';
import { FlowGraph } from './flow/flow-graph';
import { ImportDialog } from './import-dialog';
import { EnvSwitcher } from './env/env-switcher';
import {
  useApiStudioStore,
  useActiveApiTab,
} from '@/lib/stores/api-studio';

export function ApiStudioWorkspace() {
  const sidebarTab = useApiStudioStore((s) => s.sidebarTab);
  const flowOpen = useApiStudioStore((s) => s.flowOpen);
  const setFlowOpen = useApiStudioStore((s) => s.setFlowOpen);
  const activeTab = useActiveApiTab();
  const openScratch = useApiStudioStore((s) => s.openScratchTab);
  const addCollection = useApiStudioStore((s) => s.addCollection);

  const [importOpen, setImportOpen] = useState(false);

  // Sidebar resize
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [resizing, setResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const start = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(true);
  }, []);
  const stop = useCallback(() => setResizing(false), []);
  const move = useCallback(
    (e: MouseEvent) => {
      if (!resizing || !sidebarRef.current) return;
      const w = e.clientX - sidebarRef.current.getBoundingClientRect().left;
      if (w >= 220 && w <= 500) setSidebarWidth(w);
    },
    [resizing]
  );
  useEffect(() => {
    if (!resizing) return;
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
    };
  }, [resizing, move, stop]);

  return (
    <div className="flex h-full min-h-0 relative">
      <aside
        ref={sidebarRef}
        className="shrink-0 flex flex-col border-r bg-muted/10 relative"
        style={{ width: sidebarWidth }}
      >
        <SidebarTabs />
        <div className="flex-1 min-h-0 overflow-auto">
          {sidebarTab === 'collections' && (
            <CollectionsTree
              onNewCollection={() => {
                const name = window.prompt('Collection name');
                if (name?.trim()) addCollection(name.trim());
              }}
              onImport={() => setImportOpen(true)}
            />
          )}
          {sidebarTab === 'history' && <HistoryList />}
          {sidebarTab === 'environments' && <EnvList />}
        </div>
        <div className="p-2 border-t flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => setFlowOpen(true)}
          >
            <GitBranch className="h-3.5 w-3.5 mr-1" />
            Flow Graph
          </Button>
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={start}
          className={`absolute top-0 right-0 h-full w-1 cursor-ew-resize transition-colors ${
            resizing ? 'bg-[var(--color-api-mid)]/60' : 'hover:bg-[var(--color-api-mid)]/40'
          }`}
        />
      </aside>

      <main className="flex-1 flex flex-col min-w-0 relative">
        <div className="h-10 border-b flex items-center justify-between px-3 shrink-0">
          <EnvSwitcher />
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => openScratch()}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              New request
            </Button>
          </div>
        </div>
        <RequestTabsStrip />
        <div className="flex-1 min-h-0">
          {activeTab ? (
            <RequestBuilder tab={activeTab} />
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Inbox className="h-8 w-8 opacity-40" />
              <p className="text-sm">No request open.</p>
              <Button onClick={() => openScratch()} className="api-gradient text-white">
                <Plus className="h-4 w-4 mr-1" />
                New request
              </Button>
            </div>
          )}
        </div>
        {flowOpen && <FlowGraph onClose={() => setFlowOpen(false)} />}
      </main>

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
