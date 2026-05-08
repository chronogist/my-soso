'use client';

import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import {
  apiFetch,
  type ApiUser,
  type ChannelLink,
  type LinkCode,
  type Watchlist,
} from '../lib/api';

type Channel = 'telegram' | 'discord' | 'whatsapp';

interface PrivyProfile {
  email?: { address?: string };
  wallet?: { address?: string };
}

interface ChannelOption {
  id: Channel;
  name: string;
  tagline: string;
  available: boolean;
}

const CHANNELS: ChannelOption[] = [
  {
    id: 'telegram',
    name: 'Telegram',
    tagline: 'Ready to connect',
    available: true,
  },
  { id: 'whatsapp', name: 'WhatsApp', tagline: 'Ready to connect', available: true },
  { id: 'discord', name: 'Discord', tagline: 'Ready to connect', available: true },
];

const CHOSEN_CHANNEL_KEY = 'mysoso.chosenChannel';

function readChosenChannel(): Channel | null {
  if (typeof window === 'undefined') return null;
  const stored = window.localStorage.getItem(CHOSEN_CHANNEL_KEY);
  if (stored === 'telegram' || stored === 'discord' || stored === 'whatsapp') return stored;
  return null;
}

function persistChosenChannel(channel: Channel | null) {
  if (typeof window === 'undefined') return;
  if (channel) window.localStorage.setItem(CHOSEN_CHANNEL_KEY, channel);
  else window.localStorage.removeItem(CHOSEN_CHANNEL_KEY);
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
  const [chosenChannel, setChosenChannel] = useState<Channel | null>(null);

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

    // If a returning user already linked a channel, jump straight into setup
    // for that channel and skip the picker.
    const stored = readChosenChannel();
    if (stored) {
      setChosenChannel(stored);
    } else if (nextLinks.links.length > 0) {
      const firstLinked = nextLinks.links[0]!.channel;
      persistChosenChannel(firstLinked);
      setChosenChannel(firstLinked);
    }
  }

  useEffect(() => {
    if (!ready || !authenticated) {
      setChosenChannel(null);
      setApiUser(null);
      setLinks([]);
      setWatchlist(null);
      return;
    }
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

  function pickChannel(channel: Channel) {
    persistChosenChannel(channel);
    setChosenChannel(channel);
    setLinkCode(null);
  }

  function clearChannel() {
    persistChosenChannel(null);
    setChosenChannel(null);
    setLinkCode(null);
  }

  if (!ready) {
    return (
      <main className="entry">
        <div className="entry__brand">
          <span className="entry__brand-dot" />
          MySoSo
        </div>
        <section className="entry__card entry__card--loading">Booting protocol…</section>
      </main>
    );
  }

  if (!chosenChannel) {
    function selectChannel(channel: Channel) {
      if (authenticated) {
        pickChannel(channel);
      } else {
        persistChosenChannel(channel);
        login();
      }
    }

    return (
      <main className="entry">
        <div className="entry__brand">
          <span className="entry__brand-dot" />
          MySoSo
        </div>
        <div className="entry__badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 2L3 7l9 5 9-5-9-5zM3 12l9 5 9-5M3 17l9 5 9-5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
          SOSOVALUE
        </div>

        <div className="entry__orb" aria-hidden />
        <div className="entry__bubble entry__bubble--alert" aria-hidden>
          Alert: ETH crossed 3k
        </div>
        <div className="entry__bubble entry__bubble--summary" aria-hidden>
          Show my weekly summary
        </div>
        <div className="entry__bubble entry__bubble--transfer" aria-hidden>
          Transfer 50 USDC to saving
        </div>

        <section className="entry__card">
          <p className="entry__eyebrow">
            <span className="entry__pulse" /> SYSTEM ACTIVE
          </p>
          <h1 className="entry__title">
            Manage Your Money Where
            <br />
            You Already Chat.
          </h1>
          <p className="entry__lede">
            No new apps. No switching platforms. Your AI finance assistant lives directly in your
            daily conversations.
          </p>

          <div className="entry__meta">
            <span>Select Protocol</span>
            <span>End-to-End Encrypted</span>
          </div>

          {error ? <div className="entry__error">{error}</div> : null}

          <ul className="entry__protocols">
            <li>
              <button
                type="button"
                className="entry__protocol"
                onClick={() => selectChannel('telegram')}
                aria-label="Continue with Telegram"
              >
                <span className="entry__protocol-icon entry__protocol-icon--telegram">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M21.5 3.5L2.5 11.2c-.9.4-.9 1.7.1 2l4.7 1.5 1.8 5.7c.2.7 1.1.9 1.6.3l2.6-2.7 4.6 3.4c.6.4 1.4.1 1.6-.6L22.7 4.7c.2-.8-.6-1.5-1.2-1.2zM10 14.6l-.5 3.6-1.5-4.7 9.5-6.2L10 14.6z"
                      fill="currentColor"
                    />
                  </svg>
                </span>
                <span className="entry__protocol-text">
                  <strong>Telegram</strong>
                  <small>Ready to connect</small>
                </span>
                <span className="entry__protocol-arrow">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M5 12h14m0 0l-6-6m6 6l-6 6"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="entry__protocol"
                onClick={() => selectChannel('whatsapp')}
                aria-label="Continue with WhatsApp"
              >
                <span className="entry__protocol-icon entry__protocol-icon--whatsapp">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M20.5 3.5A11.6 11.6 0 0012.2 0C5.7 0 .5 5.2.5 11.6c0 2 .5 3.9 1.5 5.6L.4 24l7-1.8a11.6 11.6 0 0017.3-10c0-3.1-1.2-6-3.4-8.2zM12.2 21.7c-1.8 0-3.6-.5-5.1-1.4l-.4-.2-4.1 1.1 1.1-4-.2-.4a9.6 9.6 0 1117.8-5.1 9.6 9.6 0 01-9.1 10zm5.3-7.2c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-1 1.1-.2.2-.4.2-.7.1-.3-.1-1.2-.5-2.3-1.4a8.8 8.8 0 01-1.6-2c-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5 0-.2 0-.4-.1-.5-.1-.2-.7-1.7-1-2.3-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1.1 1.1-1.1 2.6 0 1.5 1.1 3 1.3 3.2.2.2 2.2 3.4 5.4 4.7.7.3 1.3.5 1.8.6.7.2 1.4.2 2 .1.6-.1 1.7-.7 2-1.4.2-.7.2-1.2.2-1.4 0-.1-.3-.2-.6-.4z"
                      fill="currentColor"
                    />
                  </svg>
                </span>
                <span className="entry__protocol-text">
                  <strong>WhatsApp</strong>
                  <small>Ready to connect</small>
                </span>
                <span className="entry__protocol-arrow">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M5 12h14m0 0l-6-6m6 6l-6 6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="entry__protocol"
                onClick={() => selectChannel('discord')}
                aria-label="Continue with Discord"
              >
                <span className="entry__protocol-icon entry__protocol-icon--discord">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M20.3 4.4A19.8 19.8 0 0015.6 3l-.2.4a18.4 18.4 0 00-6.8 0L8.4 3a19.7 19.7 0 00-4.7 1.4A20.7 20.7 0 00.4 18a20 20 0 006 3l.5-.7a13 13 0 01-2-1l.4-.3a14.2 14.2 0 0012.2 0l.4.3a13 13 0 01-2 1l.5.7a20 20 0 006-3 20.6 20.6 0 00-2.6-13.7zM8 15c-1.2 0-2.2-1.1-2.2-2.4S6.7 10.2 8 10.2c1.2 0 2.2 1.1 2.2 2.4S9.2 15 8 15zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4c1.3 0 2.2 1.1 2.2 2.4S17.2 15 16 15z"
                      fill="currentColor"
                    />
                  </svg>
                </span>
                <span className="entry__protocol-text">
                  <strong>Discord</strong>
                  <small>Ready to connect</small>
                </span>
                <span className="entry__protocol-arrow">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M5 12h14m0 0l-6-6m6 6l-6 6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </button>
            </li>
          </ul>
        </section>
      </main>
    );
  }

  const channelMeta = CHANNELS.find((c) => c.id === chosenChannel)!;
  const isLinked = links.some((l) => l.channel === chosenChannel);

  function generateLinkCode() {
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

  const accountIdShort = apiUser?.id
    ? `SOSO-${apiUser.id.replace(/-/g, '').slice(0, 4).toUpperCase()}-${apiUser.id.replace(/-/g, '').slice(-2).toUpperCase()}`
    : '...';
  const walletShort = apiUser?.walletAddress
    ? `${apiUser.walletAddress.slice(0, 5)}...${apiUser.walletAddress.slice(-4)}`
    : 'Privy wallet pending';

  const channelInstructions: Record<Channel, { handle: string; step1: React.ReactNode }> = {
    telegram: {
      handle: '@MySoSoBot',
      step1: (
        <>
          Open Telegram and search for <strong>@MySoSoBot</strong>
        </>
      ),
    },
    whatsapp: {
      handle: 'the MySoSo number',
      step1: (
        <>
          Open WhatsApp and message <strong>the MySoSo number</strong>
        </>
      ),
    },
    discord: {
      handle: 'MySoSo Bot',
      step1: (
        <>
          Open Discord and DM <strong>MySoSo Bot</strong>
        </>
      ),
    },
  };
  const instructions = channelInstructions[chosenChannel];

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
            <button className="hub__icon-btn" onClick={logout} aria-label="Sign out">
              +
            </button>
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
          <button
            className="hub__cta"
            disabled={isPending}
            onClick={generateLinkCode}
          >
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
              <span>{instructions.step1}</span>
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
          <button className="hub__ghost" onClick={clearChannel}>
            Change Platform
          </button>
          <button className="hub__ghost hub__ghost--danger" onClick={logout}>
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
