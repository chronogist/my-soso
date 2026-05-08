/* eslint-disable no-console */
import { Client } from 'pg';

const url = process.env.URL;
if (!url) throw new Error('URL not set');
console.log('connecting to', url.replace(/:[^@]+@/, ':****@'));

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');
const c = new Client({ connectionString: url });
try {
  await c.connect();
  const r = await c.query('SELECT 1 AS ok, current_database() AS db');
  console.log('OK', r.rows);
} catch (e) {
  const err = e as { message?: string; code?: string; errno?: number };
  console.log('ERR', err.message, err.code, err.errno);
} finally {
  await c.end().catch(() => undefined);
}
