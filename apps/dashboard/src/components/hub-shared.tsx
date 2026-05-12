'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { ApiUser, ChannelLink, LinkCode } from '../lib/api';
import type { Channel } from '../lib/channels';

export interface HubNotification {
  id: string;
  kind: 'loading' | 'success' | 'error';
  message: string;
}

const TELEGRAM_BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? 'mysoso_agent_bot';
const TELEGRAM_BOT_URL =
  process.env.NEXT_PUBLIC_TELEGRAM_BOT_URL ?? 'https://t.me/mysoso_agent_bot';
const DISCORD_INSTALL_URL = process.env.NEXT_PUBLIC_DISCORD_INSTALL_URL;
const DISCORD_INTERACTIONS_URL = process.env.NEXT_PUBLIC_DISCORD_INTERACTIONS_URL;
const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '';
const WHATSAPP_DEEPLINK = process.env.NEXT_PUBLIC_WHATSAPP_DEEPLINK;

export const CHANNEL_META: Record<Channel, { name: string; accentLabel: string }> = {
  telegram: { name: 'Telegram', accentLabel: 'Telegram blue' },
  whatsapp: { name: 'WhatsApp', accentLabel: 'WhatsApp green' },
  discord: { name: 'Discord', accentLabel: 'Discord blurple' },
};

export function ChannelIcon({
  channel,
  className = '',
}: {
  channel: Channel;
  className?: string;
}) {
  const cls = ['hub__platform-icon', `hub__platform-icon--${channel}`, className].filter(Boolean).join(' ');

  switch (channel) {
    case 'telegram':
      return (
        <span className={cls} aria-hidden title={CHANNEL_META[channel].accentLabel}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M21.5 3.5L2.5 11.2c-.9.4-.9 1.7.1 2l4.7 1.5 1.8 5.7c.2.7 1.1.9 1.6.3l2.6-2.7 4.6 3.4c.6.4 1.4.1 1.6-.6L22.7 4.7c.2-.8-.6-1.5-1.2-1.2zM10 14.6l-.5 3.6-1.5-4.7 9.5-6.2L10 14.6z"
              fill="currentColor"
            />
          </svg>
        </span>
      );
    case 'whatsapp':
      return (
        <span className={cls} aria-hidden title={CHANNEL_META[channel].accentLabel}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M20.5 3.5A11.6 11.6 0 0012.2 0C5.7 0 .5 5.2.5 11.6c0 2 .5 3.9 1.5 5.6L.4 24l7-1.8a11.6 11.6 0 0017.3-10c0-3.1-1.2-6-3.4-8.2zM12.2 21.7c-1.8 0-3.6-.5-5.1-1.4l-.4-.2-4.1 1.1 1.1-4-.2-.4a9.6 9.6 0 1117.8-5.1 9.6 9.6 0 01-9.1 10zm5.3-7.2c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-1 1.1-.2.2-.4.2-.7.1-.3-.1-1.2-.5-2.3-1.4a8.8 8.8 0 01-1.6-2c-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5 0-.2 0-.4-.1-.5-.1-.2-.7-1.7-1-2.3-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1.1 1.1-1.1 2.6 0 1.5 1.1 3 1.3 3.2.2.2 2.2 3.4 5.4 4.7.7.3 1.3.5 1.8.6.7.2 1.4.2 2 .1.6-.1 1.7-.7 2-1.4.2-.7.2-1.2.2-1.4 0-.1-.3-.2-.6-.4z"
              fill="currentColor"
            />
          </svg>
        </span>
      );
    case 'discord':
      return (
        <span className={cls} aria-hidden title={CHANNEL_META[channel].accentLabel}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M20.3 4.4A19.8 19.8 0 0015.6 3l-.2.4a18.4 18.4 0 00-6.8 0L8.4 3a19.7 19.7 0 00-4.7 1.4A20.7 20.7 0 00.4 18a20 20 0 006 3l.5-.7a13 13 0 01-2-1l.4-.3a14.2 14.2 0 0012.2 0l.4.3a13 13 0 01-2 1l.5.7a20 20 0 006-3 20.6 20.6 0 00-2.6-13.7zM8 15c-1.2 0-2.2-1.1-2.2-2.4S6.7 10.2 8 10.2c1.2 0 2.2 1.1 2.2 2.4S9.2 15 8 15zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4c1.3 0 2.2 1.1 2.2 2.4S17.2 15 16 15z"
              fill="currentColor"
            />
          </svg>
        </span>
      );
  }
}

