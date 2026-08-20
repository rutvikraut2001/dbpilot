'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface SaveQueryDialogProps {
  query: string;
  onCancel: () => void;
  onSave: (name: string) => void;
}

/**
 * Name a query before keeping it.
 *
 * A real dialog rather than `window.prompt`: native modals block the event loop,
 * cannot be styled or made accessible, and are inconsistent with every other
 * prompt in the app.
 */
export function SaveQueryDialog({
  query,
  onCancel,
  onSave,
}: Readonly<SaveQueryDialogProps>) {
  // Mounted only while open, so this seeds itself once per invocation.
  const [name, setName] = useState(() =>
    query.replace(/\s+/g, ' ').trim().slice(0, 60)
  );

  const trimmed = name.trim();

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="h-5 w-5 text-amber-500 shrink-0" />
            Save query
          </DialogTitle>
          <DialogDescription>
            Saved queries are kept across connections and reloads.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="saved-query-name">Name</Label>
            <Input
              id="saved-query-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && trimmed) onSave(trimmed);
              }}
            />
          </div>

          <pre className="max-h-28 overflow-auto rounded-md bg-muted px-3 py-2 text-xs font-mono whitespace-pre-wrap break-all">
            {query.trim()}
          </pre>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!trimmed} onClick={() => onSave(trimmed)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
