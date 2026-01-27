'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  Database,
  Table2,
  Code2,
  GitBranch,
  LogOut,
  Shield,
  ShieldOff,
  PanelLeftClose,
  PanelLeft,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import {
  useConnectionStore,
  useActiveConnection,
  useReadOnlyMode,
} from '@/lib/stores/connection';
import { useStudioStore, TabType } from '@/lib/stores/studio';

export default function StudioPage() {
  const router = useRouter();
  const { setTheme } = useTheme();
  const activeConnection = useActiveConnection();
  const readOnlyMode = useReadOnlyMode();
  const { setActiveConnection, toggleReadOnlyMode } = useConnectionStore();
  const {
    activeTab,
    setActiveTab,
    sidebarOpen,
    setSidebarOpen,
    reset,
  } = useStudioStore();

  // Sidebar resize state
  const [sidebarWidth, setSidebarWidth] = useState(280);
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
    [isResizing]
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

  useEffect(() => {
    // Redirect to home if no active connection
    if (!activeConnection) {
      router.push('/');
    }
  }, [activeConnection, router]);

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

  if (!activeConnection) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Redirecting...</p>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="h-14 border-b flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            <span className="font-semibold">DB Studio</span>
          </div>
          <span className="text-muted-foreground">/</span>
          <div className="flex items-center gap-2">
            <span className="font-medium">{activeConnection.name}</span>
            <Badge variant="secondary" className="text-xs">
              {activeConnection.type === 'postgresql' ? 'PostgreSQL' : 'MongoDB'}
            </Badge>
          </div>
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
                  <Label htmlFor="readonly-mode" className="text-sm cursor-pointer">
                    Read-only
                  </Label>
                  <Switch
                    id="readonly-mode"
                    checked={readOnlyMode}
                    onCheckedChange={toggleReadOnlyMode}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {readOnlyMode
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

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - resizable */}
        {sidebarOpen && (
          <div
            ref={sidebarRef}
            className="h-full overflow-hidden shrink-0 relative flex"
            style={{ width: sidebarWidth }}
          >
            <div className="flex-1 overflow-auto border-r">
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
          <div className="border-b px-2 flex items-center justify-between shrink-0">
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
                <TabsTrigger
                  value="schema"
                  className="px-4 h-9 data-[state=active]:bg-muted rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                >
                  <GitBranch className="h-4 w-4 mr-2" />
                  Schema
                </TabsTrigger>
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

          {/* Tab Content */}
          <div className="flex-1 overflow-hidden">
            {activeTab === 'data' && <DataViewer />}
            {activeTab === 'query' && <QueryEditor />}
            {activeTab === 'schema' && <SchemaViewer />}
          </div>
        </div>
      </div>
    </div>
  );
}
