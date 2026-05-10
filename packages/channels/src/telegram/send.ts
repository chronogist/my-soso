/**
 * Bot API base URL. Telegram routes per-token under https://api.telegram.org/bot<token>/...
 */
const TELEGRAM_API = 'https://api.telegram.org';

export interface SendTelegramMessageOptions {
  botToken: string;
  chatId: string | number;
  text: string;
  /** Inline keyboard buttons. Maximum 8 rows × 8 buttons per Telegram. */
  buttons?: { id: string; label: string }[];
}

export interface TelegramSendResult {
  ok: boolean;
  description?: string;
  message_id?: number;
}

function escapeTelegramHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function formatTelegramText(text: string): string {
  const escaped = escapeTelegramHtml(text);
  return escaped
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/**
 * Send a text message via Telegram's Bot API. Throws on transport errors;
 * returns `{ ok: false, description }` on Telegram-side errors so callers
 * can decide whether to retry.
 */
export async function sendTelegramMessage(
  opts: SendTelegramMessageOptions,
): Promise<TelegramSendResult> {
  const url = `${TELEGRAM_API}/bot${opts.botToken}/sendMessage`;

  const body: Record<string, unknown> = {
    chat_id: opts.chatId,
    text: formatTelegramText(opts.text),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  if (opts.buttons && opts.buttons.length > 0) {
    body.reply_markup = {
      inline_keyboard: [opts.buttons.map((b) => ({ text: b.label, callback_data: b.id }))],
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as TelegramSendResult & { result?: { message_id?: number } };
  if (!json.ok) {
    return { ok: false, description: json.description ?? `HTTP ${res.status}` };
  }
  const messageId = json.result?.message_id;
  return messageId === undefined ? { ok: true } : { ok: true, message_id: messageId };
}

export interface TelegramChatActionOptions {
  botToken: string;
  chatId: string | number;
  /** Default 'typing'. Telegram supports several but typing is what we
   * want for "agent is composing a reply". */
  action?:
    | 'typing'
    | 'upload_photo'
    | 'record_video'
    | 'upload_video'
    | 'record_voice'
    | 'upload_voice'
    | 'upload_document'
    | 'choose_sticker'
    | 'find_location'
    | 'record_video_note'
    | 'upload_video_note';
}

/**
 * Show the Telegram "typing…" indicator in a chat. The indicator
 * auto-clears after ~5 seconds — for longer agent runs the caller
 * should re-fire periodically. Failures are silent (the indicator is
 * cosmetic and a missing one must never block message delivery).
 */
export async function sendTelegramChatAction(opts: TelegramChatActionOptions): Promise<void> {
  const url = `${TELEGRAM_API}/bot${opts.botToken}/sendChatAction`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: opts.chatId,
        action: opts.action ?? 'typing',
      }),
    });
  } catch {
    // Cosmetic only — swallow network errors so the agent path is unaffected.
  }
}
