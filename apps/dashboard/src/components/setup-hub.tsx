'use client';

import { useEffect, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import {
  apiFetch,
  type ApiUser,
  type ChannelLink,
  type LinkCode,
  type Watchlist,
} from '../lib/api';
import {
  CHANNELS,
  type Channel,
  persistChosenChannel,
  readChosenChannel,
} from '../lib/channels';

interface PrivyProfile {
  email?: { address?: string };
  wallet?: { address?: string };
}

export function SetupHub() {
  const router = useRouter();
  const { ready, authenticated, logout, user, getAccessToken } = usePrivy();
  const [chosenChannel, setChosenChannel] = useState<Channel | null>(() => readChosenChannel());
  const [apiUser, setApiUser] = useState<ApiUser | null>(null);
  const [links, setLinks] = useState<ChannelLink[]>([]);
  const [linkCode, setLinkCode] = useState<LinkCode | null>(null);
  const [watchlist, setWatchlist] = useState<Watchlist | null>(null);
  const [symbol, setSymbol] = useState('');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const [nextLinks, nextWatchlist] = await Promise.all([
      apiFetch<{ links: ChannelLink[] }>('/v1/channel-links', accessToken),
      apiFetch<{ watchlist: Watchlist }>('/v1/watchlist', accessToken),
    ]);
    setApiUser(synced.user);
    setLinks(nextLinks.links);
    setWatchlist(nextWatchlist.watchlist);
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
        Open Telegram and search for <strong>@MySoSoBot</strong>
      </>
    ),
    whatsapp: (
      <>
        Open WhatsApp and message <strong>the MySoSo number</strong>
      </>
    ),
    discord: (
      <>
        Open Discord and DM <strong>MySoSo Bot</strong>
      </>
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

        {linkCode?.channel === chosenChannel && !isLinked ? (
          <LinkCodeCard code={linkCode} />
        ) : null}

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
