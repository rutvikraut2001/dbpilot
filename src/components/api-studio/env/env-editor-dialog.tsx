'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { KvGrid } from '../kv-grid';
import { useApiStudioStore } from '@/lib/stores/api-studio';
import type { KV } from '@/lib/api-studio/types';

export function EnvEditorDialog({
  environmentId,
  onClose,
}: Readonly<{
  environmentId: string;
  onClose: () => void;
}>) {
  const environment = useApiStudioStore((s) =>
    s.environments.find((e) => e.id === environmentId)
  );
  const updateEnvironment = useApiStudioStore((s) => s.updateEnvironment);

  const [name, setName] = useState(environment?.name ?? '');
  const [vars, setVars] = useState<KV[]>(environment?.variables ?? []);

  if (!environment) return null;

  const save = () => {
    updateEnvironment(environmentId, { name: name.trim() || environment.name, variables: vars });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Edit environment</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto">
          <div className="space-y-1.5 shrink-0">
            <label className="text-xs font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5 flex-1 min-h-0 flex flex-col">
            <label className="text-xs font-medium">Variables</label>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <KvGrid rows={vars} onChange={setVars} keyPlaceholder="variable" valuePlaceholder="value" showDescription />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Reference in requests with <code>{'{{name}}'}</code>. Captures write here on send.
            </p>
          </div>
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} className="api-gradient text-white">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
