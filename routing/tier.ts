import type { ComplexityThresholds, RouterPhase, RouterProfile, RouterTier } from '../types';
import { invariant } from '../invariants';
import type { ClassifierVerdict } from './types';

export const phaseForTier = (tier: RouterTier): RouterPhase => {
  if (tier === 'high') return 'planning';
  if (tier === 'medium') return 'implementation';
  return 'lightweight';
};

export const resolveAvailableTier = (
  profile: RouterProfile,
  preferred: RouterTier,
): RouterTier => {
  if (profile[preferred]) return preferred;
  // Fall "up": low → medium → high
  const order: RouterTier[] = ['low', 'medium', 'high'];
  const startIdx = order.indexOf(preferred);
  for (let i = startIdx + 1; i < order.length; i++) {
    if (profile[order[i]]) return order[i];
  }
  // Fall "down" as last resort
  for (let i = startIdx - 1; i >= 0; i--) {
    if (profile[order[i]]) return order[i];
  }
  return preferred; // unreachable if profile has ≥1 tier
};

/** T14: 1-10 -> verdict. allowUltra=false collapses ultra onto high. */
export const verdictForScore = (
  score: number,
  thresholds: ComplexityThresholds,
  allowUltra: boolean,
): ClassifierVerdict => {
  const verdict: ClassifierVerdict =
    score >= thresholds.ultra
      ? allowUltra
        ? 'ultra'
        : 'high'
      : score >= thresholds.high
        ? 'high'
        : score >= thresholds.medium
          ? 'medium'
          : 'low';
  // The only thing standing between an absent/disabled classifierUltra and an
  // escalation to the most expensive model in the config.
  invariant(
    !(verdict === 'ultra' && !allowUltra),
    'ultra verdict produced with allowUltra=false',
  );
  return verdict;
};
