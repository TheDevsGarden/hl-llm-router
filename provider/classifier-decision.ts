import type { Context } from '@earendil-works/pi-ai';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type {
  RouterConfig,
  RouterProfile,
  RouterTier,
  RoutingDecision,
  RouterThinkingByProfile,
  ForcedRouteConfig,
} from '../types';
import {
  shouldRunClassifier,
  consecutiveToolFailures,
} from '../gating';
import {
  buildRoutingDecision,
  phaseForTier,
  isFirstUserTurn,
  resolveAvailableTier,
  runClassifier,
} from '../routing';
import { parseCanonicalModelRef, safeParseModelRef } from '../shared/model-ref';
import { isProviderDisabled } from '../providers';
import {
  partitionByCooldown,
} from '../cooldown';
import { loadCooldowns } from '../cooldown-store';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { invariant } from '../invariants';

export interface ClassifierDecisionParams {
  context: Context;
  registry: ExtensionContext['modelRegistry'];
  config: RouterConfig;
  profile: RouterProfile;
  profileId: string;
  /** The heuristic/rule decision the classifier may override. */
  decision: RoutingDecision;
  pinnedTier: RouterTier | undefined;
  isBudgetExceeded: boolean;
  lastDecision: RoutingDecision | undefined;
  lastUltraAt: number | undefined;
  disabledProviders: ReadonlySet<string>;
  thinkingOverrides: RouterThinkingByProfile[string] | undefined;
  /** Local fork: classifier candidates are cooldown-filtered too. */
  cooldownDir: string;
}

/**
 * T11/T13/T14/T16: the classifier override in one place. Runs the gated
 * classifier fallback list and maps its verdict onto the decision:
 * ultra escalation (cooldown-limited), classifier-gated first-turn boost,
 * plain tier override, or decision reuse between gates. Hard rules
 * (final: true), pins, and exceeded budgets return the input unchanged;
 * soft rules are re-consulted only on tool-failure evidence.
 */
