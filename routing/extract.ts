import type { Context, Message } from '@earendil-works/pi-ai';

export const extractTextFromContent = (
  content: string | Message['content'],
): string => {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'thinking') return part.thinking;
      if (part.type === 'toolCall')
        return `${part.name} ${JSON.stringify(part.arguments)}`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
};

export const getLastUserText = (context: Context): string => {
  for (let i = context.messages.length - 1; i >= 0; i--) {
    const message = context.messages[i];
    if (message.role === 'user') {
      return extractTextFromContent(message.content).trim();
    }
  }
  return '';
};

export const getRecentConversationText = (
  context: Context,
  limit = 6,
): string => {
  return context.messages
    .slice(-limit)
    .map((message) => extractTextFromContent(message.content).trim())
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
};

export const countToolResults = (context: Context): number => {
  return context.messages.filter((message) => message.role === 'toolResult')
    .length;
};

export const countWords = (text: string): number => {
  return text.split(/\s+/).filter(Boolean).length;
};

export const hasImageAttachment = (context: Context): boolean => {
  return context.messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === 'image'),
  );
};

export { containsAny } from './sigil';

/**
 * pi's `convertToLlm` collapses four different things into `role: "user"`:
 * the human's typed message, compaction summaries, branch summaries, and the
 * output of a `!command` bash escape. Only the first is an instruction — the
 * rest are machine- or LLM-authored text that happens to land in the same
 * slot, and matching routing rules against them is how a `#sigil` the user
 * typed once gets replayed out of a summary on later turns.
 *
 * These are the markers pi stamps on the synthesized forms (see
 * pi-coding-agent `core/messages.js`: COMPACTION_SUMMARY_PREFIX,
 * BRANCH_SUMMARY_PREFIX, bashExecutionToText).
 */
const SYNTHESIZED_USER_PREFIXES: readonly string[] = [
  'the conversation history before this point was compacted into the following summary:',
  'the following is a summary of a branch that this conversation came back from:',
];

const BASH_EXECUTION_PATTERN = /^ran `/;

export const isSynthesizedUserText = (text: string): boolean => {
  const head = text.trimStart().toLowerCase();
  if (BASH_EXECUTION_PATTERN.test(head)) return true;
  return SYNTHESIZED_USER_PREFIXES.some((prefix) => head.startsWith(prefix));
};

/**
 * The newest user message that the human actually typed, skipping the
 * synthesized forms above. Returns '' when the context holds none — callers
 * decide whether to fall back.
 *
 * This is a *fallback* path. The authoritative source is the raw text captured
 * from pi's `input` event in ../index.ts, which knows the true provenance;
 * this reconstructs it from text markers for contexts where that event never
 * fired (subagents, direct provider use, tests).
 */
export const getHumanPromptText = (context: Context): string => {
  for (let i = context.messages.length - 1; i >= 0; i--) {
    const message = context.messages[i];
    if (message.role !== 'user') continue;
    const text = extractTextFromContent(message.content).trim();
    if (!isSynthesizedUserText(text)) return text;
  }
  return '';
};

/**
 * T13: true only on a session's opening user turn — exactly one user message
 * and no assistant/toolResult messages yet.
 */
export const isFirstUserTurn = (context: Context): boolean => {
  let userMessages = 0;
  for (const message of context.messages) {
    const role = (message as { role?: string }).role;
    if (role === 'user') {
      userMessages++;
      continue;
    }
    if (role === 'assistant' || role === 'toolResult') return false;
  }
  return userMessages === 1;
};
