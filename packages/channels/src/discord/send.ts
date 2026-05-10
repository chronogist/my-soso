const DISCORD_API = 'https://discord.com/api/v10';

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
