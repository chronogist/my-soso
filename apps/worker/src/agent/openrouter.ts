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
  return {
    model: openrouter(modelId),
    modelId,
  };
}
