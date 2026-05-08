import { createAnthropic } from '@ai-sdk/anthropic';
import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { Logger } from 'pino';

export const AuditClassificationSchema = z.enum([
  'market_info',
  'education',
  'personalized_analysis',
  'recommendation',
  'execution',
]);

export type AuditClassification = z.infer<typeof AuditClassificationSchema>;

const ClassificationResultSchema = z.object({
  classification: AuditClassificationSchema,
  rationale: z
    .string()
    .min(1)
    .max(160)
    .describe('Short reason for the classification.'),
});

const SYSTEM_PROMPT = `You classify outbound crypto assistant replies for compliance review.

Classify the assistant reply into exactly one bucket:
- market_info: descriptive market update with no user-specific framing or advice
- education: explanatory or conceptual information
- personalized_analysis: user-specific analysis, comparisons, or watchlist context without an action recommendation
- recommendation: tells the user what to buy, sell, hold, rotate into, or names a "best" asset/action
- execution: provides a trade plan or execution details such as entry, exit, position size, leverage, stop loss, or instructions to place a trade

Be conservative. If a reply explicitly nudges the user toward an action, classify it as recommendation. If it includes trading mechanics, classify it as execution.

Return only the structured result.`;

const FALLBACK_RESPONSE =
  "I can help explain what's moving the market, compare assets, and outline risks, but I can't tell you what to buy, sell, or how to size a trade. Ask me about catalysts, momentum, or risks for a specific asset and I'll keep it analytical.";

export interface ComplianceDeps {
  anthropicApiKey: string;
  model?: string;
  log: Logger;
}

export interface ComplianceReviewInput {
  userMessage: string;
  assistantReply: string;
  conversationId: string;
}

export interface ComplianceReview {
  classification: AuditClassification;
  responseText: string;
  sanitized: boolean;
  rationale: string;
}

export interface ComplianceClassifier {
  review: (input: ComplianceReviewInput) => Promise<ComplianceReview>;
}

export function createComplianceClassifier(deps: ComplianceDeps): ComplianceClassifier {
  const anthropic = createAnthropic({ apiKey: deps.anthropicApiKey });
  const modelId = deps.model ?? 'claude-haiku-4-5-20251001';
  const model = anthropic(modelId) as LanguageModel;

  return {
    review: async ({ userMessage, assistantReply, conversationId }) => {
      try {
        const { object } = await generateObject({
          model,
          system: SYSTEM_PROMPT,
          prompt: [`User message: ${userMessage}`, `Assistant reply: ${assistantReply}`].join('\n\n'),
          schema: ClassificationResultSchema,
          maxOutputTokens: 120,
          headers: { 'x-conversation-id': `${conversationId}:compliance` },
        });

        const sanitized =
          object.classification === 'recommendation' || object.classification === 'execution';

        return {
          classification: object.classification,
          responseText: sanitized ? FALLBACK_RESPONSE : assistantReply,
          sanitized,
          rationale: object.rationale,
        };
      } catch (err) {
        deps.log.warn({ err, conversationId }, 'compliance classification failed');
        return {
          classification: 'market_info',
          responseText: assistantReply,
          sanitized: false,
          rationale: 'classifier_error_defaulted_to_market_info',
        };
      }
    },
  };
}
