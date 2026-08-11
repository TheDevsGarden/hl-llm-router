import type { CooldownState, RoutingDecision } from '../types';
import { partitionByCooldown } from '../cooldown';
import { safeParseModelRef } from '../shared/model-ref';
import { invariant } from '../invariants';

/**
 * Order the candidate chain against cooldown memory: usable candidates first,
 * cooling ones appended soonest-expiring last so a stale cooldown can never be
 * the reason a turn fails outright. Also records the skipped set on the
 * decision (the only input this module mutates) so the widget/debug log can
 * explain why the routed model did not answer.
 */
export const applyCooldownOrder = (
  modelsToTry: string[],
  decision: RoutingDecision,
  cooldownState: CooldownState,
  now: number,
): { ordered: string[]; decision: RoutingDecision } => {
  const { available, cooling } = partitionByCooldown(
    modelsToTry,
    cooldownState,
    now,
    safeParseModelRef,
  );
  if (cooling.length === 0) return { ordered: modelsToTry, decision };

  const ordered = [...available, ...cooling];
  invariant(
    ordered.length === modelsToTry.length,
    `cooldown reorder changed the candidate count: ${modelsToTry.length} -> ${ordered.length}`,
  );
  decision.skippedCooling = cooling;

  const actual = ordered[0];
  const parsedActual = actual ? safeParseModelRef(actual) : undefined;
  if (actual && parsedActual && actual !== decision.targetLabel) {
    return {
      ordered,
      decision: {
        ...decision,
        targetProvider: parsedActual.provider,
        targetModelId: parsedActual.modelId,
        targetLabel: actual,
        reasoning:
          `${decision.reasoning} Skipped ${cooling.length} cooling ` +
          `candidate(s): ${cooling.join(', ')}.`,
      },
    };
  }

  return { ordered, decision };
};