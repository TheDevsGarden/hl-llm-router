import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { RouterConfig, RouterProfile, RouterTier } from '../types';
import { parseCanonicalModelRef } from '../shared/model-ref';
import { ROUTER_TIERS, THINKING_LEVELS } from './constants';
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from '../constants';

export const profileNames = (config: RouterConfig): string[] => {
  return Object.keys(config.profiles).sort();
};

export const resolveProfileName = (
  config: RouterConfig,
  requested?: string,
): string | undefined => {
  if (requested && config.profiles[requested]) {
    return requested;
  }
  return undefined;
};

/**
 * Resolve the effective context window for a specific tier at runtime,
 * incorporating the API model registry as the highest-priority source.
 *
 * Resolution chain: API > tier config > model alias > hardcoded default
 */
export const resolveContextWindow = (
  tier: RouterTier,
  profile: RouterProfile,
  modelRegistry: ExtensionContext['modelRegistry'] | undefined,
): number => {
  const tierConfig = profile[tier];
  if (!tierConfig) return DEFAULT_CONTEXT_WINDOW;

  // 1. API value (highest priority)
  if (modelRegistry) {
    try {
      const { provider, modelId } = parseCanonicalModelRef(tierConfig.model);
      const registryModel = modelRegistry.find(provider, modelId);
      if (registryModel?.contextWindow) return registryModel.contextWindow;
    } catch { /* ignore */ }
  }

  // 2-4. Pre-resolved during config normalization (tier > alias > hardcoded)
  return tierConfig.resolvedContextWindow ?? DEFAULT_CONTEXT_WINDOW;
};

/**
 * Resolve the effective max tokens for a specific tier at runtime,
 * incorporating the API model registry as the highest-priority source.
 *
 * Resolution chain: API > tier config > model alias > hardcoded default
 */
export const resolveMaxTokens = (
  tier: RouterTier,
  profile: RouterProfile,
  modelRegistry: ExtensionContext['modelRegistry'] | undefined,
): number => {
  const tierConfig = profile[tier];
  if (!tierConfig) return DEFAULT_MAX_TOKENS;

  // 1. API value (highest priority)
  if (modelRegistry) {
    try {
      const { provider, modelId } = parseCanonicalModelRef(tierConfig.model);
      const registryModel = modelRegistry.find(provider, modelId);
      if (registryModel?.maxTokens) return registryModel.maxTokens;
    } catch { /* ignore */ }
  }

  // 2-4. Pre-resolved during config normalization (tier > alias > hardcoded)
  return tierConfig.resolvedMaxTokens ?? DEFAULT_MAX_TOKENS;
};

/**
 * Collect the union of all tier models' resolved thinking levels for a profile.
 * Returns a Set of ThinkingLevel values.
 */
export const collectProfileThinkingLevels = (
  profile: RouterProfile,
): Set<ThinkingLevel> => {
  const levels = new Set<ThinkingLevel>();
  for (const tier of ROUTER_TIERS) {
    const tierConfig = profile[tier];
    if (!tierConfig?.resolvedThinkingLevels) continue;
    for (const level of tierConfig.resolvedThinkingLevels) {
      levels.add(level);
    }
  }
  return levels;
};

/**
 * Returns tier names whose models don't include the given thinking level
 * in their resolvedThinkingLevels.
 */
export const getUnsupportedTiers = (
  profile: RouterProfile,
  level: ThinkingLevel,
): string[] => {
  const unsupported: string[] = [];
  for (const tier of ROUTER_TIERS) {
    const tierConfig = profile[tier];
    if (!tierConfig) continue;
    if (!tierConfig.resolvedThinkingLevels?.includes(level)) {
      unsupported.push(tier);
    }
  }
  return unsupported;
};

/**
 * Clamps a requested thinking level to the highest supported level
 * in the provided array of supported levels.
 */
export const clampThinkingLevel = (
  requested: ThinkingLevel,
  supported: ThinkingLevel[] | undefined,
): ThinkingLevel => {
  if (requested === 'off' || !supported || supported.length === 0) {
    return 'off';
  }

  const reqIdx = THINKING_LEVELS.indexOf(requested);
  for (let i = reqIdx; i >= 0; i--) {
    if (supported.includes(THINKING_LEVELS[i])) {
      return THINKING_LEVELS[i];
    }
  }

  return 'off';
};
