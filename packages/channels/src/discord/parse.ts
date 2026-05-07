import { z } from 'zod';

const InteractionUserSchema = z.object({
  id: z.string(),
  username: z.string().optional(),
});

const SlashCommandOptionSchema = z.object({
  name: z.string(),
  type: z.number().int(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const DiscordInteractionSchema = z.object({
  id: z.string(),
  application_id: z.string(),
  type: z.number().int(),
  token: z.string(),
  channel_id: z.string().optional(),
  data: z
    .object({
      name: z.string(),
      options: z.array(SlashCommandOptionSchema).optional(),
    })
    .optional(),
  member: z
    .object({
      user: InteractionUserSchema,
    })
    .optional(),
  user: InteractionUserSchema.optional(),
});

export type DiscordInteraction = z.infer<typeof DiscordInteractionSchema>;

export const DISCORD_INTERACTION = {
  PING: 1,
  APPLICATION_COMMAND: 2,
} as const;

export const DISCORD_RESPONSE = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
} as const;

export function interactionUserId(interaction: DiscordInteraction): string | null {
  return interaction.member?.user.id ?? interaction.user?.id ?? null;
}

export function slashCommandText(interaction: DiscordInteraction): string | null {
  if (!interaction.data) return null;
  const command = interaction.data.name.toLowerCase();
  const options = interaction.data.options ?? [];

  switch (command) {
    case 'ask': {
      const prompt = options.find((option) => option.name === 'prompt')?.value;
      return typeof prompt === 'string' ? prompt.trim() : null;
    }
    case 'watch': {
      const prompt = options.find((option) => option.name === 'prompt')?.value;
      return typeof prompt === 'string' ? prompt.trim() : 'What is on my watchlist?';
    }
    case 'alert': {
      const prompt = options.find((option) => option.name === 'prompt')?.value;
      return typeof prompt === 'string' ? prompt.trim() : 'What alerts do I currently have?';
    }
    case 'link': {
      const code = options.find((option) => option.name === 'code')?.value;
      return typeof code === 'string' ? `/link ${code.trim()}` : null;
    }
    case 'memo':
      return `/${command}`;
    default:
      return null;
  }
}
