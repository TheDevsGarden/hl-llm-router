import type { Context } from '@earendil-works/pi-ai';
import { extractTextFromContent } from '../routing';
import { estimateTokens } from '../shared/tokens';

/**
 * Truncate context to fit within a target token limit by removing oldest messages.
 * Always preserves the first system message and the latest user message.
 */
export const truncateContext = (context: Context, limit: number): Context => {
  const messages = [...context.messages];
  if (messages.length <= 1) return context;
  const systemTokens = context.systemPrompt ? estimateTokens(context.systemPrompt) : 0;
  const messageTokens = messages.map((m) => estimateTokens(extractTextFromContent(m.content)));
  const totalTokens = systemTokens + messageTokens.reduce((sum, t) => sum + t, 0);
  if (totalTokens <= limit) return context;
  const latestMessage = messages.pop();
  if (!latestMessage) return context;
  const latestTokens = messageTokens.pop() ?? 0;
  let activeMessagesTokensSum = messageTokens.reduce((sum, t) => sum + t, 0);
  let startIndex = 0;
  while (startIndex < messages.length) {
    const currentTokens = systemTokens + latestTokens + activeMessagesTokensSum;
    if (currentTokens <= limit) break;
    activeMessagesTokensSum -= messageTokens[startIndex];
    startIndex++;
  }
  const finalMessages = [...messages.slice(startIndex), latestMessage];
  return { ...context, messages: finalMessages };
};