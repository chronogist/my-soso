import type { ETFFlow, Index, Price } from './types.js';

/**
 * Read-only market data. Implementations are expected to handle their
 * own caching, rate limiting, and budget tracking; the agent layer
 * treats the interface as a stable contract regardless of which
 * upstream API answers.
 *
 * Wave 1 ships a single SoSoValue implementation. The interface exists
 * so we can supplement (e.g. CoinGecko fallback) without a refactor.
 */
export interface MarketDataProvider {
  readonly name: string;

  getPrice(symbol: string): Promise<Price>;

  /**
   * Spot prices for a list of symbols. Implementations should batch
   * upstream calls when possible. The returned map is keyed by the
   * canonical (uppercase) symbol; missing symbols are simply absent.
   */
  getPrices(symbols: readonly string[]): Promise<ReadonlyMap<string, Price>>;

  getETFFlow(symbol: string): Promise<ETFFlow>;

  getIndex(symbol: string): Promise<Index>;

  listIndices(): Promise<readonly Index[]>;
}
