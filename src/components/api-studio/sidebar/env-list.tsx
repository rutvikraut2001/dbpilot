'use client';

import { useState } from 'react';
import { Plus, Trash2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useApiStudioStore } from '@/lib/stores/api-studio';
import { cn } from '@/lib/utils';
import { EnvEditorDialog } from '../env/env-editor-dialog';

export function EnvList() {
  const environments = useApiStudioStore((s) => s.environments);
  const addEnvironment = useApiStudioStore((s) => s.addEnvironment);
  const deleteEnvironment = useApiStudioStore((s) => s.deleteEnvironment);
  const setActive = useApiStudioStore((s) => s.setActiveEnvironment);
  const activeId = useApiStudioStore((s) => s.activeEnvironmentId);

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const create = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const id = addEnvironment(trimmed);
    setNewName('');
    setEditingId(id);
  };

  return (
    <div className="p-2 space-y-2">
      <div className="flex items-center gap-1">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') create();
          }}
          placeholder="New environment name"
          className="h-8 text-sm"
        />
        <Button size="sm" variant="outline" onClick={create} disabled={!newName.trim()}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      {environments.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">
          No environments yet.
        </p>
      )}
      <div className="space-y-1">
        {environments.map((e) => {
          const active = activeId === e.id;
          return (
            <div
              key={e.id}
              className={cn(
                'group flex items-center gap-2 px-2 py-1.5 rounded border text-sm',
                active ? 'api-border bg-[var(--color-api-start)]/10' : 'border-transparent'
              )}
            >
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setActive(active ? null : e.id)}
                aria-label={active ? 'Deactivate' : 'Activate'}
                className={cn(active && 'text-[var(--color-api-mid)]')}
              >
                {active ? <Check className="h-3.5 w-3.5" /> : <span className="h-3.5 w-3.5 rounded-full border" />}
              </Button>
              <button
                type="button"
                onClick={() => setEditingId(e.id)}
                className="flex-1 text-left truncate"
              >
                {e.name}
                <span className="ml-1 text-[10px] text-muted-foreground">
                  ({e.variables.length})
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => deleteEnvironment(e.id)}
                aria-label="Delete environment"
                className="opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
      {editingId && (
        <EnvEditorDialog
          environmentId={editingId}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}
