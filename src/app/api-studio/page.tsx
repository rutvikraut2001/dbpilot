'use client';

import Link from 'next/link';
import { useTheme } from 'next-themes';
import { Database, Loader2, Moon, Sun, Monitor, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ApiStudioWorkspace } from '@/components/api-studio/workspace';
import { useApiHasHydrated, useActiveApiEnvironment } from '@/lib/stores/api-studio';
import { useActiveConnection, useHasHydrated } from '@/lib/stores/connection';

export default function ApiStudioPage() {
  const { setTheme } = useTheme();
  const apiHydrated = useApiHasHydrated();
  const connectionHydrated = useHasHydrated();
  const activeConnection = useActiveConnection();
  const activeEnv = useActiveApiEnvironment();

  if (!apiHydrated || !connectionHydrated) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-api-mid)]" />
        <p className="text-muted-foreground">Loading API Studio…</p>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <header className="h-14 border-b flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <Send className="h-5 w-5 text-[var(--color-api-mid)]" />
            <span className="font-semibold">
              <span className="api-text">API Studio</span>
            </span>
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm text-muted-foreground">
            {activeEnv ? activeEnv.name : 'No environment'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {activeConnection && (
            <Link href="/studio">
              <Button variant="outline" size="sm">
                <Database className="h-3.5 w-3.5 mr-1" />
                Back to DB Studio
              </Button>
            </Link>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Toggle theme">
                <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setTheme('light')}>
                <Sun className="h-3.5 w-3.5 mr-2" /> Light
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme('dark')}>
                <Moon className="h-3.5 w-3.5 mr-2" /> Dark
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme('system')}>
                <Monitor className="h-3.5 w-3.5 mr-2" /> System
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div className="flex-1 min-h-0">
        <ApiStudioWorkspace />
      </div>
    </div>
  );
}
