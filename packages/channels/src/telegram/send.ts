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
    text: opts.text,
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
