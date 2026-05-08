export interface ApiUser {
  id: string;
  email: string;
  privyUserId: string;
  walletAddress: string | null;
  plan: string;
  createdAt: string;
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

export interface WatchlistItem {
  id: string;
  symbol: string;
  assetKind: string;
  createdAt: string;
}

export interface Watchlist {
  id: string;
  name: string;
  isDefault: boolean;
  items: WatchlistItem[];
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function apiFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        ...init.headers,
      },
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
