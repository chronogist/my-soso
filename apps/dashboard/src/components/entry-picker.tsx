'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import {
  type Channel,
  persistChosenChannel,
  persistSwitchingPlatform,
  readChosenChannel,
  readSwitchingPlatform,
} from '../lib/channels';
import { apiFetch, type ChannelLink } from '../lib/api';

export function EntryPicker() {
  const router = useRouter();
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const [resolving, setResolving] = useState(false);
  const [links, setLinks] = useState<ChannelLink[]>([]);
  const [chosenChannel, setChosenChannel] = useState<Channel | null>(() => readChosenChannel());

  useEffect(() => {
    if (!ready || !authenticated) return;
    let cancelled = false;
    setResolving(true);
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) {
          if (!cancelled && chosenChannel) router.replace('/setup');
          return;
        }
        const { links } = await apiFetch<{ links: ChannelLink[] }>('/v1/channel-links', token);
        if (cancelled) return;
        setLinks(links);
        const isSwitchingPlatform = readSwitchingPlatform();
        if (isSwitchingPlatform) return;
        if (links.length > 0) {
          // Returning user with at least one linked channel — pin the first
          // linked channel so /hub has a chosenChannel to render against,
          // then hand them to /hub directly. They can still revisit /setup
          // from the hub if they need to adjust or add another channel.
          if (!chosenChannel) {
            persistChosenChannel(links[0]!.channel);
            setChosenChannel(links[0]!.channel);
          }
          router.replace('/hub');
          return;
        }
        if (chosenChannel) router.replace('/setup');
      } catch {
        // API unreachable — fall through and let the picker render so the
        // user can still choose a platform manually. If they already picked
        // a channel before authenticating, continue onboarding instead of
        // forcing an unnecessary second click.
        if (!cancelled && chosenChannel) router.replace('/setup');
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, chosenChannel, getAccessToken, router]);

  function selectChannel(channel: Channel) {
    persistSwitchingPlatform(false);
    persistChosenChannel(channel);
    setChosenChannel(channel);
    if (authenticated) {
      router.push('/setup');
    } else {
      login();
    }
  }

  if (!ready || (authenticated && resolving)) {
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

  const isLinked = (channel: Channel) => links.some((link) => link.channel === channel);

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

      <div className="entry__story" aria-hidden>
        <div className="entry__story-wordmark entry__story-wordmark--left">🐼 MySoSo Panda</div>
        <div className="entry__story-wordmark entry__story-wordmark--right">
          Signal to Execution
        </div>
        <div className="entry__story-rail">
          <span className="entry__story-node">Signal</span>
          <span className="entry__story-line" />
          <span className="entry__story-node">Context</span>
          <span className="entry__story-line" />
          <span className="entry__story-node">Conviction</span>
          <span className="entry__story-line" />
          <span className="entry__story-node entry__story-node--accent">Execution</span>
        </div>
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
                <small>{isLinked('telegram') ? 'Already linked' : 'Ready to connect'}</small>
              </span>
              {isLinked('telegram') ? <span className="entry__protocol-state">Linked</span> : null}
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
                <small>{isLinked('whatsapp') ? 'Already linked' : 'Ready to connect'}</small>
              </span>
              {isLinked('whatsapp') ? <span className="entry__protocol-state">Linked</span> : null}
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
                <small>{isLinked('discord') ? 'Already linked' : 'Ready to connect'}</small>
              </span>
              {isLinked('discord') ? <span className="entry__protocol-state">Linked</span> : null}
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
