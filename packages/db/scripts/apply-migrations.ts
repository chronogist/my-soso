/**
 * Lightweight migration runner: applies any *.sql file in src/migrations/
 * that has not yet been recorded in `__migrations` (a tiny tracking
 * table this script creates on first run).
 *
 * Run: pnpm --filter @my-soso/db exec tsx scripts/apply-migrations.ts
 *
 * The drizzle-kit migrate runner requires the meta/_journal.json that
 * drizzle-kit generate produces; this project's migrations are written
 * by hand so we ship our own minimal runner instead.
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, no-console */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

function loadEnv(path: string): void {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}

const repoRoot = resolve(import.meta.dirname, '../../..');
loadEnv(resolve(repoRoot, '.env'));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const migrationsDir = resolve(import.meta.dirname, '../src/migrations');
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const sql = postgres(databaseUrl, { max: 1, prepare: false });

async function main(): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS __migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const applied = await sql<{ filename: string }[]>`SELECT filename FROM __migrations`;
  const appliedSet = new Set(applied.map((r) => r.filename));

  let count = 0;
  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`-- skip   ${file}`);
      continue;
    }
    const body = readFileSync(resolve(migrationsDir, file), 'utf8');
    console.log(`-- apply  ${file}`);
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO __migrations (filename) VALUES (${file})`;
      });
      count++;
    } catch (err) {
      console.error(`!! failed ${file}:`, err instanceof Error ? err.message : err);
      throw err;
    }
  }
  console.log(`-- done   ${count} new migration(s) applied, ${appliedSet.size} previously`);
}

try {
  await main();
} finally {
  await sql.end({ timeout: 5 });
}
