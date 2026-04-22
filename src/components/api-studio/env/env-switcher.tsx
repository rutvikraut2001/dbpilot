'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Globe } from 'lucide-react';
import { useApiStudioStore } from '@/lib/stores/api-studio';

const NO_ENV = '__none__';

export function EnvSwitcher() {
  const environments = useApiStudioStore((s) => s.environments);
  const activeId = useApiStudioStore((s) => s.activeEnvironmentId);
  const setActive = useApiStudioStore((s) => s.setActiveEnvironment);

  return (
    <Select
      value={activeId ?? NO_ENV}
      onValueChange={(v) => setActive(v === NO_ENV ? null : v)}
    >
      <SelectTrigger size="sm" className="w-56">
        <div className="flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5 text-[var(--color-api-mid)]" />
          <SelectValue placeholder="No environment" />
        </div>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_ENV}>No environment</SelectItem>
        {environments.map((e) => (
          <SelectItem key={e.id} value={e.id}>
            {e.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
