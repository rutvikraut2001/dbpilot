// Constants that can be used in both client and server components

import { DatabaseType } from './adapters/types';

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
];
