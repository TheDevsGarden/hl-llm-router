import type { RouterPhase, RouterTier, RoutingDecision } from '../types';
import { containsAny } from './extract';
import { EXPLICIT_MID_HINTS } from './types';
import {
  EXPLICIT_HIGH_HINTS,
  EXPLICIT_LOW_HINTS,
  PLANNING_KEYWORDS,
  SUMMARY_KEYWORDS,
  IMPLEMENTATION_KEYWORDS,
  LOOKUP_KEYWORDS,
} from './keywords';

export interface HeuristicInput {
  prompt: string;
  previousDecision: RoutingDecision | undefined;
  phaseBias: number;
  wordCount: number;
  toolResultCount: number;
  multiLinePrompt: boolean;
  recentConversation: string;
}

export interface HeuristicResult {
  tier: RouterTier;
  phase: RouterPhase;
  reasoning: string;
}

/**
 * The keyword + complexity if/else that picks a tier when no rule matched and
 * no pin is set. Extracted verbatim from decideRouting so the orchestrator is
 * just rules -> heuristics -> budget -> resolve -> override.
 */
export const applyHeuristics = (input: HeuristicInput): HeuristicResult => {
  const { prompt, previousDecision, phaseBias, wordCount, toolResultCount, multiLinePrompt, recentConversation } = input;

  // Sticky phase adjustments
  const highThreshold = Math.max(
    40,
    120 - (previousDecision?.phase === 'planning' ? phaseBias * 80 : 0),
  );
  const lowThreshold = Math.max(
    4,
    12 -
      (previousDecision?.phase === 'implementation' ||
      previousDecision?.phase === 'planning'
        ? phaseBias * 8
        : 0),
  );

  if (containsAny(prompt, EXPLICIT_HIGH_HINTS)) {
    return {
      tier: 'high',
      phase: 'planning',
      reasoning:
        'Detected an explicit request for deeper or higher-quality reasoning.',
    };
  }
  if (containsAny(prompt, EXPLICIT_MID_HINTS)) {
    return {
      tier: 'medium',
      phase: 'implementation',
      reasoning:
        'Detected an explicit quality hint that maps to the medium tier.',
    };
  }
  if (containsAny(prompt, EXPLICIT_LOW_HINTS)) {
    return {
      tier: 'low',
      phase: 'lightweight',
      reasoning:
        'Detected an explicit request for a faster or lighter response.',
    };
  }
  if (containsAny(prompt, SUMMARY_KEYWORDS)) {
    return {
      tier: 'low',
      phase: 'lightweight',
      reasoning: 'Detected summary or lightweight transformation keywords.',
    };
  }
  if (
    containsAny(prompt, PLANNING_KEYWORDS) ||
    prompt.startsWith('why ') ||
    wordCount >= highThreshold ||
    multiLinePrompt
  ) {
    return {
      tier: 'high',
      phase: 'planning',
      reasoning:
        previousDecision?.phase === 'planning'
          ? 'Continued planning phase based on complexity or keywords.'
          : 'Detected planning, broad analysis, or a high-complexity request.',
    };
  }
  if (containsAny(prompt, IMPLEMENTATION_KEYWORDS)) {
    return {
      tier: 'medium',
      phase: 'implementation',
      reasoning:
        'Detected implementation-oriented work with bounded execution scope.',
    };
  }
  if (
    containsAny(prompt, LOOKUP_KEYWORDS) &&
    wordCount <= 24 &&
    toolResultCount === 0
  ) {
    return {
      tier: 'low',
      phase: 'lightweight',
      reasoning: 'Detected a short read-only lookup request.',
    };
  }
  if (
    previousDecision?.phase === 'planning' &&
    toolResultCount === 0 &&
    wordCount > lowThreshold
  ) {
    return {
      tier: 'high',
      phase: 'planning',
      reasoning:
        'Kept the planning-phase bias because the conversation still looks exploratory.',
    };
  }
  if (
    toolResultCount > 0 ||
    previousDecision?.phase === 'implementation' ||
    recentConversation.includes('plan:')
  ) {
    return {
      tier: 'medium',
      phase: 'implementation',
      reasoning:
        'Detected active implementation work from prior tools or recent plan execution context.',
    };
  }
  if (wordCount <= lowThreshold) {
    return {
      tier: 'low',
      phase: 'lightweight',
      reasoning: 'Detected a short bounded request.',
    };
  }
  return {
    tier: 'medium',
    phase: 'implementation',
    reasoning: 'Defaulted to medium tier for general coding work.',
  };
};