export function ChannelLabel({
  channel,
  current = false,
}: {
  channel: Channel;
  current?: boolean;
}) {
  return (
    <span className="hub__channel-label">
      <ChannelIcon channel={channel} />
      <span>
        {CHANNEL_META[channel].name}
        {current ? ' (current)' : ''}
      </span>
    </span>
  );
}

export function formatAccountId(id: string | undefined) {
  return id
    ? `SOSO-${id.replace(/-/g, '').slice(0, 4).toUpperCase()}-${id.replace(/-/g, '').slice(-2).toUpperCase()}`
    : '...';
}

export function formatWallet(walletAddress: string | null | undefined) {
  return walletAddress
    ? `${walletAddress.slice(0, 5)}...${walletAddress.slice(-4)}`
    : 'Privy wallet pending';
}

export function channelInstructions(chosenChannel: Channel): ReactNode {
  switch (chosenChannel) {
    case 'telegram':
      return (
        <>
          Open Telegram and message{' '}
          <a href={TELEGRAM_BOT_URL} target="_blank" rel="noreferrer">
            @{TELEGRAM_BOT_USERNAME}
          </a>
        </>
      );
    case 'whatsapp':
      return (
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
      );
    case 'discord':
      return (
        <>
          {DISCORD_INSTALL_URL ? (
            <a href={DISCORD_INSTALL_URL} target="_blank" rel="noreferrer">
              Add MySoSo to your Discord apps
            </a>
          ) : (
            <strong>Add MySoSo to your Discord apps</strong>
          )}
        </>
      );
  }
}

export function handoffAction(chosenChannel: Channel): ReactNode {
  switch (chosenChannel) {
    case 'telegram':
      return (
        <a className="hub__action-link" href={TELEGRAM_BOT_URL} target="_blank" rel="noreferrer">
          Open @{TELEGRAM_BOT_USERNAME}
        </a>
      );
    case 'discord':
      return DISCORD_INSTALL_URL ? (
        <a className="hub__action-link" href={DISCORD_INSTALL_URL} target="_blank" rel="noreferrer">
          Open Discord App Install
        </a>
      ) : (
        <span className="hub__action-link hub__action-link--muted">
          Discord install URL missing
        </span>
      );
    case 'whatsapp':
      return WHATSAPP_DEEPLINK ? (
        <a className="hub__action-link" href={WHATSAPP_DEEPLINK} target="_blank" rel="noreferrer">
          Open WhatsApp Chat
        </a>
      ) : (
        <span className="hub__action-link hub__action-link--muted">WhatsApp number missing</span>
      );
  }
}

export function linkedChannelCopy(chosenChannel: Channel, linkedChannel: ChannelLink | undefined) {
  const name = CHANNEL_META[chosenChannel].name;
  return linkedChannel
    ? `${name} is linked to ${linkedChannel.channelUserId}.`
    : chosenChannel === 'discord'
      ? 'Generate a link code, add MySoSo to your Discord apps, then open the DM and run /link with your code.'
      : `Generate a link code, then use the ${name} entrypoint.`;
}

export function renderDiscordEndpoint(chosenChannel: Channel) {
  if (chosenChannel === 'discord' && DISCORD_INTERACTIONS_URL) {
    return <span className="hub__endpoint">{DISCORD_INTERACTIONS_URL}</span>;
  }
  return null;
}

export function AccountSummaryCard({ apiUser }: { apiUser: ApiUser | null }) {
  return (
    <article className="hub__card">
      <header className="hub__card-head">
        <span className="hub__eyebrow">Account Summary</span>
      </header>
      <dl className="hub__meta">
        <dt>Primary Email</dt>
        <dd>{apiUser?.email ?? 'Syncing…'}</dd>
        <dt>Account ID</dt>
        <dd className="hub__mono">{formatAccountId(apiUser?.id)}</dd>
        <dt>Wallet Address</dt>
        <dd className="hub__mono">{formatWallet(apiUser?.walletAddress)}</dd>
      </dl>
    </article>
  );
}

export function LinkCodeCard({ code }: { code: LinkCode }) {
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

export function NotificationTray({
  notifications,
  onDismiss,
}: {
  notifications: HubNotification[];
  onDismiss: (id: string) => void;
}) {
  if (notifications.length === 0) return null;

  return (
    <div className="hub__toast-stack" aria-live="polite" aria-atomic="true">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`hub__toast hub__toast--${notification.kind}`}
          role="status"
        >
          <span>{notification.message}</span>
          {notification.kind === 'loading' ? (
            <span className="hub__toast-spinner" aria-hidden />
          ) : (
            <button
              className="hub__toast-close"
              onClick={() => onDismiss(notification.id)}
              type="button"
              aria-label="Dismiss notification"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
