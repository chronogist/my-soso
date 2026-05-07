import { tool } from 'ai';
import { z } from 'zod';
import {
  ProviderError,
  RateLimitedError,
  UnknownSymbolError,
  type MarketDataProvider,
  type NewsProvider,
} from '@my-soso/providers';

const SymbolArg = z
  .string()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9._-]+$/, 'symbols must be alphanumeric, dot, dash or underscore')
  .describe('Asset ticker (e.g. "BTC", "ETH", "SOL").');

interface BuildToolsOptions {
  market: MarketDataProvider;
  news: NewsProvider;
}

/**
 * Returns the structured fields the model sees as a tool result.
 * The mapping is deliberate: we hand the model summarised, plain
 * fields rather than raw provider DTOs so the prompt stays small.
 */
export function buildAgentTools({ market, news }: BuildToolsOptions) {
  return {
    getPrice: tool({
      description:
        'Fetch the current spot price and 24h change for a crypto asset by ticker symbol.',
      inputSchema: z.object({ symbol: SymbolArg }),
      execute: async ({ symbol }) => {
        try {
          const p = await market.getPrice(symbol);
          return {
            ok: true as const,
            symbol: p.symbol,
            priceUsd: p.price,
            change24hPct: p.change24hPct,
            marketCapUsd: p.marketCapUsd,
            volume24hUsd: p.volume24hUsd,
            asOf: p.asOf.toISOString(),
          };
        } catch (err) {
          return mapToolError(err, symbol);
        }
      },
    }),

    getNewsForAsset: tool({
      description:
        'Fetch recent news headlines for a crypto asset by ticker symbol. Returns up to 10 items with title, source, and a short summary.',
      inputSchema: z.object({
        symbol: SymbolArg,
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(5)
          .describe('Maximum number of news items to return.'),
      }),
      execute: async ({ symbol, limit }) => {
        try {
          const items = await news.getNewsForAsset(symbol, { limit });
          return {
            ok: true as const,
            symbol: symbol.toUpperCase(),
            items: items.map((n) => ({
              title: n.title,
              url: n.url,
              publisher: n.publisher,
              summary: n.summary,
              publishedAt: n.publishedAt.toISOString(),
            })),
          };
        } catch (err) {
          return mapToolError(err, symbol);
        }
      },
    }),
  };
}

export type AgentTools = ReturnType<typeof buildAgentTools>;

function mapToolError(err: unknown, symbol: string) {
  if (err instanceof UnknownSymbolError) {
    return {
      ok: false as const,
      reason: 'unknown_symbol' as const,
      message: `I don't recognise "${symbol}". Try the asset's standard ticker.`,
    };
  }
  if (err instanceof RateLimitedError) {
    return {
      ok: false as const,
      reason: 'rate_limited' as const,
      message: 'My data provider is rate-limited right now. Try again in a moment.',
    };
  }
  if (err instanceof ProviderError) {
    return {
      ok: false as const,
      reason: 'provider_unavailable' as const,
      message: 'My data provider is temporarily unavailable.',
    };
  }
  return {
    ok: false as const,
    reason: 'unknown_error' as const,
    message: 'Something went wrong fetching that data.',
  };
}
