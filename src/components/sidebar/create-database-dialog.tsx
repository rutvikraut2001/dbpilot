'use client';

import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
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
import { useActiveConnection } from '@/lib/stores/connection';
import { apiFetch, errorMessage } from '@/lib/utils/api-client';
import type { DatabaseType } from '@/lib/adapters/types';

interface CreateDatabaseDialogProps {
  databaseType: DatabaseType;
  existingNames: string[];
  onCancel: () => void;
  onCreated: (name: string) => void | Promise<void>;
}

/** MongoDB rejects these outright — there is no quoting form to fall back on. */
const MONGO_FORBIDDEN = /[/\\. "$*<>:|?]/;

export function CreateDatabaseDialog({
  databaseType,
  existingNames,
  onCancel,
  onCreated,
}: Readonly<CreateDatabaseDialogProps>) {
  const activeConnection = useActiveConnection();

  const [name, setName] = useState('');
  const [initialCollection, setInitialCollection] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isMongo = databaseType === 'mongodb';
  const trimmed = name.trim();

  const nameTaken = existingNames.includes(trimmed);
  const mongoInvalid = isMongo && MONGO_FORBIDDEN.test(trimmed);
  // MongoDB has no CREATE DATABASE — the database begins to exist when its
  // first collection does, so this is required rather than optional.
  const needsCollection = isMongo && !initialCollection.trim();

  const canSubmit =
    trimmed.length > 0 &&
    !nameTaken &&
    !mongoInvalid &&
    !needsCollection &&
    !isSubmitting;

  const submit = async () => {
    if (!canSubmit || !activeConnection) return;

    setIsSubmitting(true);
    try {
      await apiFetch('/api/databases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: activeConnection.id,
          name: trimmed,
          ...(isMongo ? { initialCollection: initialCollection.trim() } : {}),
        }),
      });

      toast.success(`Created database ${trimmed}`);
      await onCreated(trimmed);
    } catch (err) {
      // Kept open: the engine's complaint is usually about this form's contents,
      // so discarding them would mean retyping to change one field.
      toast.error('Could not create database', {
        description: errorMessage(err),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !isSubmitting) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 shrink-0" />
            Create database
          </DialogTitle>
          <DialogDescription>
            {isMongo
              ? 'MongoDB creates a database when its first collection is added, so both names are needed.'
              : 'The new database will be empty, and this connection will switch to it.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-database-name">Name</Label>
            <Input
              id="new-database-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={isMongo ? 'analytics' : 'my_app_dev'}
              autoComplete="off"
              autoFocus
              className="font-mono text-sm"
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit();
              }}
            />
            {nameTaken && (
              <p className="text-xs text-destructive">
                A database called {trimmed} already exists on this server.
              </p>
            )}
            {mongoInvalid && (
              <p className="text-xs text-destructive">
                A MongoDB database name cannot contain / \ . &quot; $ * &lt; &gt; : | ?
                or a space.
              </p>
            )}
          </div>

          {isMongo && (
            <div className="space-y-1.5">
              <Label htmlFor="new-database-collection">First collection</Label>
              <Input
                id="new-database-collection"
                value={initialCollection}
                onChange={(event) => setInitialCollection(event.target.value)}
                placeholder="events"
                autoComplete="off"
                className="font-mono text-sm"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submit();
                }}
              />
              <p className="text-xs text-muted-foreground">
                Without a collection the database would disappear again on the
                next refresh.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
