'use client';

import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import {
  apiFetch,
  type ApiUser,
  type Alert,
  type AlertKind,
  type BotPreferences,
  type ChannelLink,
  type DigestSchedule,
  type LinkCode,
  type PriceOp,
  type Watchlist,
} from '../lib/api';

export const DEFAULT_PREFERENCES: BotPreferences = {
  tone: 'concise',
  verbosity: 'normal',
  language: 'en',
  timezone: 'UTC',
  digestTime: '08:00',
  digestWeekday: 1,
  digestSections: ['prices', 'news'],
  quietHours: { enabled: false, start: '22:00', end: '07:00' },
  throttling: { maxPerHour: 6, maxPerDay: 40 },
  newsFilter: { strength: 'portfolio', sources: ['hot', 'featured'], explainImpact: true },
  coverage: {
    currencies: true,
    etfs: true,
    ssiIndices: true,
    cryptoStocks: false,
    btcTreasuries: false,
    fundraising: false,
    macro: false,
  },
  formatting: {
    includeCharts: false,
    includeLinks: true,
    includeCitations: true,
    memoCommandEnabled: false,
  },
  channelOverrides: {},
};
import { persistChosenChannel, readChosenChannel, type Channel } from '../lib/channels';

interface PrivyProfile {
  email?: { address?: string };
  wallet?: { address?: string };
}

