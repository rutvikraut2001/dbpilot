'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Send, Save, MoreHorizontal, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { ParamsEditor } from './params-editor';
import { HeadersEditor } from './headers-editor';
import { BodyEditor } from './body-editor';
import { AuthEditor } from './auth-editor';
import { ResponseViewer } from '../response/response-viewer';
import { executeRequest } from '@/lib/api-studio/execute';
import { useApiStudioStore, useActiveApiEnvironment } from '@/lib/stores/api-studio';
import { HTTP_METHODS, METHOD_COLORS } from '@/lib/api-studio/constants';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { buildCurl, isCurlCommand, parseCurl } from '@/lib/api-studio/curl';
import type {
  ExecutionResult,
  HttpMethod,
  HttpRequest,
  OpenRequestTab,
} from '@/lib/api-studio/types';
import { cn } from '@/lib/utils';

interface RequestBuilderProps {
  tab: OpenRequestTab;
}

export function RequestBuilder({ tab }: Readonly<RequestBuilderProps>) {
  const updateDraft = useApiStudioStore((s) => s.updateDraft);
  const saveActiveDraft = useApiStudioStore((s) => s.saveActiveDraft);
  const pushHistory = useApiStudioStore((s) => s.pushHistory);
  const environment = useActiveApiEnvironment();
  const collections = useApiStudioStore((s) => s.collections);
  const updateEnvironment = useApiStudioStore((s) => s.updateEnvironment);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);

  const draft = tab.draft;
  const patch = (p: Partial<HttpRequest>) => updateDraft(tab.id, p);

  const collection = collections.find((c) => c.id === tab.collectionId) ?? null;

  const applyCurl = (text: string) => {
    try {
      const parsed = parseCurl(text);
      patch({
        method: parsed.method,
        url: parsed.url,
        headers: parsed.headers,
        params: parsed.params,
        body: parsed.body,
        auth: parsed.auth,
      });
      toast.success('Imported from curl');
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not parse curl');
      return false;
    }
  };

  const copyAsCurl = async () => {
    try {
      const cmd = buildCurl(draft);
      await navigator.clipboard.writeText(cmd);
      toast.success('Copied as curl');
    } catch {
      toast.error('Copy failed');
    }
  };

  const send = async () => {
    if (!draft.url.trim()) {
      toast.error('URL is required');
      return;
    }
    setLoading(true);
    try {
      const outcome = await executeRequest({
        request: draft,
        environment,
        collection,
      });
      setResult(outcome.result);
      pushHistory({
        at: Date.now(),
        requestSnapshot: draft,
        environmentId: environment?.id ?? null,
        result: outcome.result,
      });
      const capturedCount = Object.keys(outcome.captured).length;
      if (capturedCount > 0 && environment) {
        const next = [...environment.variables];
        for (const [name, value] of Object.entries(outcome.captured)) {
          const i = next.findIndex((v) => v.key === name);
          if (i >= 0) {
            next[i] = { ...next[i], value };
          } else {
            next.push({
              id: `kv_${Math.random().toString(36).slice(2, 10)}`,
              enabled: true,
              key: name,
              value,
            });
          }
        }
        updateEnvironment(environment.id, { variables: next });
        toast.success(`Captured ${capturedCount} variable${capturedCount > 1 ? 's' : ''}`);
      } else if (capturedCount > 0 && !environment) {
        toast.warning('Captures were ignored — no active environment to write into.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Request failed';
      setResult({ error: message });
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const methodColor = METHOD_COLORS[draft.method];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 py-2 border-b flex items-center gap-2">
        <Select
          value={draft.method}
          onValueChange={(v) => patch({ method: v as HttpMethod })}
        >
          <SelectTrigger size="sm" className={cn('w-30 font-mono font-semibold', methodColor.text)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HTTP_METHODS.map((m) => (
              <SelectItem key={m} value={m}>
                <span className={cn('font-mono font-semibold', METHOD_COLORS[m].text)}>{m}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={draft.url}
          onChange={(e) => {
            const v = e.target.value;
            if (isCurlCommand(v)) {
              applyCurl(v);
            } else {
              patch({ url: v });
            }
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text');
            if (isCurlCommand(pasted)) {
              e.preventDefault();
              applyCurl(pasted);
            }
          }}
          placeholder="https://api.example.com/{{path}}  (or paste a curl command)"
          className="font-mono text-sm flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send();
          }}
        />
        <Button onClick={send} disabled={loading} className="api-gradient text-white">
          <Send className="h-3.5 w-3.5 mr-1" />
          Send
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={saveActiveDraft}
          disabled={!tab.dirty}
          title={tab.dirty ? 'Save changes' : 'No changes to save'}
        >
          <Save className="h-3.5 w-3.5 mr-1" />
          Save
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="More actions">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={copyAsCurl}>
              <Copy className="h-3.5 w-3.5 mr-2" /> Copy as curl
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  if (isCurlCommand(text)) applyCurl(text);
                  else toast.error('Clipboard does not contain a curl command');
                } catch {
                  toast.error('Clipboard read blocked');
                }
              }}
            >
              Import from curl (clipboard)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex-1 min-h-0 grid grid-rows-2">
        <div className="flex flex-col min-h-0 border-b">
          <Tabs defaultValue="params" className="flex-1 min-h-0 gap-0">
            <TabsList className="mx-3 mt-2 w-fit">
              <TabsTrigger value="params">
                Params
                {draft.params.length > 0 && (
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    {draft.params.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="headers">
                Headers
                {draft.headers.length > 0 && (
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    {draft.headers.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="body">
                Body
                {draft.body.mode !== 'none' && (
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    {draft.body.mode}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="auth">
                Auth
                {draft.auth.type !== 'none' && (
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    {draft.auth.type}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="params" className="min-h-0 overflow-auto">
              <ParamsEditor
                params={draft.params}
                onChange={(params) => patch({ params })}
              />
            </TabsContent>
            <TabsContent value="headers" className="min-h-0 overflow-auto">
              <HeadersEditor
                headers={draft.headers}
                onChange={(headers) => patch({ headers })}
              />
            </TabsContent>
            <TabsContent value="body" className="min-h-0">
              <BodyEditor body={draft.body} onChange={(body) => patch({ body })} />
            </TabsContent>
            <TabsContent value="auth" className="min-h-0 overflow-auto">
              <AuthEditor auth={draft.auth} onChange={(auth) => patch({ auth })} />
            </TabsContent>
          </Tabs>
        </div>
        <div className="min-h-0 overflow-hidden">
          <ResponseViewer result={result} loading={loading} />
        </div>
      </div>
    </div>
  );
}
