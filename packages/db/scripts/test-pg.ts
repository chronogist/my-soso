/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, no-console */
import postgres from 'postgres';

const url = process.env.URL;
if (!url) throw new Error('URL not set');
console.log('connecting to', url.replace(/:[^@]+@/, ':****@'));

const sql = postgres(url, {
  max: 1,
  prepare: false,
  ssl: { rejectUnauthorized: true, servername: new URL(url).hostname },
});
try {
  const r = await sql`SELECT 1 AS ok, current_database() AS db`;
  console.log('OK', r);
} catch (e) {
  const err = e as { message?: string; code?: string; errno?: number; cause?: unknown };
  console.log('ERR', err.message, err.code, err.errno, err.cause);
} finally {
  await sql.end({ timeout: 3 });
}
