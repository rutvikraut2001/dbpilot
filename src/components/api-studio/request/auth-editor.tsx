'use client';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AuthConfig, AuthType } from '@/lib/api-studio/types';

const AUTH_TYPES: { value: AuthType; label: string }[] = [
  { value: 'none', label: 'No auth' },
  { value: 'bearer', label: 'Bearer token' },
  { value: 'basic', label: 'Basic auth' },
  { value: 'apiKey', label: 'API key' },
];

export function AuthEditor({
  auth,
  onChange,
}: Readonly<{
  auth: AuthConfig;
  onChange: (next: AuthConfig) => void;
}>) {
  const setType = (type: AuthType) => onChange({ ...auth, type });

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-muted-foreground">Type</label>
        <Select value={auth.type} onValueChange={(v) => setType(v as AuthType)}>
          <SelectTrigger size="sm" className="w-50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AUTH_TYPES.map((a) => (
              <SelectItem key={a.value} value={a.value}>
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {auth.type === 'none' && (
        <p className="text-xs text-muted-foreground">
          No authentication will be attached to this request.
        </p>
      )}

      {auth.type === 'bearer' && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Token</label>
          <Input
            value={auth.token ?? ''}
            onChange={(e) => onChange({ ...auth, token: e.target.value })}
            placeholder="{{accessToken}}"
            className="font-mono text-sm"
          />
          <p className="text-[11px] text-muted-foreground">
            Sent as <code>Authorization: Bearer &lt;token&gt;</code>.
          </p>
        </div>
      )}

      {auth.type === 'basic' && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Username</label>
            <Input
              value={auth.username ?? ''}
              onChange={(e) => onChange({ ...auth, username: e.target.value })}
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Password</label>
            <Input
              type="password"
              value={auth.password ?? ''}
              onChange={(e) => onChange({ ...auth, password: e.target.value })}
              className="font-mono text-sm"
            />
          </div>
        </div>
      )}

      {auth.type === 'apiKey' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Key</label>
              <Input
                value={auth.apiKey?.key ?? ''}
                onChange={(e) =>
                  onChange({
                    ...auth,
                    apiKey: {
                      key: e.target.value,
                      value: auth.apiKey?.value ?? '',
                      in: auth.apiKey?.in ?? 'header',
                    },
                  })
                }
                placeholder="X-Api-Key"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Value</label>
              <Input
                value={auth.apiKey?.value ?? ''}
                onChange={(e) =>
                  onChange({
                    ...auth,
                    apiKey: {
                      key: auth.apiKey?.key ?? '',
                      value: e.target.value,
                      in: auth.apiKey?.in ?? 'header',
                    },
                  })
                }
                placeholder="{{apiKey}}"
                className="font-mono text-sm"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Add to</label>
            <Select
              value={auth.apiKey?.in ?? 'header'}
              onValueChange={(v) =>
                onChange({
                  ...auth,
                  apiKey: {
                    key: auth.apiKey?.key ?? '',
                    value: auth.apiKey?.value ?? '',
                    in: v as 'header' | 'query',
                  },
                })
              }
            >
              <SelectTrigger size="sm" className="w-50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="header">Header</SelectItem>
                <SelectItem value="query">Query parameter</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}