export const resolveClassifierDecision = async (
  params: ClassifierDecisionParams,
): Promise<{ decision: RoutingDecision; ultraFiredAt?: number }> => {
  const {
    context,
    registry,
    config,
    profile,
    profileId,
    pinnedTier,
    isBudgetExceeded,
    lastDecision,
    lastUltraAt,
    disabledProviders,
    thinkingOverrides,
    cooldownDir,
  } = params;
  let decision = params.decision;

  // T13: force a decision onto a model outside the tier ladder
  // (first-turn boost, classifier ultra escalation). Thinking
  // precedence: user override > forced config > tier default.
  const forceDecisionModel = (
    forced: ForcedRouteConfig,
    reasoning: string,
    isClassifier: boolean,
  ): RoutingDecision | undefined => {
    try {
      const { provider: forcedProvider, modelId: forcedModelId } =
        parseCanonicalModelRef(forced.model);
      const forcedTier = resolveAvailableTier(profile, 'high');
      const forcedDecision = buildRoutingDecision(
        profileId,
        profile,
        forcedTier,
        phaseForTier(forcedTier),
        reasoning,
        thinkingOverrides,
        isClassifier,
      );
      forcedDecision.targetProvider = forcedProvider;
      forcedDecision.targetModelId = forcedModelId;
      forcedDecision.targetLabel = forced.model;
      forcedDecision.isModelForced = true;
      if (forced.thinking && !thinkingOverrides?.[forcedTier]) {
        forcedDecision.thinking = forced.thinking;
      }
      // Precedence is user override > forced config > tier default. A /router
      // thinking override must never be silently overwritten by config.
      invariant(
        thinkingOverrides?.[forcedTier] === undefined ||
          forcedDecision.thinking === thinkingOverrides[forcedTier],
        `forced route overrode the user's thinking level for the ${forcedTier} tier`,
      );
      return forcedDecision;
    } catch {
      // Invalid refs are already warned at config parse time.
      return undefined;
    }
  };

  // T13: first-turn boost — substitutes the high tier's model on the
  // session's opening user turn, but ONLY when the classifier itself
  // rules the turn 'high'. A first prompt like "where is file X" is
  // classified low/medium and never reaches the boost model.
  const rawFirstTurn = config.firstTurn;
  const firstTurnConfig =
    rawFirstTurn && !isProviderDisabled(rawFirstTurn.model, disabledProviders)
      ? rawFirstTurn
      : undefined;
  const isSessionOpeningTurn = !lastDecision && isFirstUserTurn(context);

  // T11: gated by tool-continuation triggers, with an ordered fallback list.
  // Skipped when the budget is already exceeded — the result would be
  // downgraded anyway, saving an unnecessary LLM call.
  const configuredClassifiers =
    config.classifierModels ??
    (config.classifierModel ? [config.classifierModel] : []);
  const classifierList = configuredClassifiers.filter(
    // T15: a disabled classifier provider falls through to the next
    // entry (or to heuristics) exactly like a classifier failure.
    (classifier) => !isProviderDisabled(classifier.model, disabledProviders),
  );
  if (classifierList.length === 0 || pinnedTier || isBudgetExceeded) {
    return { decision };
  }

  const gate = shouldRunClassifier(context, {
    runOnceAfterToolCount: config.classifierRunOnceAfterToolCount ?? 3,
    runAfterToolFailures: config.classifierRunAfterToolFailures ?? 2,
    interval: config.classifierInterval ?? 10,
  });
  // T16: hard rules (final: true) always bypass the classifier.
  // Soft rules set the initial route; the classifier is re-consulted
  // only on tool-failure evidence and may re-route (e.g. escalate a
  // struggling #k3 turn to ultra).
  const ruleGated =
    decision.isRuleMatched === true &&
    (decision.isRuleFinal === true || gate.trigger !== 'tool-failures');

  if (!gate.run || ruleGated) {
    if (
      !gate.run &&
      !decision.isRuleMatched &&
      lastDecision?.profile === profileId
    ) {
      decision = {
        ...lastDecision,
        timestamp: Date.now(),
        reasoning:
          'Reused previous decision (classifier gated: tool continuation).',
        isReused: true,
      };
    }
    return { decision };
  }

  // T15: a disabled ultra provider turns the feature off for this
  // turn (allowUltra=false), so the classifier never scores ultra.
  const rawUltra = config.classifierUltra;
  const ultraConfig =
    rawUltra && !isProviderDisabled(rawUltra.model, disabledProviders)
      ? rawUltra
      : undefined;
  // T14: "occasionally" is enforced, not hoped for — ultra is
  // unavailable for ultraCooldownMinutes after each escalation.
  const cooldownMs = (config.ultraCooldownMinutes ?? 0) * 60_000;
  const ultraOnCooldown =
    cooldownMs > 0 &&
    lastUltraAt !== undefined &&
    Date.now() - lastUltraAt < cooldownMs;

  // Local fork: skip classifier candidates that are cooling down, but
  // fall back to the full list when every one of them is cooling.
  const classifierCandidates =
    config.cooldowns?.enabled !== true
      ? classifierList
      : (() => {
          const classifierNow = Date.now();
          const { available } = partitionByCooldown(
            classifierList.map((entry) => entry.model),
            loadCooldowns(cooldownDir || getAgentDir(), classifierNow),
            classifierNow,
            safeParseModelRef,
          );
          const usable = classifierList.filter((entry) =>
            available.includes(entry.model),
          );
          return usable.length > 0 ? usable : classifierList;
        })();

  for (const classifier of classifierCandidates) {
    const classifierResult = await runClassifier(
      classifier.model,
      registry,
      context,
      lastDecision?.phase,
      classifier.thinking,
      {
        allowUltra: Boolean(ultraConfig),
        thresholds: config.classifierComplexityThresholds,
        trigger: gate.trigger,
        consecutiveFailures: consecutiveToolFailures(context),
        // T16: tell the classifier what the soft rule routed so a
        // re-route is an informed override, not a blind re-read.
        // Keep this a short noun phrase — buildClassifierPrompt wraps it
        // in its own sentence.
        ruleContext: decision.isRuleMatched
          ? `${decision.tier} tier via ${decision.targetLabel}`
          : undefined,
      },
    );
    if (!classifierResult) continue;

    const scoreTag =
      classifierResult.score !== undefined
        ? ` [${classifierResult.score}/10]`
        : '';
    const plainOverride = () =>
      buildRoutingDecision(
        profileId,
        profile,
        classifierResult.tier as RouterTier,
        phaseForTier(classifierResult.tier as RouterTier),
        `Classifier (${gate.trigger})${scoreTag}: ${classifierResult.reasoning}`,
        thinkingOverrides,
        true,
      );

    if (classifierResult.tier === 'ultra' && ultraOnCooldown) {
      // Rate-limited: take the high tier instead.
      const cooldownTier = resolveAvailableTier(profile, 'high');
      decision = buildRoutingDecision(
        profileId,
        profile,
        cooldownTier,
        phaseForTier(cooldownTier),
        `Classifier (${gate.trigger})${scoreTag} scored ultra but ultra is on cooldown -> high tier: ${classifierResult.reasoning}`,
        thinkingOverrides,
        true,
      );
      return { decision };
    }
    if (classifierResult.tier === 'ultra') {
      // T13: opt-in 4th tier — the hardest planning turns go to
      // a dedicated heavyweight model above the high tier.
      if (!ultraConfig) continue;
      const forcedDecision = forceDecisionModel(
        ultraConfig,
        `Classifier (${gate.trigger})${scoreTag} escalated to ultra -> ${ultraConfig.model}: ${classifierResult.reasoning}`,
        true,
      );
      if (!forcedDecision) continue;
      // "Occasionally" is enforced, not hoped for.
      invariant(
        !ultraOnCooldown,
        'ultra escalation fired while the cooldown window was still open',
      );
      forcedDecision.isUltra = true;
      return { decision: forcedDecision, ultraFiredAt: Date.now() };
    }
    if (
      classifierResult.tier === 'high' &&
      isSessionOpeningTurn &&
      firstTurnConfig
    ) {
      // Classifier-gated first-turn boost.
      const forcedDecision = forceDecisionModel(
        firstTurnConfig,
        `Classifier (${gate.trigger})${scoreTag} ruled the opening turn high -> first-turn boost ${firstTurnConfig.model}: ${classifierResult.reasoning}`,
        true,
      );
      decision = forcedDecision
        ? Object.assign(forcedDecision, { isFirstTurn: true })
        : plainOverride();
      return { decision };
    }
    return { decision: plainOverride() };
  }

  return { decision };
};
