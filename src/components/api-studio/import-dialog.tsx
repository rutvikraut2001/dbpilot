'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useApiStudioStore } from '@/lib/stores/api-studio';
import { importPostmanV21 } from '@/lib/api-studio/importers/postman';
import { importBruno } from '@/lib/api-studio/importers/bruno';
import { importOpenApi } from '@/lib/api-studio/importers/openapi';

type Format = 'postman' | 'bruno' | 'openapi';

export function ImportDialog({
  open,
  onOpenChange,
}: Readonly<{
  open: boolean;
  onOpenChange: (o: boolean) => void;
}>) {
  const importCollection = useApiStudioStore((s) => s.importCollection);
  const [format, setFormat] = useState<Format>('postman');
  const [text, setText] = useState('');

  const handleFile = async (file: File) => {
    const t = await file.text();
    setText(t);
  };

  const run = () => {
    try {
      let c;
      if (format === 'postman') c = importPostmanV21(text);
      else if (format === 'bruno') c = importBruno(text, 'Imported request');
      else c = importOpenApi(text);
      importCollection(c);
      toast.success(`Imported "${c.name}"`);
      onOpenChange(false);
      setText('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Import collection</DialogTitle>
          <DialogDescription>
            Paste or upload a Postman v2.1 JSON, Bruno <code>.bru</code> file, or OpenAPI 3 JSON.
            YAML OpenAPI is on the roadmap.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto">
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <label className="text-xs font-medium">Format</label>
            <Select value={format} onValueChange={(v) => setFormat(v as Format)}>
              <SelectTrigger size="sm" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="postman">Postman v2.1 (.json)</SelectItem>
                <SelectItem value="bruno">Bruno (.bru)</SelectItem>
                <SelectItem value="openapi">OpenAPI 3 (.json)</SelectItem>
              </SelectContent>
            </Select>
            <input
              type="file"
              accept=".json,.bru,.txt,application/json,text/plain"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
              className="text-xs max-w-full"
            />
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste content here, or choose a file above."
            className="flex-1 min-h-40 w-full text-xs font-mono rounded-md border bg-transparent px-3 py-2 outline-none focus:border-ring"
          />
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={run} disabled={!text.trim()} className="api-gradient text-white">
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
