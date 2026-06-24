'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ChangeEvent } from 'react';
import type {
  BotPreferences,
  HoldingPatch,
  Tone,
  Verbosity,
  NewsStrength,
  WatchlistItem,
  WatchlistPortfolio,
} from '../lib/api';
import {
  AccountSummaryCard,
  CHANNEL_META,
  ChannelIcon,
  ChannelLabel,
  NotificationTray,
  handoffAction,
} from './hub-shared';
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
const PRICE_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});
const PRICE_FORMATTER_SMALL = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 6,
});

function formatPrice(priceUsd: number) {
  return priceUsd >= 1 ? PRICE_FORMATTER.format(priceUsd) : PRICE_FORMATTER_SMALL.format(priceUsd);
}

function formatUpdatedAt(asOf: string) {
  const deltaMs = Date.now() - new Date(asOf).getTime();
  if (Number.isNaN(deltaMs) || deltaMs < 0) return 'Updated just now';
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Updated ${days}d ago`;
}

function formatPnl(value: number) {
  const abs = Math.abs(value);
  const formatted = abs >= 1 ? PRICE_FORMATTER.format(value) : PRICE_FORMATTER_SMALL.format(value);
  return value >= 0 ? `+${formatted}` : formatted;
}

function PortfolioSummaryCard({ portfolio }: { portfolio: WatchlistPortfolio }) {
  const pnlPositive = portfolio.totalUnrealizedPnl >= 0;
  return (
    <div className="hub__portfolio-summary">
      <div className="hub__portfolio-row">
        <span className="hub__portfolio-label">Portfolio value</span>
        <strong className="hub__portfolio-value">
          {PRICE_FORMATTER.format(portfolio.totalCurrentValue)}
        </strong>
      </div>
      <div className="hub__portfolio-row">
        <span className="hub__portfolio-label">Unrealized P&L</span>
        <span
          className={`hub__portfolio-pnl ${pnlPositive ? 'hub__portfolio-pnl--up' : 'hub__portfolio-pnl--down'}`}
        >
          {formatPnl(portfolio.totalUnrealizedPnl)} (
          {portfolio.totalUnrealizedPnlPct >= 0 ? '+' : ''}
          {portfolio.totalUnrealizedPnlPct.toFixed(2)}%)
        </span>
      </div>
      <div className="hub__portfolio-row">
        <span className="hub__portfolio-label">Cost basis</span>
        <span className="hub__portfolio-cost">
          {PRICE_FORMATTER.format(portfolio.totalCostBasis)}
        </span>
      </div>
    </div>
  );
}

function WatchlistRow({
  item,
  isPending,
  isRemoving,
  onRemove,
  onUpdateHolding,
}: {
  item: WatchlistItem;
  isPending: boolean;
  isRemoving: boolean;
  onRemove: (symbol: string) => void;
  onUpdateHolding: (symbol: string, patch: HoldingPatch) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [qtyInput, setQtyInput] = useState(item.quantity !== null ? String(item.quantity) : '');
  const [entryInput, setEntryInput] = useState(
    item.avgEntryPrice !== null ? String(item.avgEntryPrice) : '',
  );
  const [dateInput, setDateInput] = useState(item.entryDate ?? '');

  const change = item.market?.change24hPct ?? null;
  const changeClass =
    change === null ? '' : change >= 0 ? 'hub__asset-change--up' : 'hub__asset-change--down';
  const pnl = item.holding;
  const pnlPositive = pnl !== null && pnl.unrealizedPnl >= 0;

  function saveHolding() {
    const qty = qtyInput.trim() ? Number(qtyInput) : null;
    const entry = entryInput.trim() ? Number(entryInput) : null;
    const date = dateInput.trim() || null;
    onUpdateHolding(item.symbol, { quantity: qty, avgEntryPrice: entry, entryDate: date });
    setExpanded(false);
  }

  function clearHolding() {
    setQtyInput('');
    setEntryInput('');
    setDateInput('');
    onUpdateHolding(item.symbol, { quantity: null, avgEntryPrice: null, entryDate: null });
    setExpanded(false);
  }

  return (
    <li className={expanded ? 'hub__watchlist-item--expanded' : ''}>
      <span className="hub__asset-icon">{item.symbol.slice(0, 1)}</span>
      <div className="hub__asset-body">
        <div className="hub__asset-topline">
          <div className="hub__asset-heading">
            <span className="hub__asset-name">{item.symbol}</span>
            <span className="hub__asset-tag">{item.assetKind}</span>
          </div>
          <span className={`hub__asset-change ${changeClass}`}>
            {change === null ? 'No change yet' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}
          </span>
        </div>
        <div className="hub__asset-bottomline">
          <strong className="hub__asset-price">
            {item.market ? formatPrice(item.market.priceUsd) : 'Price unavailable'}
          </strong>
          {pnl !== null ? (
            <span
              className={`hub__asset-pnl ${pnlPositive ? 'hub__asset-pnl--up' : 'hub__asset-pnl--down'}`}
            >
              {formatPnl(pnl.unrealizedPnl)} ({pnl.unrealizedPnlPct >= 0 ? '+' : ''}
              {pnl.unrealizedPnlPct.toFixed(2)}%)
            </span>
          ) : (
            <span className="hub__asset-updated">
              {isRemoving
                ? `Removing ${item.symbol}...`
                : item.market
                  ? formatUpdatedAt(item.market.asOf)
                  : 'Refresh on next load'}
            </span>
          )}
        </div>
        {expanded && (
          <div className="hub__holding-form">
            <div className="hub__holding-fields">
              <label className="hub__holding-field">
                <span>Quantity</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="e.g. 0.5"
                  value={qtyInput}
                  onChange={(e) => setQtyInput(e.target.value)}
                />
              </label>
              <label className="hub__holding-field">
                <span>Avg entry (USD)</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="e.g. 58000"
                  value={entryInput}
                  onChange={(e) => setEntryInput(e.target.value)}
                />
              </label>
              <label className="hub__holding-field">
                <span>Entry date</span>
                <input
                  type="date"
                  value={dateInput}
                  onChange={(e) => setDateInput(e.target.value)}
                />
              </label>
            </div>
            <div className="hub__holding-actions">
              <button
                type="button"
                className="hub__btn hub__btn--primary"
                onClick={saveHolding}
                disabled={isPending}
              >
                Save
              </button>
              {(item.quantity !== null || item.avgEntryPrice !== null) && (
                <button
                  type="button"
                  className="hub__btn hub__btn--ghost"
                  onClick={clearHolding}
                  disabled={isPending}
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                className="hub__btn hub__btn--ghost"
                onClick={() => setExpanded(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="hub__asset-actions">
        <button
          className="hub__icon-btn"
          aria-label={expanded ? 'Close holding editor' : 'Edit holding'}
          onClick={() => setExpanded((v) => !v)}
          type="button"
          disabled={isPending || isRemoving}
          title={expanded ? 'Close' : 'Track holding'}
        >
          {expanded ? '▲' : '▼'}
        </button>
        <button
          className="hub__icon-btn hub__icon-btn--danger"
          aria-label={isRemoving ? `Removing ${item.symbol}` : `Remove ${item.symbol}`}
          onClick={() => onRemove(item.symbol)}
          type="button"
          disabled={isPending || isRemoving}
        >
          {isRemoving ? '…' : '×'}
        </button>
      </div>
    </li>
  );
}

export function DailyHub() {
  const state = useHubState();
  const router = useRouter();
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
    symbolSuggestions,
    isLoadingSymbolSuggestions,
    isAddingWatchlistItem,
    removingWatchlistSymbol,
    chooseSymbolSuggestion,
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
    notifications,
    dismissNotification,
    isPending,
    initialLoaded,
    addWatchlistItem,
    removeWatchlistItem,
    updateHolding,
    createAlert,
    toggleAlert,
    deleteAlert,
    updateDigest,
    changePlatform,
    signOut,
  } = state;

  const [tab, setTab] = useState<Tab>('overview');

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
          Loading your hub…
        </section>
      </main>
    );
  }

  const linkedChannel = links.find((link) => link.channel === chosenChannel);
  const isLinked = Boolean(linkedChannel);
  const setExtra = (key: string, value: string) =>
    setAlertExtras((current) => ({ ...current, [key]: value }));
  const patch = (next: Partial<BotPreferences>) => savePreferences({ ...preferences, ...next });

  return (
    <main className={`hub hub--${chosenChannel}`}>
      <NotificationTray notifications={notifications} onDismiss={dismissNotification} />
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
            <div className="hub__typeahead">
              <input
                value={symbol}
                onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                placeholder="Add symbol (e.g. BTC)"
                aria-label="Asset symbol"
                autoComplete="off"
              />
              {(symbolSuggestions.length > 0 || (isLoadingSymbolSuggestions && symbol.trim())) && (
                <div className="hub__suggestions" role="listbox" aria-label="Suggested symbols">
                  {isLoadingSymbolSuggestions && symbolSuggestions.length === 0 ? (
                    <div className="hub__suggestion-empty">Searching symbols...</div>
                  ) : (
                    symbolSuggestions.map((suggestion) => (
                      <button
                        key={suggestion.symbol}
                        className="hub__suggestion"
                        onClick={() => chooseSymbolSuggestion(suggestion.symbol)}
                        type="button"
                      >
                        <span className="hub__suggestion-symbol">{suggestion.symbol}</span>
                        <span className="hub__suggestion-name">{suggestion.name}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <button type="submit" disabled={!symbol.trim() || isPending}>
              {isAddingWatchlistItem ? 'Adding...' : '+ Add'}
            </button>
          </form>
          {watchlist?.portfolio && <PortfolioSummaryCard portfolio={watchlist.portfolio} />}
          <ul className="hub__watchlist">
            {watchlist?.items.length ? (
              watchlist.items.map((item) => (
                <WatchlistRow
                  key={item.id}
                  item={item}
                  isPending={isPending}
                  isRemoving={removingWatchlistSymbol === item.symbol}
                  onRemove={removeWatchlistItem}
                  onUpdateHolding={updateHolding}
                />
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
                  <strong>
                    <ChannelLabel channel={link.channel} />
                  </strong>
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
          <span className="hub__node hub__node--platform">
            <ChannelIcon channel={chosenChannel} />
            {CHANNEL_META[chosenChannel].name} live
          </span>
        </div>

        <h1 className="hub__title">
          <span className="hub__title-platform">
            <ChannelIcon channel={chosenChannel} className="hub__title-icon" />
            <span>Daily Hub</span>
          </span>
        </h1>
        <p className="hub__lede">
          Tune how your {CHANNEL_META[chosenChannel].name} agent talks, alerts, and digests.
        </p>

        <section className="hub__persona hub__persona--compact">
          <div>
            <div className="hub__persona-mark">
              <span className="hub__persona-dot" />
              🐼 MySoSo Panda
            </div>
            <p className="hub__persona-copy">
              Your personal intelligent finance buddy on {CHANNEL_META[chosenChannel].name}. This is
              where you shape how your Panda speaks, what it watches, when it checks in, and how it
              grows from signal intelligence into execution-ready support.
            </p>
          </div>
        </section>

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
                <h2 className="hub__section">Your Panda Is Live On</h2>
                <p>
                  {isLinked
                    ? `${CHANNEL_META[chosenChannel].name} is live for ${linkedChannel?.channelUserId}.`
                    : `This channel still needs linking before your Panda can reply live.`}
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
              <h2 className="hub__section">When Your Panda Checks In</h2>
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
                  <span>Check-in time</span>
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
                <h2 className="hub__section">What Your Panda Should Watch</h2>
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
              <h2 className="hub__section">How Your Panda Speaks</h2>
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
              <h2 className="hub__section">Where Your Panda Can Reach You</h2>
              <p className="hub__hint">
                Override tone or mute alerts for specific channels (e.g. terse on WhatsApp due to
                template costs).
              </p>
              {(['telegram', 'discord', 'whatsapp'] as const).map((ch) => {
                const ov = preferences.channelOverrides[ch] ?? {};
                return (
                  <div key={ch} className="hub__override">
                    <strong>
                      <ChannelLabel channel={ch} />
                    </strong>
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
          <button className="hub__ghost" onClick={() => router.push('/setup')}>
            Manage Channels
          </button>
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
