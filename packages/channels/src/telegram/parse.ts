import { z } from 'zod';

/**
 * Minimal Telegram Update schema covering the fields we use in Wave 1.
 * The full Update is much larger; we accept unknown fields and ignore them.
 */
const TelegramUserSchema = z
  .object({
    id: z.number().int(),
    is_bot: z.boolean().optional(),
    first_name: z.string().optional(),
    username: z.string().optional(),
    language_code: z.string().optional(),
  })
  .passthrough();

const TelegramChatSchema = z
  .object({
    id: z.number().int(),
    type: z.enum(['private', 'group', 'supergroup', 'channel']),
  })
  .passthrough();

const TelegramMessageSchema = z
  .object({
    message_id: z.number().int(),
    date: z.number().int(),
    chat: TelegramChatSchema,
    from: TelegramUserSchema.optional(),
    text: z.string().optional(),
  })
  .passthrough();

export const TelegramUpdateSchema = z
  .object({
    update_id: z.number().int(),
    message: TelegramMessageSchema.optional(),
    edited_message: TelegramMessageSchema.optional(),
  })
  .passthrough();

export type TelegramUpdate = z.infer<typeof TelegramUpdateSchema>;
export type TelegramMessage = z.infer<typeof TelegramMessageSchema>;

/** Returns the most recent inbound text message in an Update, or null. */
export function extractInboundMessage(update: TelegramUpdate): TelegramMessage | null {
  return update.message ?? update.edited_message ?? null;
}
