import 'server-only';

import { DatabaseAdapter, DatabaseType } from './types';
import { PostgresAdapter } from './postgres';
import { MongoDBAdapter } from './mongodb';

// Adapter cache to reuse connections
const adapterCache = new Map<string, DatabaseAdapter>();

export function createAdapter(type: DatabaseType, connectionString: string): DatabaseAdapter {
  switch (type) {
    case 'postgresql':
      return new PostgresAdapter(connectionString);
    case 'mongodb':
      return new MongoDBAdapter(connectionString);
    default:
      throw new Error(`Unsupported database type: ${type}`);
  }
}

export function getOrCreateAdapter(id: string, type: DatabaseType, connectionString: string): DatabaseAdapter {
  if (adapterCache.has(id)) {
    return adapterCache.get(id)!;
  }

  const adapter = createAdapter(type, connectionString);
  adapterCache.set(id, adapter);
  return adapter;
}

export function getCachedAdapter(id: string): DatabaseAdapter | undefined {
  return adapterCache.get(id);
}

export async function removeAdapter(id: string): Promise<void> {
  const adapter = adapterCache.get(id);
  if (adapter) {
    await adapter.disconnect();
    adapterCache.delete(id);
  }
}

export async function clearAllAdapters(): Promise<void> {
  const disconnectPromises = Array.from(adapterCache.values()).map((adapter) =>
    adapter.disconnect().catch(console.error)
  );
  await Promise.all(disconnectPromises);
  adapterCache.clear();
}
