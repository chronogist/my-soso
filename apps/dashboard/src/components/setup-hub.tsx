'use client';

import { useEffect, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import {
  apiFetch,
  type ApiUser,
  type Alert,
  type AlertKind,
  type ChannelLink,
  type DigestSchedule,
  type LinkCode,
  type PriceOp,
  type Watchlist,
} from '../lib/api';
import { CHANNELS, type Channel, persistChosenChannel, readChosenChannel } from '../lib/channels';

interface PrivyProfile {
  email?: { address?: string };
  wallet?: { address?: string };
}

const TELEGRAM_BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? 'MySoSoBot';
const TELEGRAM_BOT_URL =
  process.env.NEXT_PUBLIC_TELEGRAM_BOT_URL ?? `https://t.me/${TELEGRAM_BOT_USERNAME}`;
const DISCORD_INSTALL_URL = process.env.NEXT_PUBLIC_DISCORD_INSTALL_URL;
const DISCORD_INTERACTIONS_URL = process.env.NEXT_PUBLIC_DISCORD_INTERACTIONS_URL;
const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '';
const WHATSAPP_DEEPLINK = process.env.NEXT_PUBLIC_WHATSAPP_DEEPLINK;

const DIGEST_OPTIONS: { value: DigestSchedule; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

const PRICE_OP_OPTIONS: { value: PriceOp; label: string }[] = [
  { value: 'gte', label: 'Rises above' },
  { value: 'lte', label: 'Drops below' },
];

export function SetupHub() {
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
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!ready) return;
    if (!authenticated || !chosenChannel) {
      router.replace('/');
      return;
    }
    startTransition(() => {
      void refreshAll().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    });
  }, [ready, authenticated, chosenChannel]);

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
    const [nextLinks, nextWatchlist, nextAlerts, nextDigest] = await Promise.all([
      apiFetch<{ links: ChannelLink[] }>('/v1/channel-links', accessToken),
      apiFetch<{ watchlist: Watchlist }>('/v1/watchlist', accessToken),
      apiFetch<{ alerts: Alert[] }>('/v1/alerts', accessToken),
      apiFetch<{ schedule: DigestSchedule }>('/v1/digest-preferences', accessToken),
    ]);
    setApiUser(synced.user);
    setLinks(nextLinks.links);
    setWatchlist(nextWatchlist.watchlist);
    setAlerts(nextAlerts.alerts);
    setDigestSchedule(nextDigest.schedule);
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
      const body =
        alertKind === 'price'
          ? {
              kind: 'price',
              symbol: alertSymbol,
              op: alertOp,
              threshold: Number(alertThreshold),
            }
          : { kind: 'news', symbol: alertSymbol };
      const next = await apiFetch<{ alert: Alert }>('/v1/alerts', accessToken, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setAlerts((current) => [...current, next.alert]);
      setAlertSymbol('');
      setAlertThreshold('');
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

  if (!ready || !authenticated || !chosenChannel) {
    return (
      <main className="entry">
        <div className="entry__brand">
          <span className="entry__brand-dot" />
          MySoSo
        </div>
        <section className="entry__card entry__card--loading">Loading your hub…</section>
      </main>
    );
  }

  const channelMeta = CHANNELS.find((c) => c.id === chosenChannel)!;
  const isLinked = links.some((l) => l.channel === chosenChannel);

  const accountIdShort = apiUser?.id
    ? `SOSO-${apiUser.id.replace(/-/g, '').slice(0, 4).toUpperCase()}-${apiUser.id.replace(/-/g, '').slice(-2).toUpperCase()}`
    : '...';
  const walletShort = apiUser?.walletAddress
    ? `${apiUser.walletAddress.slice(0, 5)}...${apiUser.walletAddress.slice(-4)}`
    : 'Privy wallet pending';

  const channelInstructions: Record<Channel, ReactNode> = {
    telegram: (
      <>
        Open Telegram and message{' '}
        <a href={TELEGRAM_BOT_URL} target="_blank" rel="noreferrer">
          @{TELEGRAM_BOT_USERNAME}
        </a>
      </>
    ),
    whatsapp: (
      <>
        Open WhatsApp and message{' '}
        {WHATSAPP_DEEPLINK ? (
          <a href={WHATSAPP_DEEPLINK} target="_blank" rel="noreferrer">
            {WHATSAPP_NUMBER || 'MySoSo'}
          </a>
        ) : (
          <strong>{WHATSAPP_NUMBER || 'the MySoSo number'}</strong>
        )}
      </>
    ),
    discord: (
      <>
        {DISCORD_INSTALL_URL ? (
          <a href={DISCORD_INSTALL_URL} target="_blank" rel="noreferrer">
            Install the MySoSo Discord app
          </a>
        ) : (
          <strong>Install the MySoSo Discord app</strong>
        )}
      </>
    ),
  };

  const linkedChannel = links.find((l) => l.channel === chosenChannel);
  const handoffActions: Record<Channel, ReactNode> = {
    telegram: (
      <a className="hub__action-link" href={TELEGRAM_BOT_URL} target="_blank" rel="noreferrer">
        Open @{TELEGRAM_BOT_USERNAME}
      </a>
    ),
    discord: DISCORD_INSTALL_URL ? (
      <a className="hub__action-link" href={DISCORD_INSTALL_URL} target="_blank" rel="noreferrer">
        Open Discord Install
      </a>
    ) : (
      <span className="hub__action-link hub__action-link--muted">Discord install URL missing</span>
    ),
    whatsapp: WHATSAPP_DEEPLINK ? (
      <a className="hub__action-link" href={WHATSAPP_DEEPLINK} target="_blank" rel="noreferrer">
        Open WhatsApp Chat
      </a>
    ) : (
      <span className="hub__action-link hub__action-link--muted">WhatsApp number missing</span>
    ),
  };

  return (
    <main className="hub">
      <div className="hub__brand">
        <span className="entry__brand-dot" />
        MySoSo
      </div>

      <aside className="hub__sidebar">
        <article className="hub__card">
          <header className="hub__card-head">
            <span className="hub__eyebrow">Account Summary</span>
          </header>
          <dl className="hub__meta">
            <dt>Primary Email</dt>
            <dd>{apiUser?.email ?? 'Syncing…'}</dd>
            <dt>Account ID</dt>
            <dd className="hub__mono">{accountIdShort}</dd>
            <dt>Wallet Address</dt>
            <dd className="hub__mono">{walletShort}</dd>
          </dl>
        </article>

        <article className="hub__card">
          <header className="hub__card-head">
            <span className="hub__eyebrow">Watchlist Overview</span>
          </header>
          <form className="hub__add" onSubmit={addWatchlistItem}>
            <input
              value={symbol}
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
              placeholder="Add symbol (e.g. BTC)"
              aria-label="Asset symbol"
            />
            <button type="submit" disabled={!symbol.trim() || isPending}>
              + Add
            </button>
          </form>
          <ul className="hub__watchlist">
            {watchlist?.items.length ? (
              watchlist.items.map((item) => (
                <li key={item.id}>
                  <span className="hub__asset-icon">{item.symbol.slice(0, 1)}</span>
                  <span className="hub__asset-name">{item.symbol}</span>
                  <button
                    className="hub__icon-btn hub__icon-btn--danger"
                    aria-label={`Remove ${item.symbol}`}
                    onClick={() => removeWatchlistItem(item.symbol)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M4 7h16M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2m1 0v12a2 2 0 01-2 2H9a2 2 0 01-2-2V7"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </li>
              ))
            ) : (
              <li className="hub__watchlist-empty">No assets watched yet.</li>
            )}
          </ul>
        </article>

        <article className="hub__card">
          <header className="hub__card-head">
            <span className="hub__eyebrow">Digest Cadence</span>
          </header>
          <div className="hub__segmented" role="group" aria-label="Digest cadence">
            {DIGEST_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={digestSchedule === option.value ? 'is-active' : ''}
                disabled={isPending}
                onClick={() => updateDigest(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </article>
      </aside>

      <section className="hub__main">
        <div className="hub__main-head">
          <span className={`hub__pill ${isLinked ? 'hub__pill--ok' : 'hub__pill--warn'}`}>
            {isLinked ? 'LINKED' : 'NOT LINKED'}
          </span>
          <span className="hub__node">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 2L3 7l9 5 9-5-9-5zM3 12l9 5 9-5M3 17l9 5 9-5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
            ENCRYPTED NODE 04
          </span>
        </div>

        <h1 className="hub__title">{channelMeta.name} Setup</h1>
        <p className="hub__lede">
          Connect your {channelMeta.name} account to receive real-time alerts and manage orders.
        </p>

        {error ? <div className="hub__error">{error}</div> : null}

        {!isLinked ? (
          <button className="hub__cta" disabled={isPending} onClick={generateLinkCode}>
            {linkCode?.channel === chosenChannel ? 'Regenerate Link Code' : 'Generate Link Code'}
          </button>
        ) : (
          <div className="hub__linked-banner">
            {channelMeta.name} is connected. DM your agent any time.
          </div>
        )}

        {linkCode?.channel === chosenChannel && !isLinked ? <LinkCodeCard code={linkCode} /> : null}

        <div className="hub__instructions">
          <h2 className="hub__section">Link Instructions</h2>
          <ol>
            <li>
              <span className="hub__step">1</span>
              <span>{channelInstructions[chosenChannel]}</span>
            </li>
            <li>
              <span className="hub__step">2</span>
              <span>Paste the command generated above into the chat.</span>
            </li>
          </ol>
        </div>

        <div className="hub__handoff">
          <div>
            <h2 className="hub__section">Live Entrypoint</h2>
            <p>
              {isLinked
                ? `${channelMeta.name} is linked to ${linkedChannel?.channelUserId ?? 'your account'}.`
                : `Generate a link code, then use the ${channelMeta.name} entrypoint.`}
            </p>
            {chosenChannel === 'discord' && DISCORD_INTERACTIONS_URL ? (
              <span className="hub__endpoint">{DISCORD_INTERACTIONS_URL}</span>
            ) : null}
          </div>
          {handoffActions[chosenChannel]}
        </div>

        <div className="hub__controls">
          <header className="hub__controls-head">
            <h2 className="hub__section">Alerts</h2>
            <span>{alerts.filter((alert) => alert.active).length} active</span>
          </header>

          <form className="hub__alert-form" onSubmit={createAlert}>
            <input
              value={alertSymbol}
              onChange={(event) => setAlertSymbol(event.target.value.toUpperCase())}
              placeholder="Symbol"
              aria-label="Alert asset symbol"
            />
            <select
              value={alertKind}
              onChange={(event) => setAlertKind(event.target.value as AlertKind)}
              aria-label="Alert type"
            >
              <option value="price">Price</option>
              <option value="news">News</option>
            </select>
            {alertKind === 'price' ? (
              <>
                <select
                  value={alertOp}
                  onChange={(event) => setAlertOp(event.target.value as PriceOp)}
                  aria-label="Price condition"
                >
                  {PRICE_OP_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  value={alertThreshold}
                  onChange={(event) => setAlertThreshold(event.target.value)}
                  inputMode="decimal"
                  placeholder="USD"
                  aria-label="Price threshold"
                />
              </>
            ) : null}
            <button
              type="submit"
              disabled={
                !alertSymbol.trim() ||
                (alertKind === 'price' && !alertThreshold.trim()) ||
                isPending
              }
            >
              Add Alert
            </button>
          </form>

          <ul className="hub__alerts">
            {alerts.length ? (
              alerts.map((alert) => (
                <li key={alert.id}>
                  <button
                    className={`hub__toggle ${alert.active ? 'is-active' : ''}`}
                    type="button"
                    aria-label={`${alert.active ? 'Pause' : 'Resume'} ${alert.name}`}
                    onClick={() => toggleAlert(alert)}
                  />
                  <div>
                    <strong>{alert.name}</strong>
                    <span>{formatAlertDetail(alert)}</span>
                  </div>
                  <button
                    className="hub__icon-btn hub__icon-btn--danger"
                    aria-label={`Delete ${alert.name}`}
                    onClick={() => deleteAlert(alert.id)}
                    type="button"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M4 7h16M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2m1 0v12a2 2 0 01-2 2H9a2 2 0 01-2-2V7"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </li>
              ))
            ) : (
              <li className="hub__linked-empty">No alerts configured yet.</li>
            )}
          </ul>
        </div>

        <div className="hub__linked">
          <h2 className="hub__section">Linked Channels ({links.length})</h2>
          {links.length ? (
            <ul className="hub__linked-list">
              {links.map((link) => (
                <li key={link.id}>
                  <strong>{link.channel}</strong>
                  <span className="hub__mono">{link.channelUserId}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="hub__linked-empty">No accounts connected yet.</div>
          )}
        </div>

        <footer className="hub__footer">
          <button className="hub__ghost" onClick={changePlatform}>
            Change Platform
          </button>
          <button
            className="hub__ghost hub__ghost--danger"
            onClick={() => {
              persistChosenChannel(null);
              void logout();
            }}
          >
            Sign Out
          </button>
        </footer>
      </section>
    </main>
  );
}

function formatAlertDetail(alert: Alert) {
  if (alert.kind === 'news') return `${alert.symbol} news`;
  const direction = alert.priceOp === 'lt' || alert.priceOp === 'lte' ? 'below' : 'above';
  return `${alert.symbol} ${direction} $${alert.priceThreshold ?? '-'}`;
}

function LinkCodeCard({ code }: { code: LinkCode }) {
  const [remaining, setRemaining] = useState(code.expiresInSeconds);

  useEffect(() => {
    setRemaining(code.expiresInSeconds);
    const expiresAt = Date.now() + code.expiresInSeconds * 1000;
    const id = setInterval(() => {
      const next = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      setRemaining(next);
      if (next <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [code]);

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');

  return (
    <div className="hub__code">
      <span className="hub__code-text">{code.command}</span>
      <span className="hub__code-expiry">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
          <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        Expires in {mm}:{ss}
      </span>
    </div>
  );
}
