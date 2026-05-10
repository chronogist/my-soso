'use client';

import Link from 'next/link';
import {
  AccountSummaryCard,
  CHANNEL_META,
  LinkCodeCard,
  NotificationTray,
  channelInstructions,
  handoffAction,
  linkedChannelCopy,
  renderDiscordEndpoint,
} from './hub-shared';
import { useHubState } from './use-hub-state';

export function SetupHub() {
  const {
    ready,
    authenticated,
    chosenChannel,
    apiUser,
    links,
    linkCode,
    error,
    notifications,
    dismissNotification,
    isPending,
    initialLoaded,
    generateLinkCode,
    changePlatform,
    signOut,
  } = useHubState({ pollForLink: true });

  // Gate the page on initialLoaded so users who are already linked never
  // see a "NOT LINKED / Generate Link Code" flash while /v1/channel-links
  // is in flight. Same shell for both pre-auth and post-auth-pre-fetch.
  if (!ready || !authenticated || !chosenChannel || !initialLoaded) {
    return (
      <main className="entry">
        <div className="entry__brand">
          <span className="entry__brand-dot" />
          MySoSo
        </div>
        <section className="entry__card entry__card--loading">
          <span className="entry__loading-dots" aria-hidden>
            <span />
            <span />
            <span />
          </span>
          Checking your link status…
        </section>
      </main>
    );
  }

  const channelMeta = CHANNEL_META[chosenChannel];
  const linkedChannel = links.find((link) => link.channel === chosenChannel);
  const isLinked = Boolean(linkedChannel);

  return (
    <main className="hub">
      <NotificationTray notifications={notifications} onDismiss={dismissNotification} />
      <div className="hub__brand">
        <span className="entry__brand-dot" />
        MySoSo
      </div>

      <aside className="hub__sidebar">
        <AccountSummaryCard apiUser={apiUser} />

        <article className="hub__card">
          <header className="hub__card-head">
            <span className="hub__eyebrow">Onboarding Status</span>
          </header>
          <ul className="hub__status-list">
            <li>
              <span className={`hub__status-dot ${isLinked ? 'is-ready' : ''}`} />
              <div>
                <strong>{channelMeta.name} link</strong>
                <small>
                  {isLinked
                    ? 'Connected and ready for live messages'
                    : 'Waiting for link confirmation'}
                </small>
              </div>
            </li>
            <li>
              <span className={`hub__status-dot ${linkCode ? 'is-ready' : ''}`} />
              <div>
                <strong>Link command</strong>
                <small>
                  {linkCode ? 'Code issued and being monitored' : 'Generate a code to continue'}
                </small>
              </div>
            </li>
          </ul>
        </article>

        <article className="hub__card">
          <header className="hub__card-head">
            <span className="hub__eyebrow">Next After Linking</span>
          </header>
          <div className="hub__next">
            <p>Your daily controls live in the hub once this channel is connected.</p>
            <ul>
              <li>Manage watchlist symbols</li>
              <li>Create and pause alerts</li>
              <li>Set digest cadence</li>
            </ul>
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
          Link your {channelMeta.name} account here, then move into the hub for your day-to-day
          watchlist, alerts, and digests.
        </p>

        {error ? <div className="hub__error">{error}</div> : null}

        {!isLinked ? (
          <>
            <button className="hub__cta" disabled={isPending} onClick={generateLinkCode}>
              {linkCode?.channel === chosenChannel ? 'Regenerate Link Code' : 'Generate Link Code'}
            </button>
            {linkCode?.channel === chosenChannel ? <LinkCodeCard code={linkCode} /> : null}
          </>
        ) : (
          <>
            <div className="hub__linked-banner">
              {channelMeta.name} is connected. You can head straight into the hub now.
            </div>
            <div className="hub__relink">
              <p>
                Switching to a different {channelMeta.name} account, or re-linking after a reset?
              </p>
              <button
                className="hub__ghost"
                disabled={isPending}
                onClick={generateLinkCode}
                type="button"
              >
                {linkCode?.channel === chosenChannel
                  ? 'Regenerate Re-link Code'
                  : `Re-link ${channelMeta.name}`}
              </button>
              {linkCode?.channel === chosenChannel ? <LinkCodeCard code={linkCode} /> : null}
            </div>
          </>
        )}

        <div className="hub__instructions">
          <h2 className="hub__section">Link Instructions</h2>
          <ol>
            <li>
              <span className="hub__step">1</span>
              <span>{channelInstructions(chosenChannel)}</span>
            </li>
            <li>
              <span className="hub__step">2</span>
              <span>Paste the command generated above into the chat.</span>
            </li>
            <li>
              <span className="hub__step">3</span>
              <span>Wait here a moment while the dashboard confirms the live link.</span>
            </li>
          </ol>
        </div>

        <div className="hub__handoff">
          <div>
            <h2 className="hub__section">Live Entrypoint</h2>
            <p>{linkedChannelCopy(chosenChannel, linkedChannel)}</p>
            {renderDiscordEndpoint(chosenChannel)}
          </div>
          {handoffAction(chosenChannel)}
        </div>

        {isLinked ? (
          <div className="hub__success-panel">
            <div>
              <h2 className="hub__section">Ready For Daily Use</h2>
              <p>
                Go to the hub to manage alerts, your watchlist, and digest cadence without
                revisiting onboarding.
              </p>
            </div>
            <Link className="hub__primary-link" href="/hub">
              Open Hub
            </Link>
          </div>
        ) : null}

        <footer className="hub__footer">
          <button className="hub__ghost" onClick={changePlatform}>
            Change Platform
          </button>
          <button className="hub__ghost hub__ghost--danger" onClick={signOut}>
            Sign Out
          </button>
        </footer>
      </section>
    </main>
  );
}
