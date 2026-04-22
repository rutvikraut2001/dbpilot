'use client';

import { MonacoEditor } from '@/components/query-editor/monaco-editor';
import { KvGrid } from '@/components/api-studio/kv-grid';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Wand2 } from 'lucide-react';
import type { BodyMode, RequestBody } from '@/lib/api-studio/types';

const MODES: { value: BodyMode; label: string }[] = [
  { value: 'none', label: 'No body' },
  { value: 'json', label: 'JSON' },
  { value: 'urlencoded', label: 'x-www-form-urlencoded' },
  { value: 'form-data', label: 'form-data' },
  { value: 'raw', label: 'Raw text' },
];

export function BodyEditor({
  body,
  onChange,
}: Readonly<{
  body: RequestBody;
  onChange: (next: RequestBody) => void;
}>) {
  const setMode = (mode: BodyMode) => onChange({ ...body, mode });

  const formatJson = () => {
    try {
      const parsed = JSON.parse(body.raw ?? '');
      onChange({ ...body, raw: JSON.stringify(parsed, null, 2) });
    } catch {
      /* invalid JSON; leave as-is */
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b flex items-center gap-2">
        <Select value={body.mode} onValueChange={(v) => setMode(v as BodyMode)}>
          <SelectTrigger size="sm" className="w-50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODES.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {body.mode === 'json' && (
          <Button variant="ghost" size="sm" onClick={formatJson}>
            <Wand2 className="h-3.5 w-3.5 mr-1" />
            Format
          </Button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {body.mode === 'none' && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            This request has no body. Select a mode above to add one.
          </div>
        )}
        {(body.mode === 'json' || body.mode === 'raw') && (
          <div className="h-full min-h-50">
            <MonacoEditor
              value={body.raw ?? ''}
              onChange={(v) => onChange({ ...body, raw: v ?? '' })}
              language={body.mode === 'json' ? 'json' : 'plaintext'}
            />
          </div>
        )}
        {body.mode === 'urlencoded' && (
          <div className="p-3">
            <KvGrid
              rows={body.urlencoded ?? []}
              onChange={(rows) => onChange({ ...body, urlencoded: rows })}
              keyPlaceholder="field"
              valuePlaceholder="value"
            />
          </div>
        )}
        {body.mode === 'form-data' && (
          <div className="p-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              Text fields only in v1. File uploads are on the roadmap.
            </p>
            <KvGrid
              rows={body.formData ?? []}
              onChange={(rows) => onChange({ ...body, formData: rows })}
              keyPlaceholder="field"
              valuePlaceholder="value"
            />
          </div>
        )}
      </div>
    </div>
  );
}
