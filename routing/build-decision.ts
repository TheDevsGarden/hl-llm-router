import type {
  RouterPhase,
  RouterProfile,
  RouterTier,
  RoutingDecision,
  RouterThinkingByTier,
} from '../types';
import { parseCanonicalModelRef } from '../shared/model-ref';
import { ROUTER_TIERS } from '../config';
import { invariant } from '../invariants';

export const buildRoutingDecision = (
  profileName: string,
  profile: RouterProfile,
  tier: RouterTier,
  phase: RouterPhase,
  reasoning: string,
  thinkingOverrides?: RouterThinkingByTier,
  isClassifier?: boolean,
): RoutingDecision => {
  // A decision for a tier outside ROUTER_TIERS would be silently misrouted: the
  // status widget shows it, but no profile field exists to resolve a model.
  // This catches a misconfigured rule or a future enum drift before it ships.
  invariant(
    (ROUTER_TIERS as readonly string[]).includes(tier),
    `buildRoutingDecision received unknown tier "${tier}"`,
  );
  const routed = profile[tier];
  if (!routed) {
    throw new Error(`Profile "${profileName}" has no configuration for the ${tier} tier.`);
  }
  const { provider, modelId } = parseCanonicalModelRef(routed.model);
  const baseThinking =
    routed.thinking ??
    (tier === 'high' ? 'high' : tier === 'low' ? 'low' : 'medium');
  const effectiveThinking = thinkingOverrides?.[tier] ?? baseThinking;

  return {
    profile: profileName,
    tier,
    phase,
    targetProvider: provider,
    targetModelId: modelId,
    targetLabel: routed.model,
    reasoning,
    thinking: effectiveThinking,
    timestamp: Date.now(),
    isClassifier,
  };
};
