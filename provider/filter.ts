import type {
  RouterProfile,
  RoutingDecision,
  RouterThinkingByProfile,
} from '../types';
import { parseCanonicalModelRef } from '../shared/model-ref';
import { buildRoutingDecision, phaseForTier } from '../routing';
import {
  filterDisabledRefs,
  degradeAcrossTiers,
  providerOf,
  isProviderDisabled,
} from '../providers';
import { invariant } from '../invariants';

/**
 * T15: drop disabled-provider candidates from the chain. A thinned chain
 * stays on its tier; a fully-disabled chain degrades to the nearest
 * surviving tier (visible in reasoning); no surviving tier fails LOUD.
 */
export const applyDisabledProviderFilter = (
  decision: RoutingDecision,
  modelsToTry: string[],
  profile: RouterProfile,
  profileId: string,
  disabledProviders: ReadonlySet<string>,
  thinkingOverrides: RouterThinkingByProfile[string] | undefined,
): { decision: RoutingDecision; modelsToTry: string[] } => {
  if (disabledProviders.size === 0) return { decision, modelsToTry };
  const { kept, dropped } = filterDisabledRefs(modelsToTry, disabledProviders);
  if (dropped.length === 0) return { decision, modelsToTry };

  const droppedNames = [
    ...new Set(dropped.map((ref) => providerOf(ref)).filter(Boolean)),
  ].join(', ');

  let nextDecision = decision;
  let nextModels = kept;
  if (kept.length > 0) {
    nextDecision = {
      ...decision,
      isProviderFiltered: true,
      reasoning: `[provider-filtered] Skipped ${dropped.length} candidate(s) on disabled provider(s): ${droppedNames}. (${decision.reasoning})`,
    };
  } else {
    const degraded = degradeAcrossTiers(
      profile,
      decision.tier,
      disabledProviders,
    );
    if (!degraded) {
      throw new Error(
        `Disabled providers (${[...disabledProviders].join(', ')}) leave no available model in any tier of profile "${profileId}". ` +
          `Re-enable one with /router provider enable <name>, or edit disabledProviders in model-router.json.`,
      );
    }
    nextDecision = buildRoutingDecision(
      profileId,
      profile,
      degraded.tier,
      phaseForTier(degraded.tier),
      `[provider-filtered] Every ${decision.tier}-tier candidate is on disabled provider(s) ${droppedNames}; degraded to ${degraded.tier}. (${decision.reasoning})`,
      thinkingOverrides,
      decision.isClassifier,
    );
    nextDecision.isProviderFiltered = true;
    nextModels = degraded.kept;
  }

  // Keep the decision's target truthful when the primary was dropped.
  if (nextModels[0] !== nextDecision.targetLabel) {
    const retarget = parseCanonicalModelRef(nextModels[0]);
    nextDecision = {
      ...nextDecision,
      targetProvider: retarget.provider,
      targetModelId: retarget.modelId,
      targetLabel: nextModels[0],
      // The surviving candidate is a plain tier model, not the hand-picked
      // forced one — restore tier semantics so delegateToChain clamps the
      // thinking level to the tier's declared levels.
      isModelForced: undefined,
    };
  }
  // The load-bearing guarantee of T15: if either of these ever fails, a
  // provider the user switched off is still reachable — which for a
  // self-hosted box means delegating into something that hangs.
  invariant(
    nextModels.length > 0,
    `provider filter produced an empty chain for profile "${profileId}"`,
  );
  invariant(
    !nextModels.some((ref) => isProviderDisabled(ref, disabledProviders)),
    `provider filter kept a disabled ref: ${nextModels.join(', ')}`,
  );
  return { decision: nextDecision, modelsToTry: nextModels };
};
