'use client';

import type { HttpMethod } from '@/lib/api-studio/types';
import { METHOD_COLORS } from '@/lib/api-studio/constants';
import { cn } from '@/lib/utils';

export function MethodPill({
  method,
  className,
}: Readonly<{
  method: HttpMethod;
  className?: string;
}>) {
  const c = METHOD_COLORS[method];
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded text-[10px] font-bold font-mono px-1.5 py-0.5 border',
        c.text,
        c.bg,
        c.border,
        className
      )}
    >
      {method}
    </span>
  );
}
