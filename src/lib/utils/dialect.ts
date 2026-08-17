import { DatabaseType, QueryDialect } from '@/lib/adapters/types';

/**
 * Map a connection type to its query dialect.
 *
 * The server reads this off the adapter; the client only has the connection
 * type, and needs it to assess a statement's risk before sending anything.
 */
export function dialectForConnection(type: DatabaseType): QueryDialect {
  switch (type) {
    case 'mongodb':
      return 'mongodb';
    case 'redis':
      return 'redis';
    default:
      return 'sql';
  }
}
