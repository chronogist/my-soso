import { z } from 'zod';

const WhatsAppTextSchema = z.object({
  body: z.string(),
});

const WhatsAppMessageSchema = z
  .object({
    from: z.string(),
    id: z.string(),
    timestamp: z.string().optional(),
    type: z.string(),
    text: WhatsAppTextSchema.optional(),
  })
  .passthrough();

const WhatsAppValueSchema = z
  .object({
    messaging_product: z.literal('whatsapp').optional(),
    metadata: z
      .object({
        phone_number_id: z.string().optional(),
      })
      .optional(),
    contacts: z
      .array(
        z.object({
          wa_id: z.string().optional(),
        }),
      )
      .optional(),
    messages: z.array(WhatsAppMessageSchema).optional(),
    statuses: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const WhatsAppWebhookSchema = z
  .object({
    object: z.string(),
    entry: z.array(
      z
        .object({
          changes: z.array(
            z
              .object({
                field: z.string(),
                value: WhatsAppValueSchema,
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export type WhatsAppWebhook = z.infer<typeof WhatsAppWebhookSchema>;
export type WhatsAppMessage = z.infer<typeof WhatsAppMessageSchema>;

export interface ExtractedWhatsAppMessage {
  message: WhatsAppMessage;
  conversationId: string;
}

export function extractInboundWhatsAppMessages(payload: WhatsAppWebhook): ExtractedWhatsAppMessage[] {
  const extracted: ExtractedWhatsAppMessage[] = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const messages = change.value.messages ?? [];
      const fallbackConversationId = change.value.contacts?.[0]?.wa_id;

      for (const message of messages) {
        const conversationId = fallbackConversationId ?? message.from;
        extracted.push({ message, conversationId });
      }
    }
  }

  return extracted;
}
