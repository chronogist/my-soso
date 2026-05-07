import { z } from 'zod';

/**
 * Canonical asset identifiers used across providers. Symbols are
 * uppercase tickers (e.g. "BTC", "ETH"); kinds match the
 * `watchlist_items.asset_kind` column.
 */
export const AssetKindSchema = z.enum(['crypto', 'index', 'etf']);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const PriceSchema = z.object({
  symbol: z.string().min(1),
  kind: AssetKindSchema,
  /** Quote currency for `price`. Always 'USD' for Wave 1. */
  quote: z.literal('USD'),
  price: z.number().finite(),
  change24hPct: z.number().finite().nullable(),
  marketCapUsd: z.number().finite().nullable(),
  volume24hUsd: z.number().finite().nullable(),
  /** Provider's reported `as of` time, not the time we fetched. */
  asOf: z.coerce.date(),
  /** Free-form provider name for telemetry, not for routing. */
  source: z.string().min(1),
});
export type Price = z.infer<typeof PriceSchema>;

export const NewsItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  /** Source publication name when available (CoinDesk, Bloomberg, etc.). */
  publisher: z.string().min(1).nullable(),
  /** Concise summary if the provider supplies one; otherwise null. */
  summary: z.string().nullable(),
  /** Symbols the provider tagged on this article. May be empty. */
  symbols: z.array(z.string().min(1)),
  publishedAt: z.coerce.date(),
  source: z.string().min(1),
});
export type NewsItem = z.infer<typeof NewsItemSchema>;

export const ETFFlowSchema = z.object({
  /** ETF ticker (e.g. "IBIT") or product slug if provider has no ticker. */
  symbol: z.string().min(1),
  /** Underlying asset the ETF tracks ("BTC", "ETH", …). */
  underlying: z.string().min(1),
  /** Net inflow in USD for the reported window. Negative = outflow. */
  netFlowUsd: z.number().finite(),
  asOf: z.coerce.date(),
  source: z.string().min(1),
});
export type ETFFlow = z.infer<typeof ETFFlowSchema>;

export const IndexSchema = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
  value: z.number().finite(),
  change24hPct: z.number().finite().nullable(),
  asOf: z.coerce.date(),
  source: z.string().min(1),
});
export type Index = z.infer<typeof IndexSchema>;

/**
 * Errors a provider may raise. Distinct names so the agent layer can
 * decide whether to retry, fall back, or surface to the user.
 */
export class ProviderError extends Error {
  override readonly name: string = 'ProviderError';
  constructor(
    message: string,
    readonly opts: { provider: string; cause?: unknown } = { provider: 'unknown' },
  ) {
    super(message);
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

/** The provider could not satisfy the request because the symbol is unknown. */
export class UnknownSymbolError extends ProviderError {
  override readonly name: string = 'UnknownSymbolError';
}

/** The upstream rate limit (per-minute or monthly) is exhausted. */
export class RateLimitedError extends ProviderError {
  override readonly name: string = 'RateLimitedError';
  constructor(message: string, opts: { provider: string; retryAfterMs?: number; cause?: unknown }) {
    super(message, opts);
    this.retryAfterMs = opts.retryAfterMs;
  }
  readonly retryAfterMs: number | undefined;
}

/** Upstream is down, returned 5xx, or timed out. Caller may retry. */
export class ProviderUnavailableError extends ProviderError {
  override readonly name: string = 'ProviderUnavailableError';
}