export const DIGEST_OPTIONS: { value: DigestSchedule; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

export const PRICE_OP_OPTIONS: { value: PriceOp; label: string }[] = [
  { value: 'gte', label: 'Rises above' },
  { value: 'lte', label: 'Drops below' },
];

function buildAlertBody(
  kind: AlertKind,
  symbol: string,
  op: PriceOp,
  threshold: string,
  extras: Record<string, string>,
): Record<string, unknown> {
  const sym = symbol.trim().toUpperCase();
  switch (kind) {
    case 'price':
      return { kind, symbol: sym, op, threshold: Number(threshold) };
    case 'news':
      return { kind, symbol: sym };
    case 'etf_flow':
      return {
        kind,
        symbol: sym,
        direction: extras.direction ?? 'either',
        minUsd: Number(extras.minUsd ?? '0'),
      };
    case 'index_move':
      return { kind, symbol: sym, movePct: Number(extras.movePct ?? '0') };
    case 'sentiment':
      return { kind, symbol: sym, direction: extras.direction ?? 'either' };
    case 'macro':
      return { kind, symbol: sym || 'GLOBAL', severity: extras.severity ?? 'high' };
  }
}

export function formatAlertDetail(alert: Alert) {
  switch (alert.kind) {
    case 'news':
      return `${alert.symbol} news`;
    case 'price': {
      const direction = alert.priceOp === 'lt' || alert.priceOp === 'lte' ? 'below' : 'above';
      return `${alert.symbol} ${direction} $${alert.priceThreshold ?? '-'}`;
    }
    case 'etf_flow': {
      const dir = (alert.params.direction as string) ?? 'either';
      const min = (alert.params.minUsd as number) ?? 0;
      return `${alert.symbol} ETF ${dir} ≥ $${min}`;
    }
    case 'index_move':
      return `${alert.symbol} index ±${(alert.params.movePct as number) ?? '-'}%`;
    case 'sentiment':
      return `${alert.symbol} sentiment ${(alert.params.direction as string) ?? 'shift'}`;
    case 'macro':
      return `Macro ${(alert.params.severity as string) ?? 'event'}`;
  }
}

export function useHubState(options?: { pollForLink?: boolean }) {
  const router = useRouter();
  const { ready, authenticated, logout, user, getAccessToken } = usePrivy();
  const [chosenChannel, setChosenChannel] = useState<Channel | null>(() => readChosenChannel());
  const [apiUser, setApiUser] = useState<ApiUser | null>(null);
  const [links, setLinks] = useState<ChannelLink[]>([]);
  const [linkCode, setLinkCode] = useState<LinkCode | null>(null);
  const [watchlist, setWatchlist] = useState<Watchlist | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [digestSchedule, setDigestSchedule] = useState<DigestSchedule>('off');
  const [symbol, setSymbol] = useState('');
  const [alertSymbol, setAlertSymbol] = useState('');
  const [alertKind, setAlertKind] = useState<AlertKind>('price');
  const [alertOp, setAlertOp] = useState<PriceOp>('gte');
  const [alertThreshold, setAlertThreshold] = useState('');
  const [alertExtras, setAlertExtras] = useState<Record<string, string>>({});
  const [preferences, setPreferences] = useState<BotPreferences>(DEFAULT_PREFERENCES);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Distinct from isPending (which fires on every transition). This flips
  // true exactly once after the first refreshAll resolves, so consumers can
  // hold the UI on a loading shell until we know whether the user is linked.
  const [initialLoaded, setInitialLoaded] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated || !chosenChannel) {
      router.replace('/');
      return;
    }
    startTransition(() => {
      void refreshAll()
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setInitialLoaded(true));
    });
  }, [ready, authenticated, chosenChannel, router]);

  useEffect(() => {
    if (!options?.pollForLink) return;
    if (!ready || !authenticated || !chosenChannel) return;
    if (linkCode?.channel !== chosenChannel) return;
    if (links.some((link) => link.channel === chosenChannel)) return;

    const interval = window.setInterval(() => {
      void refreshAll().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, 3000);

    return () => window.clearInterval(interval);
  }, [options?.pollForLink, ready, authenticated, chosenChannel, linkCode, links]);

  async function token(): Promise<string> {
    const accessToken = await getAccessToken();
    if (!accessToken) throw new Error('Privy session is not ready yet.');
    return accessToken;
  }

  async function refreshAll() {
    const accessToken = await token();
    const profile = user as PrivyProfile | null;
    const synced = await apiFetch<{ user: ApiUser }>('/v1/session', accessToken, {
      method: 'POST',
      body: JSON.stringify({
        email: profile?.email?.address,
        walletAddress: profile?.wallet?.address,
      }),
    });
    const [nextLinks, nextWatchlist, nextAlerts, nextDigest, nextPrefs] = await Promise.all([
      apiFetch<{ links: ChannelLink[] }>('/v1/channel-links', accessToken),
      apiFetch<{ watchlist: Watchlist }>('/v1/watchlist', accessToken),
      apiFetch<{ alerts: Alert[] }>('/v1/alerts', accessToken),
      apiFetch<{ schedule: DigestSchedule }>('/v1/digest-preferences', accessToken),
      apiFetch<{ preferences: BotPreferences }>('/v1/preferences', accessToken),
    ]);
    setApiUser(synced.user);
    setLinks(nextLinks.links);
    if (chosenChannel && nextLinks.links.some((link) => link.channel === chosenChannel)) {
      setLinkCode(null);
    }
    setWatchlist(nextWatchlist.watchlist);
    setAlerts(nextAlerts.alerts);
    setDigestSchedule(nextDigest.schedule);
    setPreferences(nextPrefs.preferences);
  }

  function run(action: () => Promise<void>) {
    setError(null);
    startTransition(() => {
      void action().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    });
  }

  function generateLinkCode() {
    if (!chosenChannel) return;
    run(async () => {
      const accessToken = await token();
      const next = await apiFetch<LinkCode>('/v1/link-codes', accessToken, {
        method: 'POST',
        body: JSON.stringify({ channel: chosenChannel }),
      });
      setLinkCode(next);
    });
  }

  function addWatchlistItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(async () => {
      const accessToken = await token();
      await apiFetch('/v1/watchlist/items', accessToken, {
        method: 'POST',
        body: JSON.stringify({ symbol }),
      });
      setSymbol('');
      const next = await apiFetch<{ watchlist: Watchlist }>('/v1/watchlist', accessToken);
      setWatchlist(next.watchlist);
    });
  }

  function removeWatchlistItem(itemSymbol: string) {
    run(async () => {
      const accessToken = await token();
      await apiFetch(`/v1/watchlist/items/${encodeURIComponent(itemSymbol)}`, accessToken, {
        method: 'DELETE',
      });
      const next = await apiFetch<{ watchlist: Watchlist }>('/v1/watchlist', accessToken);
      setWatchlist(next.watchlist);
    });
  }

  function createAlert(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(async () => {
      const accessToken = await token();
      const body = buildAlertBody(alertKind, alertSymbol, alertOp, alertThreshold, alertExtras);
      const next = await apiFetch<{ alert: Alert }>('/v1/alerts', accessToken, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setAlerts((current) => [...current, next.alert]);
      setAlertSymbol('');
      setAlertThreshold('');
      setAlertExtras({});
    });
  }

  function savePreferences(next: BotPreferences) {
    setPreferences(next);
    run(async () => {
      const accessToken = await token();
      const saved = await apiFetch<{ preferences: BotPreferences }>(
        '/v1/preferences',
        accessToken,
        {
          method: 'PUT',
          body: JSON.stringify(next),
        },
      );
      setPreferences(saved.preferences);
    });
  }

  function toggleAlert(alert: Alert) {
    run(async () => {
      const accessToken = await token();
      const next = await apiFetch<{ alert: Alert }>(`/v1/alerts/${alert.id}`, accessToken, {
        method: 'PATCH',
        body: JSON.stringify({ active: !alert.active }),
      });
      setAlerts((current) => current.map((item) => (item.id === alert.id ? next.alert : item)));
    });
  }

  function deleteAlert(alertId: string) {
    run(async () => {
      const accessToken = await token();
      await apiFetch(`/v1/alerts/${alertId}`, accessToken, { method: 'DELETE' });
      setAlerts((current) => current.filter((alert) => alert.id !== alertId));
    });
  }

  function updateDigest(schedule: DigestSchedule) {
    setDigestSchedule(schedule);
    run(async () => {
      const accessToken = await token();
      const next = await apiFetch<{ schedule: DigestSchedule }>(
        '/v1/digest-preferences',
        accessToken,
        {
          method: 'PUT',
          body: JSON.stringify({ schedule }),
        },
      );
      setDigestSchedule(next.schedule);
    });
  }

  function changePlatform() {
    persistChosenChannel(null);
    setChosenChannel(null);
    setLinkCode(null);
    router.push('/');
  }

  function signOut() {
    persistChosenChannel(null);
    void logout();
  }

  return {
    ready,
    authenticated,
    chosenChannel,
    setChosenChannel,
    apiUser,
    links,
    linkCode,
    watchlist,
    alerts,
    digestSchedule,
    symbol,
    setSymbol,
    alertSymbol,
    setAlertSymbol,
    alertKind,
    setAlertKind,
    alertOp,
    setAlertOp,
    alertThreshold,
    setAlertThreshold,
    alertExtras,
    setAlertExtras,
    preferences,
    savePreferences,
    error,
    isPending,
    initialLoaded,
    refreshAll,
    generateLinkCode,
    addWatchlistItem,
    removeWatchlistItem,
    createAlert,
    toggleAlert,
    deleteAlert,
    updateDigest,
    changePlatform,
    signOut,
  };
}
