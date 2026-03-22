'use client';

import { useState } from 'react';
import {
  Database,
  Trash2,
  Pencil,
  Loader2,
  Network,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConnectionConfig, DatabaseType } from '@/lib/adapters/types';

const DB_TYPE_LABEL: Record<DatabaseType, string> = {
  postgresql: 'PostgreSQL',
  mongodb: 'MongoDB',
  clickhouse: 'ClickHouse',
  redis: 'Redis',
};

interface SavedConnectionsProps {
  connections: ConnectionConfig[];
  onConnect: (connectionId: string) => void;
  onEdit: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  loadingId: string | null;
}

export function SavedConnections({
  connections,
  onConnect,
  onEdit,
  onDelete,
  loadingId,
}: SavedConnectionsProps) {
  const [editingConnection, setEditingConnection] = useState<ConnectionConfig | null>(null);
  const [editedName, setEditedName] = useState('');

  const handleSaveEdit = () => {
    if (editingConnection && editedName.trim()) {
      onEdit(editingConnection.id, editedName.trim());
      setEditingConnection(null);
      setEditedName('');
    }
  };

  if (connections.length === 0) return null;

  return (
    <>
      <div className="space-y-2">
        {connections.map((conn) => (
          <div
            key={conn.id}
            onClick={() => loadingId ? undefined : onConnect(conn.id)}
            className="flex items-center justify-between p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              {loadingId === conn.id ? (
                <Loader2 className="h-5 w-5 text-primary animate-spin shrink-0" />
              ) : (
                <Database className="h-5 w-5 text-muted-foreground shrink-0" />
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium truncate">{conn.name}</p>
                  {conn.sshTunnel?.enabled && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 shrink-0">
                      <Network className="h-3 w-3" />
                      SSH
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {DB_TYPE_LABEL[conn.type] ?? conn.type}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingConnection(conn);
                  setEditedName(conn.name);
                }}
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(conn.id);
                }}
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Edit Connection Dialog */}
      <Dialog open={!!editingConnection} onOpenChange={(open) => !open && setEditingConnection(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Connection</DialogTitle>
            <DialogDescription>Update the name for this connection.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Connection Name</Label>
              <Input
                id="edit-name"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                placeholder="My Database"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && editedName.trim()) handleSaveEdit();
                }}
              />
            </div>
            {editingConnection && (
              <div className="text-sm text-muted-foreground">
                <span className="font-medium">Type:</span>{' '}
                {DB_TYPE_LABEL[editingConnection.type] ?? editingConnection.type}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingConnection(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={!editedName.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
