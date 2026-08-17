'use client';

import { useState } from 'react';
import { AlertTriangle, Loader2, ShieldAlert } from 'lucide-react';
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
import type { StatementRisk } from '@/lib/query-guard';

export interface QueryRiskDetails extends StatementRisk {
  /**
   * Planner estimate of affected rows, or null when unavailable. Always shown as
   * approximate — it comes from table statistics, not a count.
   */
  estimatedRows: number | null;
  /** True while the estimate is still being fetched. */
  isEstimating: boolean;
}

interface DangerousQueryDialogProps {
  risk: QueryRiskDetails;
  query: string;
  environmentLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Confirmation gate for a statement that changes data.
 *
 * "warn" (a scoped write) needs a single click. "dangerous" — an unscoped
 * DELETE/UPDATE, a DROP, a TRUNCATE, a Redis FLUSHALL — requires typing the verb,
 * so it cannot be dismissed by muscle memory on a dialog you expected to say
 * something else.
 */
export function DangerousQueryDialog({
  risk,
  query,
  environmentLabel,
  onCancel,
  onConfirm,
}: Readonly<DangerousQueryDialogProps>) {
  // Mounted only while a confirmation is pending, so this starts empty for every
  // new statement without needing an effect to reset it.
  const [typed, setTyped] = useState('');

  const isDangerous = risk.level === 'dangerous';
  const requiredWord = risk.verb || 'CONFIRM';
  const canConfirm =
    !isDangerous || typed.trim().toUpperCase() === requiredWord.toUpperCase();

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isDangerous ? (
              <ShieldAlert className="h-5 w-5 text-destructive shrink-0" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
            )}
            {isDangerous ? 'Dangerous operation' : 'Confirm write'}
          </DialogTitle>
          <DialogDescription>
            {isDangerous
              ? 'Review this statement carefully. It cannot be undone.'
              : 'This statement modifies data.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {environmentLabel && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
              Running against {environmentLabel}
            </div>
          )}

          <pre className="max-h-32 overflow-auto rounded-md bg-muted px-3 py-2 text-xs font-mono whitespace-pre-wrap break-all">
            {query.trim()}
          </pre>

          <ul className="space-y-1 text-xs text-muted-foreground">
            {risk.reasons.map((reason) => (
              <li key={reason} className="flex gap-1.5">
                <span aria-hidden="true">•</span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>

          {risk.canEstimateRows && (
            <div className="rounded-md border px-3 py-2 text-xs">
              {risk.isEstimating && (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Estimating affected rows…
                </span>
              )}
              {!risk.isEstimating && risk.estimatedRows !== null && (
                <span>
                  Estimated rows affected:{' '}
                  <strong>~{risk.estimatedRows.toLocaleString()}</strong>
                  <span className="ml-1 text-muted-foreground">
                    (planner estimate, not an exact count)
                  </span>
                </span>
              )}
              {!risk.isEstimating && risk.estimatedRows === null && (
                <span className="text-muted-foreground">
                  Could not estimate how many rows this affects.
                </span>
              )}
            </div>
          )}

          {isDangerous && (
            <div className="space-y-1.5">
              <Label htmlFor="confirm-verb" className="text-xs">
                Type <strong>{requiredWord.toUpperCase()}</strong> to confirm
              </Label>
              <Input
                id="confirm-verb"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                placeholder={requiredWord.toUpperCase()}
                className="font-mono text-sm"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={isDangerous ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            {isDangerous ? `Run ${requiredWord.toUpperCase()}` : 'Run statement'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
