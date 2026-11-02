import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export function createDatabaseClient(connectionString?: string) {
  const connStr = connectionString || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:54329/ponpes_finance';

  const client = postgres(connStr, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDatabaseClient>;

let _instance: Database | null = null;
export function getDb(): Database {
  if (!_instance) {
    _instance = createDatabaseClient();
  }
  return _instance;
}

export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    return (getDb() as any)[prop];
  }
});
