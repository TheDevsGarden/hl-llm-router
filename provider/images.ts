import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type {
  RouterProfile,
  RouterTier,
  RoutingDecision,
  RouterThinkingByProfile,
} from '../types';
import { parseCanonicalModelRef } from '../shared/model-ref';
import { buildRoutingDecision, phaseForTier } from '../routing';

export const modelSupportsImage = (
  registry: ExtensionContext['modelRegistry'],
  modelRef: string,
): boolean => {
  try {
    const { provider, modelId } = parseCanonicalModelRef(modelRef);
    const m = registry.find(provider, modelId);
    return m?.input?.includes('image') ?? false;
  } catch {
    return false;
  }
};

/**
 * When the prompt carries an image but nothing in the routed tier's chain
 * accepts one, force the lowest higher tier that does. Returns the decision
 * unchanged when the tier already supports images (or nothing does).
 */
export const escalateTierForImages = (
  decision: RoutingDecision,
  profile: RouterProfile,
  profileId: string,
  registry: ExtensionContext['modelRegistry'],
  thinkingOverrides: RouterThinkingByProfile[string] | undefined,
): RoutingDecision => {
  const tierModels = [
    decision.targetLabel,
    ...(profile[decision.tier]?.fallbacks ?? []),
  ];
  if (tierModels.some((ref) => modelSupportsImage(registry, ref))) {
    return decision;
  }

  const tiersToTry: RouterTier[] =
    decision.tier === 'low'
      ? ['medium', 'high']
      : decision.tier === 'medium'
        ? ['high']
        : [];

  for (const tier of tiersToTry) {
    const tierConfig = profile[tier];
    if (!tierConfig) continue;
    const refs = [tierConfig.model, ...(tierConfig.fallbacks ?? [])];
    if (!refs.some((ref) => modelSupportsImage(registry, ref))) continue;
    return buildRoutingDecision(
      profileId,
      profile,
      tier,
      phaseForTier(tier),
      `Forced ${tier} tier because the originally routed ${decision.tier} tier does not support image attachments.`,
      thinkingOverrides,
      false,
    );
  }
  return decision;
};
