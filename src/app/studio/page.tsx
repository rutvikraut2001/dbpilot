'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  Database,
  Table2,
  Code2,
  GitBranch,
  ListTree,
  LogOut,
  Shield,
  ShieldOff,
  PanelLeftClose,
  PanelLeft,
  Sun,
  Moon,
  Monitor,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TableBrowser } from '@/components/sidebar/table-browser';
import { DataViewer } from '@/components/data-table/data-viewer';
import { QueryEditor } from '@/components/query-editor/query-editor';
import { SchemaViewer } from '@/components/schema-viewer/schema-viewer';
import { IndexManager } from '@/components/indexes/index-manager';
import { DatabaseSwitcher } from '@/components/connection/database-switcher';
import {
  useConnectionStore,
  useActiveConnection,
  useReadOnlyMode,
  useForceReadOnly,
  useWriteExpiresAt,
  useHasHydrated,
} from '@/lib/stores/connection';
import { useStudioStore, TabType } from '@/lib/stores/studio';
import { ConnectionConfig } from '@/lib/adapters/types';
import { useConnectionHealth, ConnectionHealthStatus } from '@/hooks/use-connection-health';
import { environmentStyle, isProduction } from '@/lib/utils/environment';
import { WriteAccessDialog } from '@/components/connection/write-access-dialog';
import { toast } from 'sonner';

