import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return;
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] ??= value;
  }
}

loadEnv(resolve(import.meta.dirname, '../../..', '.env'));

const applicationId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

console.log(`Registering commands for Application ID: ${applicationId}`);
if (guildId) console.log(`Targeting Guild ID: ${guildId}`);

if (!applicationId) {
  console.error('DISCORD_APPLICATION_ID is required');
  process.exit(1);
}

if (!botToken) {
  console.error('DISCORD_BOT_TOKEN is required');
  process.exit(1);
}

const commands = [
  {
    name: 'ask',
    description: 'Ask My-Soso a market question',
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      {
        type: 3,
        name: 'prompt',
        description: 'Your question',
        required: true,
      },
    ],
  },
  {
    name: 'link',
    description: 'Link this Discord account to My-Soso',
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      {
        type: 3,
        name: 'code',
        description: 'Your 6-character dashboard link code',
        required: true,
      },
    ],
  },
  {
    name: 'watch',
    description: 'Manage or inspect your watchlist',
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      {
        type: 3,
        name: 'prompt',
        description: 'Example: add BTC to my watchlist',
        required: false,
      },
    ],
  },
  {
    name: 'alert',
    description: 'Create or inspect your alerts',
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      {
        type: 3,
        name: 'prompt',
        description: 'Example: alert me when ETH rises above 3000',
        required: false,
      },
    ],
  },
  {
    name: 'memo',
    description: 'Generate a short market memo from your watchlist and recent news',
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      {
        type: 3,
        name: 'prompt',
        description: 'Optional focus, for example BTC and ETH this week',
        required: false,
      },
    ],
  },
];

const route = guildId
  ? `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${applicationId}/commands`;

const res = await fetch(route, {
  method: 'PUT',
  headers: {
    authorization: `Bot ${botToken?.trim()}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify(commands),
});

const body = await res.text();
if (!res.ok) {
  console.error(body);
  process.exit(1);
}

console.log(body);
