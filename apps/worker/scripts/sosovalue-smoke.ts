/**
 * One-off integration smoke test for the live SoSoValue API.
 * Run: pnpm --filter @my-soso/worker exec tsx scripts/sosovalue-smoke.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SoSoValueProvider } from '@my-soso/providers';

// Tiny .env loader so the script doesn't take a dotenv dependency.
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

const apiKey = process.env.SOSOVALUE_API_KEY;
if (!apiKey) {
  console.error('SOSOVALUE_API_KEY not found in .env');
  process.exit(1);
}

const provider = new SoSoValueProvider({
  apiKey,
  ...(process.env.SOSOVALUE_BASE_URL ? { baseUrl: process.env.SOSOVALUE_BASE_URL } : {}),
});

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  const t0 = Date.now();
  try {
    const result = await fn();
    console.log(`✓ ${name}  (${Date.now() - t0}ms)`);
    return result;
  } catch (err) {
    console.log(`✗ ${name}  (${Date.now() - t0}ms)`);
    console.error('  ', err instanceof Error ? `${err.name}: ${err.message}` : err);
    if (err instanceof Error && err.cause) console.error('   cause:', err.cause);
    return null;
  }
}

async function main(): Promise<void> {
  console.log('SoSoValue smoke test');
  console.log('--------------------');

  const btcPrice = await step('getPrice("BTC")', () => provider.getPrice('BTC'));
  if (btcPrice) {
    console.log('  symbol:', btcPrice.symbol);
    console.log('  price:', btcPrice.price);
    console.log('  change24hPct:', btcPrice.change24hPct);
    console.log('  marketCapUsd:', btcPrice.marketCapUsd);
    console.log('  volume24hUsd:', btcPrice.volume24hUsd);
  }
  console.log();

  const ethPrice = await step('getPrice("ETH")', () => provider.getPrice('ETH'));
  if (ethPrice) {
    console.log('  price:', ethPrice.price, '  change24h:', ethPrice.change24hPct);
  }
  console.log();

  const batch = await step('getPrices(["BTC","ETH","SOL"])', () =>
    provider.getPrices(['BTC', 'ETH', 'SOL']),
  );
  if (batch) {
    for (const [sym, p] of batch) console.log(`  ${sym}: $${p.price}`);
  }
  console.log();

  const news = await step('getNewsForAsset("BTC", {limit:3})', () =>
    provider.getNewsForAsset('BTC', { limit: 3 }),
  );
  if (news) {
    console.log(`  got ${news.length} item(s)`);
    news.forEach((n, i) => {
      console.log(`  [${i + 1}] ${n.title}`);
      console.log(`      published: ${n.publishedAt.toISOString()}`);
      console.log(`      symbols: ${n.symbols.join(', ')}`);
    });
  }
  console.log();

  const latest = await step('getLatestNews({limit:2})', () => provider.getLatestNews({ limit: 2 }));
  if (latest) {
    console.log(`  got ${latest.length} item(s)`);
    latest.forEach((n) => console.log(`  - ${n.title}`));
  }
  console.log();

  const unknown = await step(
    'getPrice("DEFINITELY_NOT_A_TICKER")  (expect UnknownSymbolError)',
    () => provider.getPrice('DEFINITELY_NOT_A_TICKER'),
  );
  if (unknown) {
    console.log('  unexpected: got a price for a fake symbol');
  }
  console.log();

  const indices = await step('listIndices()', () => provider.listIndices());
  if (indices) {
    console.log(
      `  got ${indices.length} indices: ${indices.slice(0, 5).join(', ')}${indices.length > 5 ? ' …' : ''}`,
    );
  }
  console.log();

  if (indices && indices.length > 0) {
    const first = indices[0];
    const idx = await step(`getIndex("${first}")`, () => provider.getIndex(first));
    if (idx) {
      console.log('  value:', idx.value, '  change24hPct:', idx.change24hPct);
    }
    console.log();
  }

  const etf = await step('getETFFlow("IBIT")  (BlackRock spot BTC ETF)', () =>
    provider.getETFFlow('IBIT'),
  );
  if (etf) {
    console.log('  netFlowUsd:', etf.netFlowUsd);
    console.log('  cumulativeFlowUsd:', etf.cumulativeFlowUsd);
    console.log('  netAssetsUsd:', etf.netAssetsUsd);
    console.log('  asOf:', etf.asOf.toISOString());
  }
}

void main();