export default function StudioPage() {
  const router = useRouter();
  const { setTheme } = useTheme();
  const hasHydrated = useHasHydrated();
  const activeConnection = useActiveConnection();
  const readOnlyMode = useReadOnlyMode();
  const forceReadOnly = useForceReadOnly();
  const writeExpiresAt = useWriteExpiresAt();
  // Per-field selectors rather than whole-store subscriptions: actions are
  // stable references, so only real state changes re-render this component.
  const setActiveConnection = useConnectionStore((s) => s.setActiveConnection);
  const setReadOnlyMode = useConnectionStore((s) => s.setReadOnlyMode);
  const syncReadOnlyMode = useConnectionStore((s) => s.syncReadOnlyMode);
  const activeTab = useStudioStore((s) => s.activeTab);
  const setActiveTab = useStudioStore((s) => s.setActiveTab);
  const sidebarOpen = useStudioStore((s) => s.sidebarOpen);
  const sidebarWidth = useStudioStore((s) => s.sidebarWidth);
  const setSidebarWidth = useStudioStore((s) => s.setSidebarWidth);
  const hydrateForConnection = useStudioStore((s) => s.hydrateForConnection);
  const setSidebarOpen = useStudioStore((s) => s.setSidebarOpen);
  const reset = useStudioStore((s) => s.reset);

  // If Redis connection and schema tab is active, redirect to data tab
  useEffect(() => {
    if (
      activeConnection?.type === 'redis' &&
      (activeTab === 'schema' || activeTab === 'indexes')
    ) {
      setActiveTab('data');
    }
  }, [activeConnection, activeTab, setActiveTab]);

  // Reconnection state — start true so UI waits for adapter confirmation
  const [isReconnecting, setIsReconnecting] = useState(true);
  const [reconnectFailed, setReconnectFailed] = useState(false);
  const reconnectAttempted = useRef(false);

  // Connection health monitoring
  const { status: healthStatus, reconnect: healthReconnect } = useConnectionHealth({
    connectionId: activeConnection?.id ?? null,
    connectionType: activeConnection?.type,
    connectionString: activeConnection?.connectionString,
  });

  // Toast on health status changes
  const prevHealthStatus = useRef<ConnectionHealthStatus>('healthy');
  useEffect(() => {
    if (prevHealthStatus.current !== healthStatus) {
      if (healthStatus === 'unhealthy') {
        toast.warning('Connection lost', {
          description: 'Attempting to reconnect...',
          duration: 5000,
        });
      } else if (healthStatus === 'healthy' && prevHealthStatus.current !== 'healthy') {
        toast.success('Connection restored');
      } else if (healthStatus === 'disconnected') {
        toast.error('Connection lost', {
          description: 'Could not reconnect. Click "Reconnect" to try again.',
          duration: 10000,
        });
      }
      prevHealthStatus.current = healthStatus;
    }
  }, [healthStatus]);

  // Enabling writes goes through a dialog that picks a duration; turning them
  // back off is immediate.
  const [writeDialogOpen, setWriteDialogOpen] = useState(false);

  const handleReadOnlyToggle = useCallback(() => {
    if (readOnlyMode) {
      setWriteDialogOpen(true);
      return;
    }
    setReadOnlyMode(true);
  }, [readOnlyMode, setReadOnlyMode]);

  // Countdown on the remaining grant. Re-rendered every second only while a
  // grant is actually active.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (readOnlyMode || writeExpiresAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [readOnlyMode, writeExpiresAt]);

  // When the grant lapses, ask the server for the truth rather than assuming.
  useEffect(() => {
    if (readOnlyMode || writeExpiresAt === null) return;
    if (now < writeExpiresAt) return;
    if (!activeConnection) return;

    syncReadOnlyMode(activeConnection.id);
    toast.info('Write access expired', {
      description: 'The connection is read-only again.',
    });
  }, [now, writeExpiresAt, readOnlyMode, activeConnection, syncReadOnlyMode]);

  const remainingLabel = (() => {
    if (readOnlyMode || writeExpiresAt === null) return null;
    const seconds = Math.max(0, Math.ceil((writeExpiresAt - now) / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  })();

  // Sidebar resize state. Width lives in the store so it persists across
  // reloads — setSidebarWidth was previously dead code while this component
  // kept its own copy.
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback(
    (e: MouseEvent) => {
      if (isResizing && sidebarRef.current) {
        const newWidth = e.clientX - sidebarRef.current.getBoundingClientRect().left;
        if (newWidth >= 200 && newWidth <= 500) {
          setSidebarWidth(newWidth);
        }
      }
    },
    [isResizing, setSidebarWidth]
  );

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', resize);
      window.addEventListener('mouseup', stopResizing);
    }

    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [isResizing, resize, stopResizing]);

  // Auto-reconnect on page load if we have a saved connection
  useEffect(() => {
    // Wait for Zustand to hydrate from localStorage before deciding
    if (!hasHydrated) return;

    const checkAndReconnect = async (connection: ConnectionConfig) => {
      setIsReconnecting(true);
      setReconnectFailed(false);

      try {
        // First, check if connection already exists and is healthy
        const healthResponse = await fetch(
          `/api/connect?connectionId=${connection.id}`
        );
        const healthData = await healthResponse.json();

        if (healthData.exists && healthData.healthy) {
          // Connection is still alive, no need to reconnect. Still adopt the
          // server's read-only state — the UI must never show a mode the server
          // isn't actually enforcing.
          await syncReadOnlyMode(connection.id);
          setIsReconnecting(false);
          return;
        }

        // Connection doesn't exist or is unhealthy, reconnect.
        // Must send `connectionId` (not `id`) — that's the field the API reads to cache the adapter.
        const response = await fetch('/api/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: connection.type,
            connectionString: connection.connectionString,
            connectionId: connection.id,
          }),
        });

        const reconnectData = await response.json().catch(() => ({}));
        if (!response.ok || !reconnectData.success) {
          throw new Error('Failed to reconnect');
        }

        // Connection restored. Adopt the server's read-only state rather than a
        // locally-remembered preference — a fresh connection is read-only, and
        // the user re-enables writes deliberately via the toggle.
        await syncReadOnlyMode(connection.id);
        setIsReconnecting(false);
      } catch (error) {
        console.error('Reconnect error:', error);
        setIsReconnecting(false);
        setReconnectFailed(true);
        // Clear the active connection since reconnect failed
        setActiveConnection(null);
      }
    };

    // Only attempt reconnect once per page load
    if (reconnectAttempted.current) return;

    if (activeConnection) {
      reconnectAttempted.current = true;
      hydrateForConnection(activeConnection.id);
      checkAndReconnect(activeConnection);
    } else {
      // Redirect to home if no active connection
      setIsReconnecting(false);
      router.push('/');
    }
  }, [hasHydrated, activeConnection, router, setActiveConnection, syncReadOnlyMode, hydrateForConnection]);

  const handleDisconnect = async () => {
    if (!activeConnection) return;

    try {
      await fetch(`/api/connect?connectionId=${activeConnection.id}`, {
        method: 'DELETE',
      });
    } catch (error) {
      console.error('Disconnect error:', error);
    }

    setActiveConnection(null);
    reset();
    router.push('/');
  };

  // Show loading while waiting for hydration
  if (!hasHydrated) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  // Redirect if no connection after hydration
  if (!activeConnection || reconnectFailed) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Redirecting...</p>
      </div>
    );
  }

  if (isReconnecting) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Reconnecting to {activeConnection.name}...</p>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Production stripe — always visible, not dismissible, so the tab is
          identifiable at a glance even when scrolled into a data grid. */}
      {isProduction(activeConnection.environment) && (
        <div className="flex items-center justify-center gap-2 bg-red-600 px-4 py-1 text-[11px] font-semibold uppercase tracking-wider text-white shrink-0">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          Production — {activeConnection.name}
        </div>
      )}

      {/* Header */}
      <header className="h-14 border-b border-border/60 bg-background/70 backdrop-blur-md flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            <span className="font-semibold">DB Studio</span>
          </div>
          <span className="text-muted-foreground">/</span>
          <DatabaseSwitcher activeConnection={activeConnection} />

          {/* Environment label — makes "I thought that was staging" harder. */}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
              environmentStyle(activeConnection.environment).badgeClass
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${
                environmentStyle(activeConnection.environment).dotClass
              }`}
            />
            {environmentStyle(activeConnection.environment).label}
          </span>

          {/* Health status indicator */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5">
                  <div className={`h-2 w-2 rounded-full ${
                    healthStatus === 'healthy' ? 'bg-green-500' :
                    healthStatus === 'reconnecting' ? 'bg-yellow-500 animate-pulse' :
                    healthStatus === 'unhealthy' ? 'bg-yellow-500' :
                    'bg-red-500'
                  }`} />
                  {healthStatus === 'disconnected' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-destructive"
                      onClick={healthReconnect}
                    >
                      Reconnect
                    </Button>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {healthStatus === 'healthy' && 'Connection healthy'}
                {healthStatus === 'unhealthy' && 'Connection unhealthy'}
                {healthStatus === 'reconnecting' && 'Reconnecting...'}
                {healthStatus === 'disconnected' && 'Disconnected — click Reconnect'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="flex items-center gap-4">
          {/* Theme toggle */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                <span className="sr-only">Toggle theme</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setTheme('light')}>
                <Sun className="h-4 w-4 mr-2" />
                Light
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme('dark')}>
                <Moon className="h-4 w-4 mr-2" />
                Dark
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme('system')}>
                <Monitor className="h-4 w-4 mr-2" />
                System
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Read-only toggle */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2">
                  {readOnlyMode ? (
                    <Shield className="h-4 w-4 text-green-500" />
                  ) : (
                    <ShieldOff className="h-4 w-4 text-amber-500" />
                  )}
                  <Label
                    htmlFor="readonly-mode"
                    className={
                      forceReadOnly
                        ? 'text-sm'
                        : 'text-sm cursor-pointer'
                    }
                  >
                    Read-only
                    {forceReadOnly && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (enforced)
                      </span>
                    )}
                    {remainingLabel && (
                      <span className="ml-1 font-mono text-xs text-amber-600 dark:text-amber-400">
                        writes {remainingLabel}
                      </span>
                    )}
                  </Label>
                  <Switch
                    id="readonly-mode"
                    checked={readOnlyMode}
                    onCheckedChange={handleReadOnlyToggle}
                    disabled={forceReadOnly}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {forceReadOnly
                  ? 'This instance runs with FORCE_READ_ONLY=true — write access cannot be enabled'
                  : readOnlyMode
                  ? 'Write operations are disabled for safety'
                  : 'Write operations are enabled'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Button variant="outline" size="sm" onClick={handleDisconnect}>
            <LogOut className="h-4 w-4 mr-1" />
            Disconnect
          </Button>
        </div>
      </header>

      {/* Main Content — keyed by connection ID so React force-remounts all
          child components (TableBrowser, DataViewer, etc.) when switching DBs,
          guaranteeing fresh useEffect fetches with the correct connection. */}
      <div key={activeConnection.id} className="flex-1 flex overflow-hidden">
        {/* Sidebar - resizable */}
        {sidebarOpen && (
          <div
            ref={sidebarRef}
            className="h-full overflow-hidden shrink-0 relative flex"
            style={{ width: sidebarWidth }}
          >
            <div className="flex-1 overflow-auto border-r border-border/60 bg-background/70 backdrop-blur-md">
              <TableBrowser />
            </div>
            {/* Resize Handle */}
            <div
              className={`w-1 cursor-ew-resize hover:bg-primary/30 active:bg-primary/50 transition-colors ${
                isResizing ? 'bg-primary/50' : 'bg-transparent'
              }`}
              onMouseDown={startResizing}
            />
          </div>
        )}

        {/* Main Panel */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Tab Bar */}
          <div className="border-b border-border/60 bg-background/60 backdrop-blur-md px-2 flex items-center justify-between shrink-0">
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as TabType)}
              className="h-11"
            >
              <TabsList className="h-10 bg-transparent p-0">
                <TabsTrigger
                  value="data"
                  className="px-4 h-9 data-[state=active]:bg-muted rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                >
                  <Table2 className="h-4 w-4 mr-2" />
                  Data
                </TabsTrigger>
                <TabsTrigger
                  value="query"
                  className="px-4 h-9 data-[state=active]:bg-muted rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                >
                  <Code2 className="h-4 w-4 mr-2" />
                  Query
                </TabsTrigger>
                {activeConnection.type !== 'redis' && (
                  <TabsTrigger
                    value="schema"
                    className="px-4 h-9 data-[state=active]:bg-muted rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                  >
                    <GitBranch className="h-4 w-4 mr-2" />
                    Schema
                  </TabsTrigger>
                )}
                {activeConnection.type !== 'redis' && (
                  <TabsTrigger
                    value="indexes"
                    className="px-4 h-9 data-[state=active]:bg-muted rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                  >
                    <ListTree className="h-4 w-4 mr-2" />
                    Indexes
                  </TabsTrigger>
                )}
              </TabsList>
            </Tabs>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
                  >
                    {sidebarOpen ? (
                      <PanelLeftClose className="h-4 w-4" />
                    ) : (
                      <PanelLeft className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {/* Connection health banner */}
          {(healthStatus === 'unhealthy' || healthStatus === 'disconnected') && (
            <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between shrink-0">
              <span className="text-xs text-amber-600 dark:text-amber-400">
                {healthStatus === 'disconnected'
                  ? 'Connection lost. Data may be stale.'
                  : 'Connection unstable. Attempting to reconnect...'}
              </span>
              {healthStatus === 'disconnected' && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={healthReconnect}
                >
                  Retry
                </Button>
              )}
            </div>
          )}

          {/* Tab Content */}
          <div className="flex-1 overflow-hidden">
            {activeTab === 'data' && <DataViewer />}
            {activeTab === 'query' && <QueryEditor />}
            {activeTab === 'schema' && <SchemaViewer />}
            {activeTab === 'indexes' && <IndexManager />}
          </div>
        </div>
      </div>

      {writeDialogOpen && (
      <WriteAccessDialog
        connectionName={activeConnection.name}
        requireReason={isProduction(activeConnection.environment)}
        onCancel={() => setWriteDialogOpen(false)}
        onConfirm={(options) => {
          setWriteDialogOpen(false);
          setReadOnlyMode(false, options);
        }}
      />
      )}
    </div>
  );
}
