import type { InboundJob } from '@my-soso/queue';

export interface CommandReply {
  text: string;
}

/**
 * Built-in command handlers. These run *before* the LLM agent and short-
 * circuit deterministic interactions like welcome flows. Anything that
 * doesn't match falls through to the agent (added in a later phase).
 *
 * In Wave 1 the only built-ins are `/start` and `/help`. Everything else
 * — natural language, market questions, alerts — goes through the LLM.
 */
const COMMANDS: Record<string, (job: InboundJob) => CommandReply> = {
  '/start': () => ({
    text:
      'Welcome to My-Soso, your personal finance agent.\n\n' +
      'Ask me anything about crypto markets, news, or your watchlist. ' +
      'Type /help to see what I can do.',
  }),
  '/help': () => ({
    text:
      'Things you can ask me:\n' +
      '• "How is BTC doing?"\n' +
      '• "Any major Solana news?"\n' +
      '• "Set an alert for ETH dropping below 3000"\n' +
      '• "Give me a one-pager on Hyperliquid"\n' +
      '• "/memo" for a concise watchlist market memo',
  }),
};

/** Returns a reply if the inbound text matches a built-in command, else null. */
export function handleCommand(job: InboundJob): CommandReply | null {
  const head = job.text.trim().split(/\s+/)[0]?.toLowerCase();
  if (!head) return null;
  const handler = COMMANDS[head];
  return handler ? handler(job) : null;
}
