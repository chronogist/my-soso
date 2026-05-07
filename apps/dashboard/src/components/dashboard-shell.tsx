'use client';

import { useEffect, useState, useTransition } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import {
  apiFetch,
  type ApiUser,
  type ChannelLink,
  type LinkCode,
  type Watchlist,
} from '../lib/api';

interface PrivyProfile {
  email?: { address?: string };
  wallet?: { address?: string };
}

export function DashboardShell() {
  const { ready, authenticated, login, logout, user, getAccessToken } = usePrivy();
  const [apiUser, setApiUser] = useState<ApiUser | null>(null);
  const [links, setLinks] = useState<ChannelLink[]>([]);
  const [linkCode, setLinkCode] = useState<LinkCode | null>(null);
  const [watchlist, setWatchlist] = useState<Watchlist | null>(null);
  const [symbol, setSymbol] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
    const [nextLinks, nextWatchlist] = await Promise.all([
      apiFetch<{ links: ChannelLink[] }>('/v1/channel-links', accessToken),
      apiFetch<{ watchlist: Watchlist }>('/v1/watchlist', accessToken),
    ]);
    setApiUser(synced.user);
    setLinks(nextLinks.links);
    setWatchlist(nextWatchlist.watchlist);
  }

  useEffect(() => {
    if (!ready || !authenticated) return;
    startTransition(() => {
      void refreshAll().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    });
  }, [ready, authenticated]);

  function run(action: () => Promise<void>) {
    setError(null);
    startTransition(() => {
      void action().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    });
  }

  if (!ready) {
    return (
      <main className="page-shell">
        <section className="hero-card">Preparing your market cockpit...</section>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="page-shell">
        <section className="hero-card hero-card--split">
          <div>
            <p className="eyebrow">My-Soso</p>
            <h1>Your crypto analyst, living where you already chat.</h1>
            <p className="lede">
              Sign in once, link Telegram, and give your agent the first hints about what to watch.
              No dashboard addiction required.
            </p>
          </div>
          <button className="primary-button" onClick={login}>
            Sign in with email
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Phase 2</p>
          <h1>Connect your agent</h1>
        </div>
        <button className="ghost-button" onClick={logout}>
          Sign out
        </button>
      </header>

      {error ? <div className="error-box">{error}</div> : null}

      <section className="grid">
        <article className="panel">
          <p className="eyebrow">Account</p>
          <h2>{apiUser?.email ?? 'Syncing account...'}</h2>
          <p className="muted">User id: {apiUser?.id ?? '...'}</p>
          <p className="muted">Wallet: {apiUser?.walletAddress ?? 'Privy wallet pending'}</p>
        </article>

        <article className="panel accent-panel">
          <p className="eyebrow">Telegram link</p>
          <h2>Generate a 10-minute link code</h2>
          <p className="muted">
            Send the command to the bot from your private Telegram chat. The bot will attach that
            Telegram id to this signed-in account.
          </p>
          <button
            className="primary-button"
            disabled={isPending}
            onClick={() =>
              run(async () => {
                const accessToken = await token();
                const next = await apiFetch<LinkCode>('/v1/link-codes', accessToken, {
                  method: 'POST',
                  body: JSON.stringify({ channel: 'telegram' }),
                });
                setLinkCode(next);
              })
            }
          >
            Generate /link code
          </button>
          {linkCode ? (
            <div className="code-card">
              <span>{linkCode.command}</span>
              <small>Expires in {Math.round(linkCode.expiresInSeconds / 60)} minutes</small>
            </div>
          ) : null}
        </article>

        <article className="panel">
          <p className="eyebrow">Linked channels</p>
          <h2>{links.length === 0 ? 'No channels linked yet' : `${links.length} linked`}</h2>
          <div className="stack">
            {links.map((link) => (
              <div className="row-card" key={link.id}>
                <strong>{link.channel}</strong>
                <span>{link.channelUserId}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <p className="eyebrow">Watchlist</p>
          <h2>{watchlist?.name ?? 'Default'}</h2>
          <form
            className="inline-form"
            onSubmit={(event) => {
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
            }}
          >
            <input
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
              placeholder="BTC"
              aria-label="Asset symbol"
            />
            <button className="primary-button" disabled={!symbol.trim() || isPending}>
              Add
            </button>
          </form>
          <div className="pill-row">
            {watchlist?.items.map((item) => (
              <button
                className="asset-pill"
                key={item.id}
                onClick={() =>
                  run(async () => {
                    const accessToken = await token();
                    await apiFetch(
                      `/v1/watchlist/items/${encodeURIComponent(item.symbol)}`,
                      accessToken,
                      {
                        method: 'DELETE',
                      },
                    );
                    const next = await apiFetch<{ watchlist: Watchlist }>(
                      '/v1/watchlist',
                      accessToken,
                    );
                    setWatchlist(next.watchlist);
                  })
                }
              >
                {item.symbol}
                <span>×</span>
              </button>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
