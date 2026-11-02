import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export function createDatabaseClient(connectionString?: string) {
  const connStr = connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    throw new Error('DATABASE_URL environment variable is required to create database client');
  }

  const client = postgres(connStr, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDatabaseClient>;
