import type { MarketDataProvider, MarketSymbol } from '../market-data.js';
import type { NewsProvider } from '../news.js';
import {
  UnknownSymbolError,
  type ETFFlow,
  type Index,
  type NewsItem,
  type Price,
} from '../types.js';
import { SoSoValueHttp, type SoSoValueHttpOptions } from './http.js';
import {
  CurrencyListSchema,
  ETFSnapshotSchema,
  IndexListSchema,
  IndexSnapshotSchema,
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
      // SoSoValue returns change_pct_24h as a decimal fraction
      // (-0.0185 for -1.85%). Our `Price.change24hPct` is documented
      // as a percent, so multiply once at the mapping boundary.
      change24hPct: snap.change_pct_24h !== null ? snap.change_pct_24h * 100 : null,
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

  async searchSymbols(
    query: string,
    opts: { limit?: number } = {},
  ): Promise<readonly MarketSymbol[]> {
    const needle = query.trim().toUpperCase();
    if (!needle) return [];
    const limit = opts.limit ?? 8;
    const map = await this.getCurrencyMap();
    return Array.from(map.bySymbol.values())
      .filter((currency) => {
        const symbol = currency.symbol.toUpperCase();
        const name = currency.name.toUpperCase();
        return symbol.includes(needle) || name.includes(needle);
      })
      .sort((a, b) => {
        const aSymbol = a.symbol.toUpperCase();
        const bSymbol = b.symbol.toUpperCase();
        const aStarts = aSymbol.startsWith(needle) ? 0 : 1;
        const bStarts = bSymbol.startsWith(needle) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        if (aSymbol.length !== bSymbol.length) return aSymbol.length - bSymbol.length;
        return aSymbol.localeCompare(bSymbol);
      })
      .slice(0, limit)
      .map((currency) => ({
        symbol: currency.symbol.toUpperCase(),
        name: currency.name,
      }));
  }

  async getETFFlow(symbol: string): Promise<ETFFlow> {
    const ticker = symbol.trim().toUpperCase();
    const snap = await this.http.get(
      `/etfs/${encodeURIComponent(ticker)}/market-snapshot`,
      ETFSnapshotSchema,
    );
    return {
      symbol: snap.ticker.toUpperCase(),
      // SoSoValue's market-snapshot does not return the underlying
      // asset; the agent / caller infers it from context. Phase 4
      // alert engine never needs it.
      underlying: null,
      netFlowUsd: snap.net_inflow ?? 0,
      cumulativeFlowUsd: snap.cum_inflow,
      netAssetsUsd: snap.net_assets,
      asOf: new Date(snap.date),
      source: PROVIDER_NAME,
    };
  }

  async getIndex(symbol: string): Promise<Index> {
    const ticker = symbol.trim();
    const snap = await this.http.get(
      `/indices/${encodeURIComponent(ticker)}/market-snapshot`,
      IndexSnapshotSchema,
    );
    const change = snap['24h_change_pct'];
    return {
      symbol: ticker,
      // SoSoValue does not return a human-readable name on this
      // endpoint; fall back to the ticker so downstream code never
      // needs to handle a null name.
      name: ticker,
      value: snap.price,
      // Same decimal-fraction convention as currencies (-0.0185 for -1.85%).
      change24hPct: change !== null && change !== undefined ? change * 100 : null,
      asOf: new Date(),
      source: PROVIDER_NAME,
    };
  }

  async listIndices(): Promise<readonly string[]> {
    const list = await this.http.get('/indices', IndexListSchema);
    return list;
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
    return list.list
      .filter(
        (n): n is NewsItemRaw & { title: string } =>
          typeof n.title === 'string' && n.title.length > 0,
      )
      .slice(0, pageSize)
      .map((n) => mapNews(n, currency));
  }

  async getLatestNews(opts: { limit?: number } = {}): Promise<readonly NewsItem[]> {
    const pageSize = opts.limit ?? 20;
    const list = await this.http.get('/news', NewsListSchema, {
      page: 1,
      page_size: pageSize,
    });
    return list.list
      .filter(
        (n): n is NewsItemRaw & { title: string } =>
          typeof n.title === 'string' && n.title.length > 0,
      )
      .slice(0, pageSize)
      .map((n) => mapNews(n, null));
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

function mapNews(raw: NewsItemRaw & { title: string }, currency: Currency | null): NewsItem {
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
