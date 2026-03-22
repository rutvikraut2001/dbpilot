'use client';

import { useState } from 'react';
import {
  Loader2,
  ChevronDown,
  ChevronUp,
  Network,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useConnectionStore } from '@/lib/stores/connection';
import { supportedDatabases } from '@/lib/constants';
import { DatabaseType, SSHTunnelConfig } from '@/lib/adapters/types';
import { toast } from 'sonner';

const DEFAULT_SSH_TUNNEL: SSHTunnelConfig = {
  enabled: false,
  host: '',
  port: 22,
  username: '',
  authMethod: 'password',
  password: '',
  privateKey: '',
  passphrase: '',
  remoteHost: '',
  remotePort: undefined,
};

interface ConnectionFormProps {
  onConnected?: () => void;
}

export function ConnectionForm({ onConnected }: ConnectionFormProps) {
  const { addConnection, removeConnection, updateConnection, setActiveConnection } =
    useConnectionStore();

  const [dbType, setDbType] = useState<DatabaseType>('postgresql');
  const [connectionString, setConnectionString] = useState('');
  const [connectionName, setConnectionName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sshTunnel, setSshTunnel] = useState<SSHTunnelConfig>(DEFAULT_SSH_TUNNEL);

  const selectedDb = supportedDatabases.find((db) => db.type === dbType);

  const updateSsh = (updates: Partial<SSHTunnelConfig>) => {
    setSshTunnel((prev) => ({ ...prev, ...updates }));
  };

  const buildRequestBody = (overrides?: Partial<{ connectionId: string; readOnly: boolean }>) => ({
    type: dbType,
    connectionString,
    sshTunnel: sshTunnel.enabled ? sshTunnel : undefined,
    ...overrides,
  });

  const handleTestConnection = async () => {
    if (!connectionString) return;

    setIsLoading(true);

    try {
      const response = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequestBody()),
      });

      const result = await response.json();
      if (result.success) {
        toast.success('Connection successful', {
          description: result.message,
        });
      } else {
        toast.error(result.message || 'Connection failed', {
          description: result.diagnostics?.suggestions?.join('. ') || undefined,
          duration: 8000,
        });
      }
    } catch {
      toast.error('Failed to test connection');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnect = async () => {
    if (!connectionString || !connectionName) return;

    setIsLoading(true);

    try {
      const connectionId = addConnection({
        type: dbType,
        connectionString,
        name: connectionName,
        sshTunnel: sshTunnel.enabled ? sshTunnel : undefined,
      });

      const response = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequestBody({ connectionId })),
      });

      const result = await response.json();

      if (result.success) {
        if (result.effectiveConnectionString) {
          updateConnection(connectionId, { connectionString: result.effectiveConnectionString });
        }
        setActiveConnection(connectionId);
        toast.success('Connected successfully');
        onConnected?.();
      } else {
        removeConnection(connectionId);
        toast.error(result.message || 'Connection failed', {
          description: result.diagnostics?.suggestions?.join('. ') || undefined,
          duration: 8000,
        });
      }
    } catch {
      toast.error('Failed to connect');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="db-type">Database Type</Label>
          <Select value={dbType} onValueChange={(v) => setDbType(v as DatabaseType)}>
            <SelectTrigger id="db-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {supportedDatabases.map((db) => (
                <SelectItem key={db.type} value={db.type}>
                  {db.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="connection-name">Connection Name</Label>
          <Input
            id="connection-name"
            placeholder="My Database"
            value={connectionName}
            onChange={(e) => setConnectionName(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="connection-string">Connection String</Label>
        <Input
          id="connection-string"
          type="text"
          placeholder={selectedDb?.placeholder}
          value={connectionString}
          onChange={(e) => setConnectionString(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Stored locally, never sent to external servers.
          {!sshTunnel.enabled && (
            <> Multiple connection strategies tried automatically.</>
          )}
        </p>
      </div>

      {/* Advanced / SSH Tunnel Section */}
      <div className="border rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
        >
          <span className="flex items-center gap-2">
            <Network className="h-4 w-4 text-muted-foreground" />
            Advanced — SSH Tunnel
            {sshTunnel.enabled && (
              <span className="px-1.5 py-0.5 rounded text-xs bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                Enabled
              </span>
            )}
          </span>
          {showAdvanced ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {showAdvanced && (
          <div className="px-4 pb-4 pt-2 space-y-4 border-t bg-muted/20">
            {/* SSH Enable Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Enable SSH Tunnel</p>
                <p className="text-xs text-muted-foreground">
                  Connect through a remote SSH jump server
                </p>
              </div>
              <Switch
                checked={sshTunnel.enabled}
                onCheckedChange={(checked) => updateSsh({ enabled: checked })}
              />
            </div>

            {sshTunnel.enabled && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="ssh-host" className="text-xs">SSH Host</Label>
                    <Input
                      id="ssh-host"
                      placeholder="ssh.example.com"
                      value={sshTunnel.host}
                      onChange={(e) => updateSsh({ host: e.target.value })}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ssh-port" className="text-xs">Port</Label>
                    <Input
                      id="ssh-port"
                      type="number"
                      placeholder="22"
                      value={sshTunnel.port}
                      onChange={(e) => updateSsh({ port: parseInt(e.target.value) || 22 })}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ssh-username" className="text-xs">SSH Username</Label>
                  <Input
                    id="ssh-username"
                    placeholder="ubuntu"
                    value={sshTunnel.username}
                    onChange={(e) => updateSsh({ username: e.target.value })}
                    className="h-8 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ssh-auth-method" className="text-xs">Authentication</Label>
                  <Select
                    value={sshTunnel.authMethod}
                    onValueChange={(v) =>
                      updateSsh({ authMethod: v as 'password' | 'privateKey' })
                    }
                  >
                    <SelectTrigger id="ssh-auth-method" className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="password">Password</SelectItem>
                      <SelectItem value="privateKey">Private Key</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {sshTunnel.authMethod === 'password' ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="ssh-password" className="text-xs">SSH Password</Label>
                    <Input
                      id="ssh-password"
                      type="password"
                      placeholder="••••••••"
                      value={sshTunnel.password ?? ''}
                      onChange={(e) => updateSsh({ password: e.target.value })}
                      className="h-8 text-sm"
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="ssh-private-key" className="text-xs">Private Key (PEM)</Label>
                      <textarea
                        id="ssh-private-key"
                        placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----"
                        value={sshTunnel.privateKey ?? ''}
                        onChange={(e) => updateSsh({ privateKey: e.target.value })}
                        rows={5}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ssh-passphrase" className="text-xs">
                        Passphrase <span className="text-muted-foreground">(optional)</span>
                      </Label>
                      <Input
                        id="ssh-passphrase"
                        type="password"
                        placeholder="Key passphrase"
                        value={sshTunnel.passphrase ?? ''}
                        onChange={(e) => updateSsh({ passphrase: e.target.value })}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                )}

                {/* Optional override for remote host/port */}
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    Remote DB Host{' '}
                    <span className="text-muted-foreground">(optional override)</span>
                  </Label>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <Input
                        placeholder="Auto from connection string"
                        value={sshTunnel.remoteHost ?? ''}
                        onChange={(e) => updateSsh({ remoteHost: e.target.value || undefined })}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Input
                        type="number"
                        placeholder="Auto"
                        value={sshTunnel.remotePort ?? ''}
                        onChange={(e) =>
                          updateSsh({
                            remotePort: e.target.value ? parseInt(e.target.value) : undefined,
                          })
                        }
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Host and port of the DB as seen from the SSH server. Auto-detected from
                    your connection string if left empty.
                  </p>
                </div>

                <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-500/10 border border-amber-500/20">
                  <span className="text-amber-600 dark:text-amber-400 text-xs leading-relaxed">
                    SSH credentials are stored locally in your browser. The connection string
                    should describe the database as accessible from the SSH server (e.g.{' '}
                    <code className="font-mono">localhost:5432</code> if DB is on the same
                    machine as the SSH server).
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          onClick={handleTestConnection}
          disabled={!connectionString || isLoading}
          className="w-full"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Test Connection
        </Button>
        <Button
          onClick={handleConnect}
          disabled={!connectionString || !connectionName || isLoading}
          className="w-full"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Connect
        </Button>
      </div>
    </div>
  );
}
