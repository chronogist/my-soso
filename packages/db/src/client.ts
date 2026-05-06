import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = ReturnType<typeof createDb>;

export interface CreateDbOptions {
  url: string;
  max?: number;
  idleTimeout?: number;
}

export function createDb(opts: CreateDbOptions) {
  const client = postgres(opts.url, {
    max: opts.max ?? 10,
    idle_timeout: opts.idleTimeout ?? 30,
    prepare: false,
  });
  return drizzle(client, { schema });
}
