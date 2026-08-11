/**
 * T17: cheap compaction via the router's configured compaction model list.
 *
 * Walks `compactionModels` in order, filtering by disabled providers and
 * cooldowns (same semantics as the classifier list), sends the serialized
 * conversation to the first usable model, and returns its summary. A failed
 * cheap compaction degrades silently to pi's default — it must never cost
 * the session.
 */

import { uuidv7, type Usage } from '@earendil-works/pi-ai';
import { complete } from '@earendil-works/pi-ai/compat';
import { convertToLlm, serializeConversation } from '@earendil-works/pi-coding-agent';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { safeParseModelRef } from './shared/model-ref';
import { isProviderDisabled } from './providers';
import { invariant } from './invariants';
import { loadCooldowns } from './cooldown-store';
import { partitionByCooldown } from './cooldown';
import type { RouterConfig, CompactionRecord, ClassifierConfig } from './types';

export interface CompactionParams {
  /** pi's preparation pieces. messagesToSummarize + turnPrefixMessages are both
   *  AgentMessage[] from @earendil-works/pi-coding-agent. */
  preparation: {
    messagesToSummarize: unknown[];
    turnPrefixMessages: unknown[];
    tokensBefore: number;
    firstKeptEntryId: string;
    previousSummary?: string;
  };
  registry: ExtensionContext['modelRegistry'];
  config: RouterConfig;
  disabledProviders: ReadonlySet<string>;
  cooldownDir: string;
  customInstructions?: string;
  signal?: AbortSignal;
}

export interface CompactionOutcome {
  /** undefined when every candidate failed — caller lets pi's default compaction run. */
  summary?: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  /** Passed through to pi's session totals when the provider returns usage. */
  usage?: Usage;
  /** Always present. When summary is undefined, fellBackToDefault is true. */
  record: CompactionRecord;
}

/**
 * Build the summarization prompt for cheap compaction. This is the quality
 * risk of the feature — the prompt must preserve every fact needed to
 * continue work without the original conversation history.
 *
 * Exported for tests.
 */
export const buildCompactionPrompt = (
  conversationText: string,
  customInstructions?: string,
): string => {
  const parts: string[] = [];

  if (customInstructions) {
    parts.push(customInstructions);
    parts.push('');
  }

  parts.push(
    'You are summarizing a coding session for context compaction.',
    'This summary replaces the ENTIRE conversation history, so include every fact needed to continue the work.',
    '',
    'Preserve ALL of the following in structured markdown:',
    '1. Decisions made AND their rationale (why, not just what)',
    '2. Open questions and unresolved design calls',
    '3. Concrete file paths, identifiers, commands, config keys, and model refs',
    '4. Anything the user flagged as a trap, gotcha, or "don\'t lose this"',
    '5. Current state of in-progress work and immediate next steps',
    '',
    'Do NOT continue the conversation. Do NOT answer questions from it.',
    'Output only the structured summary.',
  );

  if (conversationText) {
    parts.push('', '<conversation>', conversationText, '</conversation>');
  }

  return parts.join('\n');
};

/**
 * Resolve a compaction summary by walking the configured compaction model
 * list. Returns the first successful summary, or a fallback outcome when
 * every candidate fails (caller lets pi's default compaction run).
 */
export const resolveCompactionSummary = async (
  params: CompactionParams,
): Promise<CompactionOutcome> => {
  const { preparation, registry, config, disabledProviders, cooldownDir, customInstructions, signal } = params;
  const { tokensBefore, firstKeptEntryId, previousSummary } = preparation;

  const emptyRecord = (fellBackToDefault: boolean): CompactionRecord => ({
    model: '',
    tokensBefore,
    summaryChars: 0,
    timestamp: Date.now(),
    fellBackToDefault,
  });

  try {
    // 1. Combine all messages and serialize.
    const allMessages = [
      ...preparation.messagesToSummarize,
      ...preparation.turnPrefixMessages,
    ];
    const conversationText = serializeConversation(
      convertToLlm(allMessages as unknown as Parameters<typeof convertToLlm>[0]),
    );

    // 2. Filter candidates: disabled providers, then cooldowns.
    const configured: ClassifierConfig[] = config.compactionModels ?? [];
    const enabled = configured.filter(
      (c) => !isProviderDisabled(c.model, disabledProviders),
    );
    if (enabled.length === 0) {
      return { firstKeptEntryId, tokensBefore, record: emptyRecord(true) };
    }

    const candidates: ClassifierConfig[] =
      config.cooldowns?.enabled !== true
        ? enabled
        : (() => {
            const now = Date.now();
            const { available } = partitionByCooldown(
              enabled.map((c) => c.model),
              loadCooldowns(cooldownDir, now),
              now,
              safeParseModelRef,
            );
            const usable = enabled.filter((c) => available.includes(c.model));
            return usable.length > 0 ? usable : enabled;
          })();

    // 3. Walk candidates in order; return on first success.
    for (const candidate of candidates) {
      try {
        const parsed = safeParseModelRef(candidate.model);
        if (!parsed) continue;

        const model = registry.find(parsed.provider, parsed.modelId);
        if (!model) continue;

        const auth = await registry.getApiKeyAndHeaders(model);
        if (!auth.ok || !auth.apiKey) continue;

        // Build the previous-summary context block.
        const previousContext = previousSummary
          ? `\n\nPrevious session summary for context:\n${previousSummary}`
          : '';

        const summaryMessages = [
          {
            role: 'user' as const,
            content: [
              {
                type: 'text' as const,
                text: `${buildCompactionPrompt(conversationText, customInstructions)}${previousContext}`,
              },
            ],
            timestamp: Date.now(),
          },
        ];

        const response = await complete(
          model,
          { messages: summaryMessages },
          {
            apiKey: auth.apiKey,
            headers: auth.headers,
            env: auth.env,
            maxTokens: 8192,
            signal,
            cacheRetention: 'none',
            sessionId: uuidv7(),
          },
        );

        const summary = response.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map((c) => c.text)
          .join('\n');

        if (!summary.trim()) continue;

        // An empty summary returned as success would silently lose the entire
        // session history — the one failure this feature exists to prevent.
        invariant(
          summary.trim().length > 0,
          'compaction success path produced an empty summary',
        );

        const usage = response.usage;
        return {
          summary,
          firstKeptEntryId,
          tokensBefore,
          usage,
          record: {
            model: candidate.model,
            tokensBefore,
            summaryChars: summary.length,
            timestamp: Date.now(),
            fellBackToDefault: false,
          },
        };
      } catch (_candidateError) {
        // Abort means stop immediately — don't keep trying.
        if (signal?.aborted) {
          return { firstKeptEntryId, tokensBefore, record: emptyRecord(true) };
        }
        // Otherwise continue to next candidate.
      }
    }

    // All candidates exhausted — fall back to pi's default compaction.
    return { firstKeptEntryId, tokensBefore, record: emptyRecord(true) };
  } catch (_topLevelError) {
    // A thrown compaction would lose the session. Always degrade silently.
    return { firstKeptEntryId, tokensBefore, record: emptyRecord(true) };
  }
};
