const DISCORD_API = 'https://discord.com/api/v10';

/**
 * Reply to a Discord interaction via followup webhook. Used for slash
 * commands and modal interactions. Requires `applicationId` + `interactionToken`
 * from the interaction payload. Returns `{ ok: false, description }` on
 * Discord-side errors so the caller can decide whether to retry.
 */
export async function sendDiscordFollowupMessage(opts: {
  applicationId: string;
  interactionToken: string;
  text: string;
}): Promise<{ ok: true } | { ok: false; description: string }> {
  const res = await fetch(
    `${DISCORD_API}/webhooks/${opts.applicationId}/${opts.interactionToken}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: opts.text }),
    },
  );

  if (!res.ok) {
    return { ok: false, description: await res.text() };
  }

  return { ok: true };
}

/**
 * Send a message to a Discord channel directly. Used for alert notifications
 * and digest pushes, not in response to a user interaction. Requires a Bot
 * token with proper permissions for the target channel.
 */
export async function sendDiscordChannelMessage(opts: {
  botToken: string;
  channelId: string;
  text: string;
}): Promise<{ ok: true } | { ok: false; description: string }> {
  const res = await fetch(`${DISCORD_API}/channels/${opts.channelId}/messages`, {
    method: 'POST',
    headers: {
      authorization: `Bot ${opts.botToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ content: opts.text }),
  });

  if (!res.ok) {
    return { ok: false, description: await res.text() };
  }

  return { ok: true };
}

/**
 * Show the Discord typing indicator in a channel. The indicator auto-clears
 * after ~10 seconds. Failures are swallowed — the indicator is cosmetic and
 * must never block message delivery.
 */
export async function sendDiscordTyping(opts: {
  botToken: string;
  channelId: string;
}): Promise<void> {
  try {
    await fetch(`${DISCORD_API}/channels/${opts.channelId}/typing`, {
      method: 'POST',
      headers: {
        authorization: `Bot ${opts.botToken}`,
        'content-type': 'application/json',
      },
    });
  } catch {
    return;
  }
}
