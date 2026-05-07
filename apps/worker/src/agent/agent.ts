import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, stepCountIs, type LanguageModel } from 'ai';
import type { Logger } from 'pino';
import type { MarketDataProvider, NewsProvider } from '@my-soso/providers';
import { buildAgentTools } from './tools.js';
import { SYSTEM_PROMPT } from './system-prompt.js';

export interface AgentDeps {
  market: MarketDataProvider;
  news: NewsProvider;
  log: Logger;
  anthropicApiKey: string;
  /** Anthropic model id. Default: claude-haiku-4-5-20251001. */
  model?: string;
  /** Maximum tool-use steps before forcing a final answer. Default 4. */
  maxSteps?: number;
  /** Hard cap on output tokens. Default 600. */
  maxOutputTokens?: number;
}

export interface RunAgentInput {
  userMessage: string;
  /** Stable conversation id; passed through to provider for tracing. */
  conversationId: string;
}

export interface RunAgentResult {
  text: string;
  steps: number;
  totalTokens: number | undefined;
  finishReason: string;
}

export interface Agent {
  run: (input: RunAgentInput) => Promise<RunAgentResult>;
}

export function createAgent(deps: AgentDeps): Agent {
  const anthropic = createAnthropic({ apiKey: deps.anthropicApiKey });
  const model = anthropic(deps.model ?? 'claude-haiku-4-5-20251001') as LanguageModel;
  const maxSteps = deps.maxSteps ?? 4;
  const maxOutputTokens = deps.maxOutputTokens ?? 600;
  const tools = buildAgentTools({ market: deps.market, news: deps.news });

  return {
    run: async ({ userMessage, conversationId }) => {
      const result = await generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt: userMessage,
        tools,
        stopWhen: stepCountIs(maxSteps),
        maxOutputTokens,
        // Pass conversation id through so Anthropic logs / Sentry traces
        // can be correlated to a chat thread without leaking user PII.
        headers: { 'x-conversation-id': conversationId },
      });

      const finalText = (result.text ?? '').trim();
      // Defensive: if the model burned all steps on tools without
      // producing prose, fall back to a brief honest message rather
      // than echoing nothing.
      const text =
        finalText.length > 0
          ? finalText
          : "I couldn't put together an answer just now. Try rephrasing the question.";

      deps.log.info(
        {
          conversationId,
          steps: result.steps.length,
          finishReason: result.finishReason,
          totalTokens: result.usage.totalTokens,
        },
        'agent run complete',
      );

      return {
        text,
        steps: result.steps.length,
        totalTokens: result.usage.totalTokens,
        finishReason: result.finishReason,
      };
    },
  };
}
