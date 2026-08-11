import type { ComplexityThresholds, RouterTier } from '../types';
import type { ClassifierGateTrigger } from '../gating';

/**
 * T14: the classifier's verdict space. 'ultra' is NOT a tier — it is a
 * signal to take the classifierUltra forced route. ROUTER_TIERS and
 * RouterTier stay high|medium|low.
 */
export type ClassifierVerdict = RouterTier | 'ultra';

export interface ClassifierResult {
  tier: ClassifierVerdict;
  reasoning: string;
  /** T14: raw 1-10 complexity. Absent when a legacy `Tier:` answer parsed. */
  score?: number;
}

export interface ClassifierRunOptions {
  allowUltra: boolean;
  thresholds: ComplexityThresholds | undefined;
  /** T13d: why the classifier was re-consulted. */
  trigger: ClassifierGateTrigger;
  consecutiveFailures: number;
  /** T16: what a soft rule already routed this turn to, if any. */
  ruleContext: string | undefined;
}

export const MIN_COMPLEXITY_SCORE = 1;
export const MAX_COMPLEXITY_SCORE = 10;

/** T14: words that ask for more care but not for the top tier. */
export const EXPLICIT_MID_HINTS: readonly string[] = [
  'best',
  'deep',
  'deeply',
  'carefully',
  'thoroughly',
  'robust',
  'comprehensive',
  'step by step',
];
