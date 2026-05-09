import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

export function createOpenRouterModel({
  apiKey,
  model,
}: {
  apiKey: string;
  model?: string | undefined;
}): {
  model: LanguageModel;
  modelId: string;
} {
  const openrouter = createOpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
  });
  const modelId = model ?? DEFAULT_MODEL;
  // Force Chat Completions (not Responses API). @ai-sdk/openai v3
  // defaults to OpenAI's newer Responses API when called as
  // `openrouter(modelId)`, which OpenRouter's compatibility layer does
  // not fully support — tool-call roundtrips fail with
  // "Invalid Responses API request" / invalid_prompt. `.chat()` pins
  // the legacy chat-completions endpoint that OpenRouter mirrors 1:1.
  return {
    model: openrouter.chat(modelId),
    modelId,
  };
}
