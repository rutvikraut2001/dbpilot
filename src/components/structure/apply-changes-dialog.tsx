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
import { isProduction } from '@/lib/utils/environment';
import type { ConnectionEnvironment } from '@/lib/adapters/types';

export interface ChangePlan {
  statements: string[];
  atomic: boolean;
  warnings: string[];
  destructive: boolean;
}

interface ApplyChangesDialogProps {
  plan: ChangePlan;
  table: string;
  environmentLabel?: ConnectionEnvironment;
  isApplying: boolean;
  onCancel: () => void;
  onApply: () => void;
}

/**
 * Review the exact statements before they run.
 *
 * The SQL is the subject of this dialog, not a footnote to it: a description
 * like "change qty to bigint" hides whether the not-null constraint survives,
 * where the statement does not. A destructive edit additionally requires typing
 * APPLY, so it cannot be dismissed by muscle memory.
 */
export function ApplyChangesDialog({
  plan,
  table,
  environmentLabel,
  isApplying,
  onCancel,
  onApply,
}: Readonly<ApplyChangesDialogProps>) {
  const [typed, setTyped] = useState('');

  const production = environmentLabel ? isProduction(environmentLabel) : false;
  const needsTyping = plan.destructive || production;
  const canApply =
    (!needsTyping || typed.trim().toUpperCase() === 'APPLY') && !isApplying;

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !isApplying) onCancel(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {plan.destructive ? (
              <ShieldAlert className="h-5 w-5 shrink-0 text-destructive" />
            ) : (
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
            )}
            {plan.destructive ? 'Destructive change' : 'Apply changes'}
          </DialogTitle>
          <DialogDescription>
            {plan.statements.length}{' '}
            {plan.statements.length === 1 ? 'statement' : 'statements'} against{' '}
            <code className="font-mono">{table}</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {production && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Running against production.
            </div>
          )}

          <pre className="max-h-56 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all">
            {plan.statements.map((statement) => `${statement};`).join('\n')}
          </pre>

          {/* Whether a half-applied edit is possible changes what the user is
              agreeing to, so it is stated rather than left to be discovered. */}
          <p className="text-xs text-muted-foreground">
            {plan.atomic
              ? 'These run in one transaction — if any statement fails, none of them take effect.'
              : 'This engine commits each statement as it runs. If one fails, the changes before it stay applied.'}
          </p>

          {plan.warnings.length > 0 && (
            <ul className="space-y-1">
              {plan.warnings.map((warning) => (
                <li
                  key={warning}
                  className="flex items-start gap-1.5 rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-400"
                >
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          )}

          {needsTyping && (
            <div className="space-y-1.5">
              <Label htmlFor="apply-confirm">
                Type <span className="font-mono font-semibold">APPLY</span> to
                confirm
              </Label>
              <Input
                id="apply-confirm"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                autoFocus
                className="font-mono"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canApply) onApply();
                }}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isApplying}>
            Cancel
          </Button>
          <Button
            variant={plan.destructive ? 'destructive' : 'default'}
            onClick={onApply}
            disabled={!canApply}
          >
            {isApplying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
