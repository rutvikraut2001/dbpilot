'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database, Loader2, Trash2, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useConnectionStore } from '@/lib/stores/connection';
import { supportedDatabases } from '@/lib/constants';
import { DatabaseType } from '@/lib/adapters/types';

export function ConnectionForm() {
  const router = useRouter();
  const { connections, addConnection, removeConnection, setActiveConnection } = useConnectionStore();

  const [dbType, setDbType] = useState<DatabaseType>('postgresql');
  const [connectionString, setConnectionString] = useState('');
  const [connectionName, setConnectionName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const selectedDb = supportedDatabases.find((db) => db.type === dbType);

  const handleTestConnection = async () => {
    if (!connectionString) return;

    setIsLoading(true);
    setTestResult(null);

    try {
      const response = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: dbType,
          connectionString,
        }),
      });

      const result = await response.json();
      setTestResult(result);
    } catch {
      setTestResult({
        success: false,
        message: 'Failed to test connection',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnect = async () => {
    if (!connectionString || !connectionName) return;

    setIsLoading(true);

    try {
      // Save connection and connect
      const connectionId = addConnection({
        type: dbType,
        connectionString,
        name: connectionName,
      });

      const response = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: dbType,
          connectionString,
          connectionId,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setActiveConnection(connectionId);
        router.push('/studio');
      } else {
        // Remove the connection if it failed
        removeConnection(connectionId);
        setTestResult(result);
      }
    } catch {
      setTestResult({
        success: false,
        message: 'Failed to connect',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickConnect = async (connectionId: string) => {
    const connection = connections.find((c) => c.id === connectionId);
    if (!connection) return;

    setIsLoading(true);

    try {
      const response = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: connection.type,
          connectionString: connection.connectionString,
          connectionId,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setActiveConnection(connectionId);
        router.push('/studio');
      } else {
        setTestResult(result);
      }
    } catch {
      setTestResult({
        success: false,
        message: 'Failed to connect',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteConnection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeConnection(id);
  };

  return (
    <div className="space-y-6">
      {/* Saved Connections */}
      {connections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Saved Connections</CardTitle>
            <CardDescription>Click to quickly reconnect</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {connections.map((conn) => (
                <div
                  key={conn.id}
                  onClick={() => handleQuickConnect(conn.id)}
                  className="flex items-center justify-between p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Database className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{conn.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {conn.type === 'postgresql' ? 'PostgreSQL' : 'MongoDB'}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => handleDeleteConnection(conn.id, e)}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* New Connection Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">New Connection</CardTitle>
          <CardDescription>Connect to a PostgreSQL or MongoDB database</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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

          <div className="space-y-2">
            <Label htmlFor="connection-string">Connection String</Label>
            <Input
              id="connection-string"
              type="password"
              placeholder={selectedDb?.placeholder}
              value={connectionString}
              onChange={(e) => setConnectionString(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Your connection string is stored locally and never sent to any external server.
            </p>
          </div>

          {testResult && (
            <div
              className={`flex items-center gap-2 p-3 rounded-lg ${
                testResult.success
                  ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                  : 'bg-red-500/10 text-red-600 dark:text-red-400'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <XCircle className="h-5 w-5" />
              )}
              <span className="text-sm">{testResult.message}</span>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={!connectionString || isLoading}
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Test Connection
            </Button>
            <Button
              onClick={handleConnect}
              disabled={!connectionString || !connectionName || isLoading}
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Connect
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
