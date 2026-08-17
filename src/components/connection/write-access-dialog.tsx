'use client';

import { useState } from 'react';
import { ShieldAlert, ShieldOff } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const DURATIONS = [5, 15, 30, 60, 120] as const;

interface WriteAccessDialogProps {
  connectionName: string;
  /** Production connections require a reason before writes are granted. */
  requireReason: boolean;
  onCancel: () => void;
  onConfirm: (options: { durationMinutes: number; reason?: string }) => void;
}

/**
 * Grants write access for a bounded window rather than indefinitely.
 *
 * The expiry is enforced by the server, so closing the tab or editing local
 * state does not extend it — this dialog only chooses the duration.
 */
export function WriteAccessDialog({
  connectionName,
  requireReason,
  onCancel,
  onConfirm,
}: Readonly<WriteAccessDialogProps>) {
  // Mounted only while the dialog is open, so these start at their defaults each
  // time rather than needing an effect to reset them.
  const [durationMinutes, setDurationMinutes] = useState<number>(15);
  const [reason, setReason] = useState('');

  const canConfirm = !requireReason || reason.trim().length > 0;

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldOff className="h-5 w-5 text-amber-500 shrink-0" />
            Enable write access
          </DialogTitle>
          <DialogDescription>
            Writes will be enabled on <strong>{connectionName}</strong> for a
            limited time, then revert automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {requireReason && (
            <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              <p className="text-xs text-red-700 dark:text-red-400">
                This is a production connection.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="write-duration">Duration</Label>
            <Select
              value={String(durationMinutes)}
              onValueChange={(v) => setDurationMinutes(Number(v))}
            >
              <SelectTrigger id="write-duration">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATIONS.map((minutes) => (
                  <SelectItem key={minutes} value={String(minutes)}>
                    {minutes} minutes
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="write-reason">
              Reason{' '}
              <span className="text-muted-foreground">
                {requireReason ? '(required)' : '(optional)'}
              </span>
            </Label>
            <Input
              id="write-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Fixing a stuck order record"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Recorded in the audit log alongside the grant.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={!canConfirm}
            onClick={() =>
              onConfirm({
                durationMinutes,
                reason: reason.trim() || undefined,
              })
            }
          >
            Enable for {durationMinutes} min
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
