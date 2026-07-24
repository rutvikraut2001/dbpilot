// Constants that can be used in both client and server components

import { DatabaseType } from './adapters/types';

// Custom MIME type used when dragging a table from the sidebar onto the schema canvas.
export const TABLE_DRAG_MIME = 'application/db-studio-table';

export const supportedDatabases: { type: DatabaseType; name: string; placeholder: string }[] = [
  {
    type: 'postgresql',
    name: 'PostgreSQL',
    placeholder: 'postgresql://user:password@localhost:5432/dbname',
  },
  {
    type: 'mongodb',
    name: 'MongoDB',
    placeholder: 'mongodb://user:password@localhost:27017/dbname',
  },
  {
    type: 'clickhouse',
    name: 'ClickHouse',
    placeholder: 'clickhouse://default:password@localhost:8123/default',
  },
  {
    type: 'redis',
    name: 'Redis',
    placeholder: 'redis://user:password@localhost:6379/0',
  },
];
