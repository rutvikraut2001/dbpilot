'use client';

import { useMemo, useState } from 'react';
import { MonacoEditor } from '@/components/query-editor/monaco-editor';
import { Button } from '@/components/ui/button';
import { Copy, Check, FileJson, FileText } from 'lucide-react';
import type { HttpResponse } from '@/lib/api-studio/types';

function detectLanguage(contentType: string | null): 'json' | 'html' | 'xml' | 'plaintext' {
  if (!contentType) return 'plaintext';
  const ct = contentType.toLowerCase();
  if (ct.includes('json')) return 'json';
  if (ct.includes('html')) return 'html';
  if (ct.includes('xml')) return 'xml';
  return 'plaintext';
}

export function ResponseBody({ response }: Readonly<{ response: HttpResponse }>) {
  const isBinary = response.body.startsWith('base64:');
  const [pretty, setPretty] = useState(true);
  const [copied, setCopied] = useState(false);

  const language = detectLanguage(response.contentType);

  const rendered = useMemo(() => {
    if (isBinary) return response.body;
    if (pretty && language === 'json') {
      try {
        return JSON.stringify(JSON.parse(response.body), null, 2);
      } catch {
        return response.body;
      }
    }
    return response.body;
  }, [response.body, isBinary, pretty, language]);

  const copy = async () => {
    await navigator.clipboard.writeText(rendered);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  if (isBinary) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground space-y-2">
        <FileJson className="h-8 w-8 mx-auto opacity-40" />
        <p>Binary response ({response.size.toLocaleString()} bytes). Preview not available.</p>
      </div>
    );
  }

  if (!response.body) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        <FileText className="h-8 w-8 mx-auto opacity-40 mb-2" />
        <p>Response body is empty.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-1.5 border-b flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">{response.contentType ?? 'text/plain'}</span>
        <span className="ml-auto flex items-center gap-1">
          {language === 'json' && (
            <Button
              size="sm"
              variant={pretty ? 'secondary' : 'ghost'}
              onClick={() => setPretty((p) => !p)}
            >
              {pretty ? 'Pretty' : 'Raw'}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={copy}>
            {copied ? (
              <Check className="h-3.5 w-3.5 mr-1" />
            ) : (
              <Copy className="h-3.5 w-3.5 mr-1" />
            )}
            Copy
          </Button>
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <MonacoEditor value={rendered} readOnly language={language} />
      </div>
    </div>
  );
}
