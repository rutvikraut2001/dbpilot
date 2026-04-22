'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

/**
 * Minimal native checkbox styled to match the design system.
 * A fuller @radix-ui/react-checkbox wrapper would be nice, but the
 * existing ui/ folder doesn't include one and this keeps dependencies flat.
 */
export function Checkbox({ checked, onChange, disabled, className, ...rest }: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={rest['aria-label']}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'h-4 w-4 shrink-0 rounded-sm border flex items-center justify-center transition-colors',
        checked
          ? 'bg-primary border-primary text-primary-foreground'
          : 'bg-background border-input hover:border-primary/60',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
    </button>
  );
}
