import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { RouterConfig } from '../types';
import {
  profileNames,
  ROUTER_TIERS,
  resolveContextWindow,
  resolveMaxTokens,
  collectProfileThinkingLevels,
} from '../config';
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from '../constants';
import { invariant } from '../invariants';
import { supportsReasoning } from './reasoning';

/**
 * Build the pi-facing model list for a profile: one synthetic "router"
 * model per profile, advertising the MAX context window and max output
 * across its tiers (the honesty check + truncateContext handles the
 * actually-routed model being smaller).
 */
export const buildProfileModels = (
  config: RouterConfig,
  registry: ExtensionContext['modelRegistry'] | undefined,
) => {
  const profileList = profileNames(config);

  return profileList.map((name) => {
    const profile = config.profiles[name];

    // A profile with no defined tiers would silently advertise the DEFAULT_*
    // constants below — the widget would show a context window that no real
    // tier backs, and every turn would truncate to a phantom limit. normalizeConfig
    // skips such profiles, so reaching here with zero tiers means something
    // bypassed normalization.
    const definedTiers = ROUTER_TIERS.filter((t) => profile[t]);
    invariant(
      definedTiers.length > 0,
      `buildProfileModels: profile "${name}" has no defined tiers`,
    );

    let maxContextWindow = DEFAULT_CONTEXT_WINDOW;
    let maxMaxTokens = DEFAULT_MAX_TOKENS;
    for (const tier of ROUTER_TIERS) {
      if (!profile[tier]) continue;
      const cw = resolveContextWindow(tier, profile, registry);
      const mot = resolveMaxTokens(tier, profile, registry);
      if (cw > maxContextWindow) maxContextWindow = cw;
      if (mot > maxMaxTokens) maxMaxTokens = mot;
    }

    const hasReasoning = supportsReasoning(profile, registry);
    const profileLevels = collectProfileThinkingLevels(profile);
    // Build thinkingLevelMap from the union of all tier models' declared levels.
    // Only needed if xhigh or max are in the set (pi supports all others by default).
    let thinkingLevelMap: Record<string, string> | undefined;
    if (hasReasoning) {
      const map: Record<string, string> = {};
      if (profileLevels.has('xhigh')) map.xhigh = 'xhigh';
      if (profileLevels.has('max')) map.max = 'max';
      if (Object.keys(map).length > 0) thinkingLevelMap = map;
    }

    return {
      id: name,
      name: `Router ${name}`,
      reasoning: hasReasoning,
      ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
      input: ['text', 'image'] as ('text' | 'image')[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: maxContextWindow,
      maxTokens: maxMaxTokens,
    };
  });
};

/** Stable key describing the registered model surface; changed => re-register. */
export const profileModelsKey = (
  models: ReturnType<typeof buildProfileModels>,
): string =>
  models
    .map((m) => `${m.id}:${m.contextWindow}:${m.maxTokens}:${m.reasoning}`)
    .join(',');
