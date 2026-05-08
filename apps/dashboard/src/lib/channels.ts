export type Channel = 'telegram' | 'discord' | 'whatsapp';

export interface ChannelOption {
  id: Channel;
  name: string;
  tagline: string;
  available: boolean;
}

export const CHANNELS: ChannelOption[] = [
  { id: 'telegram', name: 'Telegram', tagline: 'Ready to connect', available: true },
  { id: 'whatsapp', name: 'WhatsApp', tagline: 'Ready to connect', available: true },
  { id: 'discord', name: 'Discord', tagline: 'Ready to connect', available: true },
];

const CHOSEN_CHANNEL_KEY = 'mysoso.chosenChannel';

export function readChosenChannel(): Channel | null {
  if (typeof window === 'undefined') return null;
  const stored = window.localStorage.getItem(CHOSEN_CHANNEL_KEY);
  if (stored === 'telegram' || stored === 'discord' || stored === 'whatsapp') return stored;
  return null;
}

export function persistChosenChannel(channel: Channel | null) {
  if (typeof window === 'undefined') return;
  if (channel) window.localStorage.setItem(CHOSEN_CHANNEL_KEY, channel);
  else window.localStorage.removeItem(CHOSEN_CHANNEL_KEY);
}
