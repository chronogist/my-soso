/**
 * Lightweight migration runner: applies any *.sql file in src/migrations/
 * that has not yet been recorded in `__migrations`.
 *
 * Run: pnpm --filter @my-soso/db db:migrate
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const scriptDir = dirname(fileURLToPath(import.meta.url));

function loadEnv(path) {
  let raw;
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

const repoRoot = resolve(scriptDir, '../../..');
loadEnv(resolve(repoRoot, '.env'));

const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const databaseUrlHost = new URL(databaseUrl).hostname;
if (databaseUrlHost.includes('neon.tech')) {
  console.error(
    'DATABASE_URL_UNPOOLED still points at Neon. Replace it with the Supabase direct connection string before running migrations.',
  );
  process.exit(1);
}

if (databaseUrlHost.endsWith('.supabase.co') && databaseUrlHost.startsWith('db.')) {
  console.warn(
    'DATABASE_URL_UNPOOLED is a Supabase direct host. If this connection resets locally, use the Supabase Session pooler URL instead.',
  );
}

const migrationsDir = resolve(scriptDir, '../src/migrations');
const files = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 60,
});

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS __migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const applied = await sql`SELECT filename FROM __migrations`;
  const appliedSet = new Set(applied.map((row) => row.filename));

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
} catch (err) {
  const code = err && typeof err === 'object' && 'code' in err ? ` (${err.code})` : '';
  console.error(
    '!! migration failed:',
    err instanceof Error ? `${err.message}${code}` : String(err),
  );
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
