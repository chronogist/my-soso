'use client';

import Link from 'next/link';
import { useState, type ChangeEvent } from 'react';
import type { BotPreferences, Tone, Verbosity, NewsStrength } from '../lib/api';
import { AccountSummaryCard, CHANNEL_META, handoffAction } from './hub-shared';
import { DIGEST_OPTIONS, PRICE_OP_OPTIONS, formatAlertDetail, useHubState } from './use-hub-state';

type Tab = 'overview' | 'alerts' | 'personality' | 'coverage' | 'channels';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'personality', label: 'Personality' },
  { id: 'coverage', label: 'Coverage' },
  { id: 'channels', label: 'Channels & Safety' },
];

const TONE_OPTIONS: { value: Tone; label: string }[] = [
  { value: 'concise', label: 'Concise' },
  { value: 'detailed', label: 'Detailed' },
  { value: 'casual', label: 'Casual' },
  { value: 'formal', label: 'Formal' },
];

const VERBOSITY_OPTIONS: { value: Verbosity; label: string }[] = [
  { value: 'short', label: 'Short' },
  { value: 'normal', label: 'Normal' },
  { value: 'long', label: 'Long' },
];

const NEWS_STRENGTH_OPTIONS: { value: NewsStrength; label: string; hint: string }[] = [
  { value: 'major_only', label: 'Major only', hint: 'Highest-severity headlines' },
  { value: 'portfolio', label: 'Portfolio', hint: 'Anything that moves your watchlist' },
  { value: 'all', label: 'All', hint: 'Every relevant article' },
];

const DIGEST_SECTION_OPTIONS: { value: BotPreferences['digestSections'][number]; label: string }[] =
  [
    { value: 'prices', label: 'Prices' },
    { value: 'news', label: 'News' },
    { value: 'etf_flows', label: 'ETF flows' },
    { value: 'indices', label: 'SSI indices' },
    { value: 'macro', label: 'Macro events' },
  ];

const NEWS_SOURCE_OPTIONS: { value: 'hot' | 'featured' | 'search'; label: string }[] = [
  { value: 'hot', label: 'Hot' },
  { value: 'featured', label: 'Featured' },
  { value: 'search', label: 'Search' },
];

