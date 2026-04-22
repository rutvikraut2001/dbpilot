'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, AlertCircle } from 'lucide-react';
import { ResponseBody } from './response-body';
import { ResponseHeaders } from './response-headers';
import { ResponseTimeline } from './response-timeline';
import type { ExecutionResult } from '@/lib/api-studio/types';
import { isHttpResponse } from '@/lib/api-studio/types';

function statusTone(status: number) {
  if (status >= 200 && status < 300) return 'text-emerald-500';
  if (status >= 300 && status < 400) return 'text-sky-500';
  if (status >= 400 && status < 500) return 'text-amber-500';
  if (status >= 500) return 'text-red-500';
  return 'text-muted-foreground';
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function ResponseViewer({
  result,
  loading,
}: Readonly<{
  result: ExecutionResult | null;
  loading: boolean;
}>) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <p className="text-sm">Sending request…</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground text-sm">
        <p>Send a request to see the response here.</p>
      </div>
    );
  }

  if (!isHttpResponse(result)) {
    return (
      <div className="p-4 space-y-2">
        <div className="flex items-center gap-2 text-red-500">
          <AlertCircle className="h-4 w-4" />
          <span className="font-semibold text-sm">Request failed</span>
        </div>
        <p className="text-sm font-mono break-all">{result.error}</p>
        {result.effectiveUrl && (
          <p className="text-xs text-muted-foreground">
            URL: <span className="font-mono">{result.effectiveUrl}</span>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b flex items-center gap-3 text-xs">
        <span className={`font-mono font-semibold ${statusTone(result.status)}`}>
          {result.status} {result.statusText}
        </span>
        <span className="text-muted-foreground">
          {Math.round(result.timings.total)} ms
        </span>
        <span className="text-muted-foreground">{formatBytes(result.size)}</span>
        {result.rewroteHost && (
          <span
            className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
            title={`Rewrote ${result.rewroteHost.from} → ${result.rewroteHost.to} for Docker`}
          >
            host: {result.rewroteHost.to}
          </span>
        )}
      </div>
      <Tabs defaultValue="body" className="flex-1 min-h-0 gap-0">
        <TabsList className="mx-3 mt-2 w-fit">
          <TabsTrigger value="body">Body</TabsTrigger>
          <TabsTrigger value="headers">
            Headers{' '}
            <span className="ml-1 text-[10px] text-muted-foreground">
              {Object.keys(result.headers).length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>
        <TabsContent value="body" className="min-h-0">
          <ResponseBody response={result} />
        </TabsContent>
        <TabsContent value="headers" className="min-h-0 overflow-auto">
          <ResponseHeaders response={result} />
        </TabsContent>
        <TabsContent value="timeline" className="min-h-0 overflow-auto">
          <ResponseTimeline timings={result.timings} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
