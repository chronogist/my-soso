export interface ApiUser {
  id: string;
  email: string;
  privyUserId: string;
  walletAddress: string | null;
  plan: string;
  digestSchedule: DigestSchedule;
  createdAt: string;
}

export type DigestSchedule = 'off' | 'daily' | 'weekly';
export type AlertKind = 'price' | 'news' | 'etf_flow' | 'index_move' | 'sentiment' | 'macro';
export type PriceOp = 'lt' | 'lte' | 'gt' | 'gte';
export type Tone = 'concise' | 'detailed' | 'casual' | 'formal';
export type Verbosity = 'short' | 'normal' | 'long';
export type NewsStrength = 'major_only' | 'portfolio' | 'all';

export interface BotPreferences {
  tone: Tone;
  verbosity: Verbosity;
  language: string;
  timezone: string;
  digestTime: string;
  digestWeekday: number;
  digestSections: ('prices' | 'news' | 'etf_flows' | 'indices' | 'macro')[];
  quietHours: { enabled: boolean; start: string; end: string };
  throttling: { maxPerHour: number; maxPerDay: number };
  newsFilter: {
    strength: NewsStrength;
    sources: ('hot' | 'featured' | 'search')[];
    explainImpact: boolean;
  };
  coverage: {
    currencies: boolean;
    etfs: boolean;
    ssiIndices: boolean;
    cryptoStocks: boolean;
    btcTreasuries: boolean;
    fundraising: boolean;
    macro: boolean;
  };
  formatting: {
    includeCharts: boolean;
    includeLinks: boolean;
    includeCitations: boolean;
    memoCommandEnabled: boolean;
  };
  channelOverrides: Partial<
    Record<
      'telegram' | 'discord' | 'whatsapp',
      { enabled?: boolean; tone?: Tone; muteAlerts?: boolean }
    >
  >;
}

export interface ChannelLink {
  id: string;
  channel: 'telegram' | 'discord' | 'whatsapp';
  channelUserId: string;
  linkedAt: string;
}

export interface LinkCode {
  code: string;
  channel: 'telegram' | 'discord' | 'whatsapp';
  command: string;
  expiresInSeconds: number;
}

export interface MarketSymbolSuggestion {
  symbol: string;
  name: string;
}

export interface WatchlistItem {
  id: string;
  symbol: string;
  assetKind: string;
  createdAt: string;
  market: {
    priceUsd: number;
    change24hPct: number | null;
    asOf: string;
  } | null;
}

export interface Watchlist {
  id: string;
  name: string;
  isDefault: boolean;
  items: WatchlistItem[];
}

export interface Alert {
  id: string;
  name: string;
  kind: AlertKind;
  symbol: string;
  assetKind: string;
  priceOp: PriceOp | null;
  priceThreshold: number | null;
  params: Record<string, unknown>;
  active: boolean;
  createdAt: string;
  lastFiredAt: string | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function apiFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
    });
  } catch {
    throw new Error(`API unreachable at ${API_BASE}. Is the API server running?`);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Request failed with HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
