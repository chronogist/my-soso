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
