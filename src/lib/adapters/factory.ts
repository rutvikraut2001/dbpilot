import 'server-only';

import { DatabaseAdapter, DatabaseType, SSHTunnelConfig } from './types';
import { PostgresAdapter } from './postgres';
import { MongoDBAdapter } from './mongodb';
import { ClickHouseAdapter } from './clickhouse';
import { RedisAdapter } from './redis';
import { SSHTunnel } from './tunnel';
import { schemaCache } from '../cache';
import {
  redirectToTunnel,
  parseHostname,
  parsePort,
  DB_DEFAULT_PORTS,
} from '../utils/connection-string';

// Persist caches on globalThis so they survive HMR recompilation in dev mode.
// In production this is equivalent to a plain module-level variable.
const globalForAdapters = globalThis as unknown as {
  __adapterCache?: Map<string, DatabaseAdapter>;
  __tunnelCache?: Map<string, SSHTunnel>;
};

const adapterCache = (globalForAdapters.__adapterCache ??= new Map<string, DatabaseAdapter>());
const tunnelCache = (globalForAdapters.__tunnelCache ??= new Map<string, SSHTunnel>());

export function createAdapter(type: DatabaseType, connectionString: string): DatabaseAdapter {
  switch (type) {
    case 'postgresql':
      return new PostgresAdapter(connectionString);
    case 'mongodb':
      return new MongoDBAdapter(connectionString);
    case 'clickhouse':
      return new ClickHouseAdapter(connectionString);
    case 'redis':
      return new RedisAdapter(connectionString);
    default:
      throw new Error(`Unsupported database type: ${type}`);
  }
}

/**
 * Connect an adapter with exponential backoff retry.
 */
export async function connectWithRetry(
  adapter: DatabaseAdapter,
  options: { maxRetries?: number; baseDelayMs?: number } = {}
): Promise<void> {
  const { maxRetries = 3, baseDelayMs = 500 } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await adapter.connect();
      return;
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Set up an SSH tunnel and return the effective connection string
 * redirected through the tunnel's local port.
 */
export async function setupTunnel(
  id: string,
  type: DatabaseType,
  connectionString: string,
  sshConfig: SSHTunnelConfig
): Promise<string> {
  // Close existing tunnel for this connection if any
  const existing = tunnelCache.get(id);
  if (existing) {
    await existing.close();
    tunnelCache.delete(id);
  }

  const remoteHost = sshConfig.remoteHost || parseHostname(connectionString);
  const remotePort = sshConfig.remotePort || parsePort(connectionString, DB_DEFAULT_PORTS[type] ?? 5432);

  const tunnel = new SSHTunnel({ ...sshConfig, remoteHost, remotePort });
  const localPort = await tunnel.connect();

  tunnelCache.set(id, tunnel);
  return redirectToTunnel(connectionString, localPort);
}

export async function getOrCreateAdapter(
  id: string,
  type: DatabaseType,
  connectionString: string,
  sshTunnel?: SSHTunnelConfig
): Promise<DatabaseAdapter> {
  if (adapterCache.has(id)) {
    return adapterCache.get(id)!;
  }

  let effectiveConnectionString = connectionString;

  if (sshTunnel?.enabled) {
    effectiveConnectionString = await setupTunnel(id, type, connectionString, sshTunnel);
  }

  const adapter = createAdapter(type, effectiveConnectionString);
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
    // Clear cached schema data for this connection
    schemaCache.clearConnection(id);
  }

  // Close SSH tunnel if any
  const tunnel = tunnelCache.get(id);
  if (tunnel) {
    await tunnel.close().catch(console.error);
    tunnelCache.delete(id);
  }
}

export async function clearAllAdapters(): Promise<void> {
  const disconnectPromises = Array.from(adapterCache.values()).map((adapter) =>
    adapter.disconnect().catch(console.error)
  );
  await Promise.all(disconnectPromises);
  adapterCache.clear();

  const tunnelPromises = Array.from(tunnelCache.values()).map((tunnel) =>
    tunnel.close().catch(console.error)
  );
  await Promise.all(tunnelPromises);
  tunnelCache.clear();

  // Clear all cached schema data
  schemaCache.clear();
}
