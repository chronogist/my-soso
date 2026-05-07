import type { MarketDataProvider } from '../market-data.js';
import type { NewsProvider } from '../news.js';
import {
  ProviderError,
  UnknownSymbolError,
  type ETFFlow,
  type Index,
  type NewsItem,
  type Price,
} from '../types.js';
import { SoSoValueHttp, type SoSoValueHttpOptions } from './http.js';
import {
  CurrencyListSchema,
  MarketSnapshotSchema,
  NewsListSchema,
  type Currency,
  type NewsItemRaw,
} from './schemas.js';

const PROVIDER_NAME = 'sosovalue';

export interface SoSoValueProviderOptions extends SoSoValueHttpOptions {
  /**
   * Lifetime of the in-memory symbol → currency_id map. SoSoValue's
   * /currencies endpoint advertises a one-minute update cadence, so
   * five minutes is generous. Refresh is lazy on first request after
   * expiry; failures fall back to the previous map until it works.
   */
  currencyMapTtlMs?: number;
}

interface CurrencyMap {
  bySymbol: Map<string, Currency>;
  fetchedAt: number;
}

/**
 * Single class implementing both `MarketDataProvider` and
 * `NewsProvider` because every method ultimately needs the same
 * symbol → currency_id resolution. Keeping them together avoids
 * duplicating that map.
 *
 * No caching, no rate limiting, no budget tracking here — those are
 * cross-cutting concerns layered on top in the worker bootstrap.
 */
export class SoSoValueProvider implements MarketDataProvider, NewsProvider {
  readonly name = PROVIDER_NAME;
  private readonly http: SoSoValueHttp;
  private readonly currencyMapTtlMs: number;
  private currencyMap: CurrencyMap | null = null;
  private currencyMapInflight: Promise<CurrencyMap> | null = null;

  constructor(opts: SoSoValueProviderOptions) {
    this.http = new SoSoValueHttp(opts);
    this.currencyMapTtlMs = opts.currencyMapTtlMs ?? 5 * 60_000;
  }

  async getPrice(symbol: string): Promise<Price> {
    const currency = await this.resolveSymbol(symbol);
    const snap = await this.http.get(
      `/currencies/${encodeURIComponent(currency.currency_id)}/market-snapshot`,
      MarketSnapshotSchema,
    );
    return {
      symbol: currency.symbol.toUpperCase(),
      kind: 'crypto',
      quote: 'USD',
      price: snap.price,
      change24hPct: snap.change_pct_24h,
      marketCapUsd: snap.marketcap,
      volume24hUsd: snap.turnover_24h,
      // SoSoValue's market-snapshot envelope does not currently expose
      // a precise `as_of` timestamp; use `now()` so callers can still
      // cache-bust on age.
      asOf: new Date(),
      source: PROVIDER_NAME,
    };
  }

  async getPrices(symbols: readonly string[]): Promise<ReadonlyMap<string, Price>> {
    // SoSoValue has no batch market-snapshot endpoint as of this writing.
    // Settle promises in parallel and skip the symbols that fail.
    const out = new Map<string, Price>();
    const results = await Promise.allSettled(symbols.map((s) => this.getPrice(s)));
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') out.set(symbols[i]!.toUpperCase(), r.value);
    });
    return out;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getETFFlow(_symbol: string): Promise<ETFFlow> {
    throw new ProviderError('getETFFlow not implemented in Phase 3', {
      provider: PROVIDER_NAME,
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getIndex(_symbol: string): Promise<Index> {
    throw new ProviderError('getIndex not implemented in Phase 3', {
      provider: PROVIDER_NAME,
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async listIndices(): Promise<readonly Index[]> {
    throw new ProviderError('listIndices not implemented in Phase 3', {
      provider: PROVIDER_NAME,
    });
  }

  async getNewsForAsset(
    symbol: string,
    opts: { limit?: number } = {},
  ): Promise<readonly NewsItem[]> {
    const currency = await this.resolveSymbol(symbol);
    const pageSize = opts.limit ?? 10;
    const list = await this.http.get('/news', NewsListSchema, {
      currency_id: currency.currency_id,
      page: 1,
      page_size: pageSize,
    });
    return list.list.slice(0, pageSize).map((n) => mapNews(n, currency));
  }

  async getLatestNews(opts: { limit?: number } = {}): Promise<readonly NewsItem[]> {
    const pageSize = opts.limit ?? 20;
    const list = await this.http.get('/news', NewsListSchema, {
      page: 1,
      page_size: pageSize,
    });
    return list.list.slice(0, pageSize).map((n) => mapNews(n, null));
  }

  /**
   * Resolve a user-facing symbol ("BTC") to SoSoValue's `currency_id`.
   * Throws `UnknownSymbolError` if the symbol is not in the catalogue.
   */
  private async resolveSymbol(symbol: string): Promise<Currency> {
    const upper = symbol.trim().toUpperCase();
    const map = await this.getCurrencyMap();
    const hit = map.bySymbol.get(upper);
    if (hit) return hit;

    // Allow a single forced refresh in case a brand-new listing slipped
    // in since our cached snapshot, then give up.
    const fresh = await this.refreshCurrencyMap();
    const retry = fresh.bySymbol.get(upper);
    if (!retry) {
      throw new UnknownSymbolError(`unknown symbol: ${symbol}`, { provider: PROVIDER_NAME });
    }
    return retry;
  }

  private async getCurrencyMap(): Promise<CurrencyMap> {
    const now = Date.now();
    if (this.currencyMap && now - this.currencyMap.fetchedAt < this.currencyMapTtlMs) {
      return this.currencyMap;
    }
    return this.refreshCurrencyMap();
  }

  private async refreshCurrencyMap(): Promise<CurrencyMap> {
    if (this.currencyMapInflight) return this.currencyMapInflight;
    this.currencyMapInflight = (async () => {
      try {
        const list = await this.http.get('/currencies', CurrencyListSchema);
        const bySymbol = new Map<string, Currency>();
        for (const c of list) bySymbol.set(c.symbol.toUpperCase(), c);
        const next = { bySymbol, fetchedAt: Date.now() };
        this.currencyMap = next;
        return next;
      } catch (err) {
        // Serve stale map if we have one — better than failing every
        // request because /currencies blipped.
        if (this.currencyMap) return this.currencyMap;
        throw err;
      } finally {
        this.currencyMapInflight = null;
      }
    })();
    return this.currencyMapInflight;
  }
}

function mapNews(raw: NewsItemRaw, currency: Currency | null): NewsItem {
  const tagged = (raw.matched_currencies ?? [])
    .map((m) => m.symbol)
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .map((s) => s.toUpperCase());
  const symbols = currency
    ? Array.from(new Set([currency.symbol.toUpperCase(), ...tagged]))
    : tagged;
  const url = raw.original_link ?? raw.source_link ?? '';
  return {
    id: raw.id,
    title: raw.title,
    url,
    publisher: raw.author ?? null,
    summary: raw.content ?? null,
    symbols,
    publishedAt: new Date(raw.release_time),
    source: PROVIDER_NAME,
  };
}
