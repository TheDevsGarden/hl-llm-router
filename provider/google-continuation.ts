import type { Message } from '@earendil-works/pi-ai';
import type { RoutingDecision } from '../types';

/**
 * A Google thinking model must not be swapped mid tool-chain — thought
 * signatures do not replay across models. Returns the previous decision's
 * target when this turn is such a continuation, otherwise the new decision.
 */
export const preserveGoogleThinkingContinuation = (
  decision: RoutingDecision,
  previousDecision: RoutingDecision | undefined,
  lastMessage: Message | undefined,
  profileId: string,
): RoutingDecision => {
  const isGoogleThinkingToolContinuation =
    lastMessage?.role === 'toolResult' &&
    previousDecision?.profile === profileId &&
    previousDecision.targetProvider === 'google' &&
    previousDecision.thinking !== 'off' &&
    decision.targetProvider === 'google' &&
    decision.thinking !== 'off' &&
    previousDecision.targetLabel !== decision.targetLabel;

  if (!isGoogleThinkingToolContinuation || !previousDecision) return decision;
  return {
    ...decision,
    tier: previousDecision.tier,
    phase: previousDecision.phase,
    targetProvider: previousDecision.targetProvider,
    targetModelId: previousDecision.targetModelId,
    targetLabel: previousDecision.targetLabel,
    thinking: previousDecision.thinking,
    reasoning:
      `Preserved ${previousDecision.targetLabel} for a Google tool-result continuation ` +
      `to avoid thought-signature replay errors. (Original: ${decision.reasoning})`,
  };
};
