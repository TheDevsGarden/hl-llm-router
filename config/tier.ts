import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { RouterTier, RoutedTierConfig, ModelDefinition } from '../types';
import { isObjectRecord, isThinkingLevel } from './guards';
import { resolveModelRef } from './parse-file';
import { parseCanonicalModelRef } from '../shared/model-ref';
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from '../constants';
import { DEFAULT_THINKING_LEVELS } from './constants';

export const normalizeTierConfig = (
  value: unknown,
  profileName: string,
  tier: RouterTier,
  warnings: string[],
  models?: Record<string, ModelDefinition>,
): RoutedTierConfig | undefined => {
  if (!isObjectRecord(value)) {
    return undefined;
  }

  const rawModel = typeof value.model === 'string' ? value.model.trim() : '';
  let aliasDefinition: ModelDefinition | undefined;

  if (!rawModel) {
    warnings.push(
      `Profile "${profileName}" ${tier} tier is missing a model. Tier disabled.`,
    );
    return undefined;
  }

  // Try to resolve as an alias first
  const resolved = resolveModelRef(rawModel, models);
  aliasDefinition = resolved.definition;
  let parsedModel: string;
  try {
    parseCanonicalModelRef(resolved.canonicalRef);
    parsedModel = resolved.canonicalRef;
  } catch (error) {
    warnings.push(
      `Profile "${profileName}" ${tier} tier: ${error instanceof Error ? error.message : String(error)} Tier disabled.`,
    );
    return undefined;
  }

  const thinking = isThinkingLevel(value.thinking)
    ? value.thinking
    : 'medium';
  if (value.thinking !== undefined && !isThinkingLevel(value.thinking)) {
    warnings.push(
      `Profile "${profileName}" ${tier} tier has invalid thinking level. Defaulting to medium.`,
    );
  }

  let fallbacks: string[] | undefined = undefined;
  if (Array.isArray(value.fallbacks)) {
    fallbacks = [];
    for (const f of value.fallbacks) {
      if (typeof f === 'string') {
        // Resolve aliases in fallbacks too
        const resolvedFallback = resolveModelRef(f, models);
        try {
          parseCanonicalModelRef(resolvedFallback.canonicalRef);
          fallbacks.push(resolvedFallback.canonicalRef);
        } catch (error) {
          warnings.push(
            `Invalid fallback model "${f}" in profile "${profileName}" ${tier} tier: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  // Resolve contextWindow: tier config > alias > hardcoded default
  const tierContextWindow =
    typeof value.contextWindow === 'number' && value.contextWindow > 0
      ? value.contextWindow
      : undefined;
  const resolvedContextWindow =
    tierContextWindow ?? aliasDefinition?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;

  // Resolve maxTokens: tier config > alias > hardcoded default
  const tierMaxTokens =
    typeof value.maxTokens === 'number' && value.maxTokens > 0
      ? value.maxTokens
      : undefined;
  const resolvedMaxTokens =
    tierMaxTokens ?? aliasDefinition?.maxTokens ?? DEFAULT_MAX_TOKENS;

  // Resolve reasoning: tier config > alias > undefined (assumed true)
  const tierReasoning =
    typeof value.reasoning === 'boolean' ? value.reasoning : undefined;
  const effectiveReasoning = tierReasoning ?? aliasDefinition?.reasoning;

  // Resolve thinkingLevels: tier config > alias > default
  // Validate tier-level thinkingLevels array
  let tierThinkingLevels: ThinkingLevel[] | undefined;
  if (Array.isArray(value.thinkingLevels)) {
    tierThinkingLevels = (value.thinkingLevels as unknown[]).filter(
      (l): l is ThinkingLevel => isThinkingLevel(l),
    );
    if (tierThinkingLevels.length === 0) tierThinkingLevels = undefined;
  }

  const explicitThinkingLevels = tierThinkingLevels ?? aliasDefinition?.thinkingLevels;
  const baseThinkingLevels: ThinkingLevel[] =
    explicitThinkingLevels ??
    (effectiveReasoning === false ? [] : [...DEFAULT_THINKING_LEVELS]);

  // Auto-add the tier's thinking value if it's not 'off' and not already present,
  // but only if the user didn't explicitly constrain the thinkingLevels array.
  const resolvedThinkingLevels: ThinkingLevel[] = [...baseThinkingLevels];
  if (!explicitThinkingLevels && thinking !== 'off' && !resolvedThinkingLevels.includes(thinking)) {
    resolvedThinkingLevels.push(thinking);
  }

  return {
    model: parsedModel,
    thinking,
    fallbacks,
    contextWindow: tierContextWindow,
    maxTokens: tierMaxTokens,
    reasoning: tierReasoning,
    thinkingLevels: tierThinkingLevels,
    resolvedContextWindow,
    resolvedMaxTokens,
    resolvedThinkingLevels,
  };
};