const COVERAGE_OPTIONS: { key: keyof BotPreferences['coverage']; label: string; desc: string }[] = [
  { key: 'currencies', label: 'Currencies', desc: 'Top crypto market data + klines' },
  { key: 'etfs', label: 'ETFs', desc: 'BTC/ETH ETF summary, flows, history' },
  { key: 'ssiIndices', label: 'SSI indices', desc: 'On-chain spot index protocol' },
  { key: 'cryptoStocks', label: 'Crypto stocks', desc: 'Equities with sector tagging' },
  { key: 'btcTreasuries', label: 'BTC treasuries', desc: 'Corporate holdings + purchases' },
  { key: 'fundraising', label: 'Fundraising', desc: 'Project investment rounds' },
  { key: 'macro', label: 'Macro events', desc: 'Economic calendar + drivers' },
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function DailyHub() {
  const state = useHubState();
  const {
    ready,
    authenticated,
    chosenChannel,
    apiUser,
    links,
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
    addWatchlistItem,
    removeWatchlistItem,
    createAlert,
    toggleAlert,
    deleteAlert,
    updateDigest,
    changePlatform,
    signOut,
  } = state;

  const [tab, setTab] = useState<Tab>('overview');

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

  const linkedChannel = links.find((link) => link.channel === chosenChannel);
  const isLinked = Boolean(linkedChannel);
  const setExtra = (key: string, value: string) =>
    setAlertExtras((current) => ({ ...current, [key]: value }));
  const patch = (next: Partial<BotPreferences>) => savePreferences({ ...preferences, ...next });

  return (
    <main className="hub">
      <div className="hub__brand">
        <span className="entry__brand-dot" />
        MySoSo
      </div>

      <aside className="hub__sidebar">
        <AccountSummaryCard apiUser={apiUser} />

        <article className="hub__card">
          <header className="hub__card-head">
            <span className="hub__eyebrow">Watchlist</span>
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
                    type="button"
                  >
                    ×
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
            <span className="hub__eyebrow">Linked Channels ({links.length})</span>
          </header>
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
        </article>
      </aside>

      <section className="hub__main">
        <div className="hub__main-head">
          <span className={`hub__pill ${isLinked ? 'hub__pill--ok' : 'hub__pill--warn'}`}>
            {isLinked ? 'LIVE LINKED' : 'SETUP NEEDED'}
          </span>
          <span className="hub__node">ENCRYPTED NODE 04</span>
        </div>

        <h1 className="hub__title">Daily Hub</h1>
        <p className="hub__lede">
          Tune how your {CHANNEL_META[chosenChannel].name} agent talks, alerts, and digests.
        </p>

        {error ? <div className="hub__error">{error}</div> : null}

        <nav className="hub__tabs" role="tablist" aria-label="Hub sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`hub__tab ${tab === t.id ? 'is-active' : ''}`}
              onClick={() => setTab(t.id)}
              type="button"
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'overview' ? (
          <div className="hub__panels">
            <div className="hub__success-panel">
              <div>
                <h2 className="hub__section">Active Channel</h2>
                <p>
                  {isLinked
                    ? `${CHANNEL_META[chosenChannel].name} is live for ${linkedChannel?.channelUserId}.`
                    : `This channel still needs linking before the agent can reply live.`}
                </p>
              </div>
              <div className="hub__success-actions">
                {handoffAction(chosenChannel)}
                <Link className="hub__secondary-link" href="/setup">
                  Manage Setup
                </Link>
              </div>
            </div>

            <article className="hub__panel">
              <h2 className="hub__section">Digest cadence</h2>
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

              <div className="hub__row">
                <label className="hub__field">
                  <span>Delivery time</span>
                  <input
                    type="time"
                    value={preferences.digestTime}
                    onChange={(e) => patch({ digestTime: e.target.value })}
                  />
                </label>
                <label className="hub__field">
                  <span>Timezone</span>
                  <input
                    type="text"
                    value={preferences.timezone}
                    onChange={(e) => patch({ timezone: e.target.value })}
                    placeholder="e.g. America/New_York"
                  />
                </label>
                {digestSchedule === 'weekly' ? (
                  <label className="hub__field">
                    <span>Weekday</span>
                    <select
                      value={preferences.digestWeekday}
                      onChange={(e) => patch({ digestWeekday: Number(e.target.value) })}
                    >
                      {WEEKDAYS.map((d, i) => (
                        <option key={d} value={i}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>

              <h3 className="hub__subsection">Sections to include</h3>
              <div className="hub__chips">
                {DIGEST_SECTION_OPTIONS.map((opt) => {
                  const on = preferences.digestSections.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      className={`hub__chip ${on ? 'is-on' : ''}`}
                      onClick={() =>
                        patch({
                          digestSections: on
                            ? preferences.digestSections.filter((s) => s !== opt.value)
                            : [...preferences.digestSections, opt.value],
                        })
                      }
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </article>
          </div>
        ) : null}

        {tab === 'alerts' ? (
          <div className="hub__panels">
            <article className="hub__panel">
              <header className="hub__controls-head">
                <h2 className="hub__section">Alerts</h2>
                <span>{alerts.filter((a) => a.active).length} active</span>
              </header>

              <form className="hub__alert-form" onSubmit={createAlert}>
                <select
                  value={alertKind}
                  onChange={(e) => setAlertKind(e.target.value as typeof alertKind)}
                  aria-label="Alert type"
                >
                  <option value="price">Price</option>
                  <option value="news">News</option>
                  <option value="etf_flow">ETF flow</option>
                  <option value="index_move">Index move</option>
                  <option value="sentiment">Sentiment shift</option>
                  <option value="macro">Macro event</option>
                </select>
                <input
                  value={alertSymbol}
                  onChange={(e) => setAlertSymbol(e.target.value.toUpperCase())}
                  placeholder={alertKind === 'macro' ? 'GLOBAL' : 'Symbol'}
                  aria-label="Alert symbol"
                />

                {alertKind === 'price' ? (
                  <>
                    <select
                      value={alertOp}
                      onChange={(e) => setAlertOp(e.target.value as typeof alertOp)}
                    >
                      {PRICE_OP_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <input
                      value={alertThreshold}
                      onChange={(e) => setAlertThreshold(e.target.value)}
                      inputMode="decimal"
                      placeholder="USD"
                    />
                  </>
                ) : null}

                {alertKind === 'etf_flow' ? (
                  <>
                    <select
                      value={alertExtras.direction ?? 'either'}
                      onChange={(e) => setExtra('direction', e.target.value)}
                    >
                      <option value="inflow">Inflow</option>
                      <option value="outflow">Outflow</option>
                      <option value="either">Either</option>
                    </select>
                    <input
                      value={alertExtras.minUsd ?? ''}
                      onChange={(e) => setExtra('minUsd', e.target.value)}
                      inputMode="decimal"
                      placeholder="Min USD"
                    />
                  </>
                ) : null}

                {alertKind === 'index_move' ? (
                  <input
                    value={alertExtras.movePct ?? ''}
                    onChange={(e) => setExtra('movePct', e.target.value)}
                    inputMode="decimal"
                    placeholder="Move %"
                  />
                ) : null}

                {alertKind === 'sentiment' ? (
                  <select
                    value={alertExtras.direction ?? 'either'}
                    onChange={(e) => setExtra('direction', e.target.value)}
                  >
                    <option value="bullish">Bullish</option>
                    <option value="bearish">Bearish</option>
                    <option value="either">Either</option>
                  </select>
                ) : null}

                {alertKind === 'macro' ? (
                  <select
                    value={alertExtras.severity ?? 'high'}
                    onChange={(e) => setExtra('severity', e.target.value)}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                ) : null}

                <button
                  type="submit"
                  disabled={
                    isPending ||
                    (alertKind !== 'macro' && !alertSymbol.trim()) ||
                    (alertKind === 'price' && !alertThreshold.trim()) ||
                    (alertKind === 'etf_flow' && !alertExtras.minUsd) ||
                    (alertKind === 'index_move' && !alertExtras.movePct)
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
                        ×
                      </button>
                    </li>
                  ))
                ) : (
                  <li className="hub__linked-empty">No alerts configured yet.</li>
                )}
              </ul>
            </article>

            <article className="hub__panel">
              <h2 className="hub__section">News filter</h2>
              <p className="hub__hint">How aggressively the agent filters incoming news.</p>
              <div className="hub__segmented">
                {NEWS_STRENGTH_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={preferences.newsFilter.strength === opt.value ? 'is-active' : ''}
                    onClick={() =>
                      patch({
                        newsFilter: { ...preferences.newsFilter, strength: opt.value },
                      })
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <h3 className="hub__subsection">Sources</h3>
              <div className="hub__chips">
                {NEWS_SOURCE_OPTIONS.map((opt) => {
                  const on = preferences.newsFilter.sources.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      className={`hub__chip ${on ? 'is-on' : ''}`}
                      onClick={() =>
                        patch({
                          newsFilter: {
                            ...preferences.newsFilter,
                            sources: on
                              ? preferences.newsFilter.sources.filter((s) => s !== opt.value)
                              : [...preferences.newsFilter.sources, opt.value],
                          },
                        })
                      }
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <label className="hub__toggle-row">
                <input
                  type="checkbox"
                  checked={preferences.newsFilter.explainImpact}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    patch({
                      newsFilter: { ...preferences.newsFilter, explainImpact: e.target.checked },
                    })
                  }
                />
                <span>Explain why each news item matters</span>
              </label>
            </article>

            <article className="hub__panel">
              <h2 className="hub__section">Quiet hours & throttling</h2>
              <label className="hub__toggle-row">
                <input
                  type="checkbox"
                  checked={preferences.quietHours.enabled}
                  onChange={(e) =>
                    patch({
                      quietHours: { ...preferences.quietHours, enabled: e.target.checked },
                    })
                  }
                />
                <span>Enable quiet hours</span>
              </label>
              <div className="hub__row">
                <label className="hub__field">
                  <span>From</span>
                  <input
                    type="time"
                    value={preferences.quietHours.start}
                    onChange={(e) =>
                      patch({
                        quietHours: { ...preferences.quietHours, start: e.target.value },
                      })
                    }
                    disabled={!preferences.quietHours.enabled}
                  />
                </label>
                <label className="hub__field">
                  <span>To</span>
                  <input
                    type="time"
                    value={preferences.quietHours.end}
                    onChange={(e) =>
                      patch({
                        quietHours: { ...preferences.quietHours, end: e.target.value },
                      })
                    }
                    disabled={!preferences.quietHours.enabled}
                  />
                </label>
              </div>
              <div className="hub__row">
                <label className="hub__field">
                  <span>Max pings / hour</span>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={preferences.throttling.maxPerHour}
                    onChange={(e) =>
                      patch({
                        throttling: {
                          ...preferences.throttling,
                          maxPerHour: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label className="hub__field">
                  <span>Max pings / day</span>
                  <input
                    type="number"
                    min={0}
                    max={500}
                    value={preferences.throttling.maxPerDay}
                    onChange={(e) =>
                      patch({
                        throttling: {
                          ...preferences.throttling,
                          maxPerDay: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              </div>
            </article>
          </div>
        ) : null}

        {tab === 'personality' ? (
          <div className="hub__panels">
            <article className="hub__panel">
              <h2 className="hub__section">Tone</h2>
              <div className="hub__segmented">
                {TONE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={preferences.tone === o.value ? 'is-active' : ''}
                    onClick={() => patch({ tone: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>

              <h3 className="hub__subsection">Verbosity</h3>
              <div className="hub__segmented">
                {VERBOSITY_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={preferences.verbosity === o.value ? 'is-active' : ''}
                    onClick={() => patch({ verbosity: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>

              <div className="hub__row">
                <label className="hub__field">
                  <span>Language</span>
                  <input
                    type="text"
                    value={preferences.language}
                    onChange={(e) => patch({ language: e.target.value })}
                    placeholder="en"
                  />
                </label>
              </div>
            </article>

            <article className="hub__panel">
              <h2 className="hub__section">Formatting</h2>
              {(
                [
                  ['includeCharts', 'Include charts when available'],
                  ['includeLinks', 'Include source links'],
                  ['includeCitations', 'Cite sources inline'],
                  ['memoCommandEnabled', 'Enable /memo command (when shipped)'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="hub__toggle-row">
                  <input
                    type="checkbox"
                    checked={preferences.formatting[key]}
                    onChange={(e) =>
                      patch({
                        formatting: { ...preferences.formatting, [key]: e.target.checked },
                      })
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </article>
          </div>
        ) : null}

        {tab === 'coverage' ? (
          <div className="hub__panels">
            <article className="hub__panel">
              <h2 className="hub__section">Coverage breadth</h2>
              <p className="hub__hint">
                Which SoSoValue modules the agent can pull from. Disabled modules are skipped during
                Q&amp;A and digests.
              </p>
              <ul className="hub__coverage">
                {COVERAGE_OPTIONS.map((o) => (
                  <li key={o.key}>
                    <label className="hub__toggle-row">
                      <input
                        type="checkbox"
                        checked={preferences.coverage[o.key]}
                        onChange={(e) =>
                          patch({
                            coverage: { ...preferences.coverage, [o.key]: e.target.checked },
                          })
                        }
                      />
                      <div>
                        <strong>{o.label}</strong>
                        <small>{o.desc}</small>
                      </div>
                    </label>
                  </li>
                ))}
              </ul>
            </article>
          </div>
        ) : null}

        {tab === 'channels' ? (
          <div className="hub__panels">
            <article className="hub__panel">
              <h2 className="hub__section">Per-channel preferences</h2>
              <p className="hub__hint">
                Override tone or mute alerts for specific channels (e.g. terse on WhatsApp due to
                template costs).
              </p>
              {(['telegram', 'discord', 'whatsapp'] as const).map((ch) => {
                const ov = preferences.channelOverrides[ch] ?? {};
                return (
                  <div key={ch} className="hub__override">
                    <strong>{CHANNEL_META[ch].name}</strong>
                    <label className="hub__field">
                      <span>Tone</span>
                      <select
                        value={ov.tone ?? ''}
                        onChange={(e) =>
                          patch({
                            channelOverrides: {
                              ...preferences.channelOverrides,
                              [ch]: {
                                ...ov,
                                tone: (e.target.value || undefined) as Tone | undefined,
                              },
                            },
                          })
                        }
                      >
                        <option value="">Inherit</option>
                        {TONE_OPTIONS.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="hub__toggle-row">
                      <input
                        type="checkbox"
                        checked={Boolean(ov.muteAlerts)}
                        onChange={(e) =>
                          patch({
                            channelOverrides: {
                              ...preferences.channelOverrides,
                              [ch]: { ...ov, muteAlerts: e.target.checked },
                            },
                          })
                        }
                      />
                      <span>Mute alerts</span>
                    </label>
                  </div>
                );
              })}
            </article>

            <article className="hub__panel hub__panel--locked">
              <h2 className="hub__section">Compliance & safety</h2>
              <p className="hub__hint">
                The agent is locked to advisory-only output. Trading controls unlock in Wave 3 once
                SoDEX execution + Privy session keys ship.
              </p>
              <ul className="hub__locked-list">
                <li>
                  <span>Advisory-only classifier</span>
                  <em>Active</em>
                </li>
                <li>
                  <span>Trade size cap</span>
                  <em>Locked</em>
                </li>
                <li>
                  <span>Daily spend cap</span>
                  <em>Locked</em>
                </li>
                <li>
                  <span>2FA on execution</span>
                  <em>Locked</em>
                </li>
                <li>
                  <span>SSI auto-rebalance</span>
                  <em>Locked</em>
                </li>
              </ul>
            </article>
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
