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

export const CHANNEL_META: Record<Channel, { name: string }> = {
  telegram: { name: 'Telegram' },
  whatsapp: { name: 'WhatsApp' },
  discord: { name: 'Discord' },
};

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
