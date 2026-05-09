import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config.js';

interface NgrokTunnel {
  public_url: string;
  proto: string;
  config: { addr: string };
}

const NGROK_LOCAL_API = 'http://127.0.0.1:4040/api/tunnels';
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 30_000;

async function findHttpsTunnelForPort(port: number): Promise<string | null> {
  const res = await fetch(NGROK_LOCAL_API);
  if (!res.ok) return null;
  const data = (await res.json()) as { tunnels?: NgrokTunnel[] };
  const tunnels = data.tunnels ?? [];
  const match = tunnels.find((t) => t.proto === 'https' && t.config.addr.endsWith(`:${port}`));
  return match?.public_url ?? null;
}

async function setTelegramWebhook(opts: {
  botToken: string;
  url: string;
  secret: string;
}): Promise<{ ok: boolean; description?: string; status: number }> {
  const params = new URLSearchParams({
    url: opts.url,
    secret_token: opts.secret,
    drop_pending_updates: 'false',
  });
  const res = await fetch(`https://api.telegram.org/bot${opts.botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
  };
  return {
    ok: Boolean(body.ok),
    ...(body.description ? { description: body.description } : {}),
    status: res.status,
  };
}

/**
 * In dev, auto-discover the ngrok https tunnel pointing at Edge and register
 * it as the Telegram webhook. Lets `pnpm dev` (with `ngrok http 3002` running)
 * pick up a fresh tunnel URL on every restart without manual setWebhook calls.
 *
 * In prod, set TELEGRAM_WEBHOOK_URL explicitly and registration runs once with
 * that value.
 */
export async function autoRegisterTelegramWebhook(
  config: Config,
  log: FastifyBaseLogger,
): Promise<void> {
  if (!config.TELEGRAM_BOT_TOKEN) {
    log.debug('telegram auto-register skipped: TELEGRAM_BOT_TOKEN not set');
    return;
  }

  // Honor an explicit TELEGRAM_WEBHOOK_URL only if it is a publicly reachable
  // https URL — Telegram rejects http and any localhost/private host, and
  // dev `.env` files commonly carry a stale localhost value.
  let publicUrl: string | null = null;
  if (config.TELEGRAM_WEBHOOK_URL) {
    try {
      const u = new URL(config.TELEGRAM_WEBHOOK_URL);
      const isLocal =
        u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname.endsWith('.local');
      if (u.protocol === 'https:' && !isLocal) {
        publicUrl = config.TELEGRAM_WEBHOOK_URL;
      } else {
        log.info(
          { TELEGRAM_WEBHOOK_URL: config.TELEGRAM_WEBHOOK_URL },
          'telegram auto-register: TELEGRAM_WEBHOOK_URL is not a public https URL; falling back to ngrok auto-discovery',
        );
      }
    } catch {
      log.warn(
        { TELEGRAM_WEBHOOK_URL: config.TELEGRAM_WEBHOOK_URL },
        'telegram auto-register: TELEGRAM_WEBHOOK_URL is not a valid URL; falling back to ngrok auto-discovery',
      );
    }
  }

  // The configured URL may already include the path; the ngrok-discovered
  // URL is bare and needs the path appended below.
  const explicitFullUrl = publicUrl?.includes('/webhooks/telegram') ?? false;

  if (!publicUrl) {
    const startedAt = Date.now();
    log.info({ port: config.PORT }, 'telegram auto-register: polling ngrok local API for tunnel');
    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      try {
        publicUrl = await findHttpsTunnelForPort(config.PORT);
        if (publicUrl) break;
      } catch {
        // ngrok not running yet — keep polling
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  if (!publicUrl) {
    log.warn(
      { port: config.PORT },
      `telegram auto-register: no ngrok https tunnel found for port ${config.PORT}. ` +
        `Run \`ngrok http ${config.PORT}\` (or set TELEGRAM_WEBHOOK_URL) and restart.`,
    );
    return;
  }

  const webhookUrl = explicitFullUrl
    ? publicUrl
    : publicUrl.replace(/\/+$/, '') + '/webhooks/telegram';
  const result = await setTelegramWebhook({
    botToken: config.TELEGRAM_BOT_TOKEN,
    url: webhookUrl,
    secret: config.TELEGRAM_WEBHOOK_SECRET,
  });

  if (!result.ok) {
    log.error(
      { status: result.status, description: result.description, webhookUrl },
      'telegram auto-register: setWebhook failed',
    );
    return;
  }

  log.info({ webhookUrl }, 'telegram auto-register: webhook registered');
}
