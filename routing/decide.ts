import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Context } from '@earendil-works/pi-ai';
import type {
  RouterPhase,
  RouterProfile,
  RouterTier,
  RoutingDecision,
  RoutingRule,
  RouterThinkingByTier,
} from '../types';
import { parseCanonicalModelRef } from '../shared/model-ref';
import {
  containsAny,
  countToolResults,
  countWords,
  getHumanPromptText,
  getLastUserText,
  getRecentConversationText,
} from './extract';
import { matchRules } from './rules';
import { applyHeuristics } from './heuristics';
import { phaseForTier, resolveAvailableTier } from './tier';
import { buildRoutingDecision } from './build-decision';

/**
 * The router's tier selector: pin -> rules -> heuristics -> budget downgrade
 * -> nearest-available-tier resolution -> rule model/thinking overrides.
 */
export const decideRouting = (
  context: Context,
  profileName: string,
  profile: RouterProfile,
  previousDecision: RoutingDecision | undefined,
  pinnedTier?: RouterTier,
  thinkingOverrides?: RouterThinkingByTier,
  phaseBias = 0.5,
  rules?: RoutingRule[],
  isBudgetExceeded = false,
  humanPrompt?: string,
): RoutingDecision => {
  const prompt = getLastUserText(context).toLowerCase();
  // Rules — especially `#sigil` rules, which are mostly `final: true` — match
  // only what the user typed. `prompt` above is the last role:"user" message,
  // which pi also uses for compaction summaries, `!bash` output and messages
  // injected by other extensions; a sigil quoted back in any of those would
  // hard-pin a model the user never asked for. Heuristics and word counts keep
  // reading `prompt`: they are about how much context is in play, not about
  // what was requested.
  const ruleText = (
    humanPrompt ?? getHumanPromptText(context) ?? ''
  ).toLowerCase();
  const recentConversation = getRecentConversationText(context);
  const toolResultCount = countToolResults(context);
  const wordCount = countWords(prompt);
  const multiLinePrompt = prompt.split('\n').length >= 4;

  let phase: RouterPhase = previousDecision?.phase ?? 'implementation';
  let tier: RouterTier = 'medium';
  let reasoning = 'Defaulted to medium tier for general coding work.';
  let isRuleMatched = false;
  let ruleModelOverride: string | undefined;
  let ruleThinkingOverride: ThinkingLevel | undefined;
  let isRuleFinal = false;

  if (pinnedTier) {
    phase = phaseForTier(pinnedTier);
    tier = pinnedTier;
    reasoning = `Pinned to ${pinnedTier} tier via /router-pin.`;
  } else {
    const match = matchRules(ruleText, rules);
    if (match) {
      const { winningRule, highestTier } = match;
      tier = highestTier;
      phase = phaseForTier(tier);
      const matches = Array.isArray(winningRule.matches)
        ? winningRule.matches
        : [winningRule.matches];
      reasoning =
        winningRule.reason ??
        `Matched custom routing rule for: ${matches.join(', ')}`;
      isRuleMatched = true;
      ruleModelOverride = winningRule.model;
      ruleThinkingOverride = winningRule.thinking; // T13
      isRuleFinal = winningRule.final === true; // T16
    }

    if (!isRuleMatched) {
      const h = applyHeuristics({
        prompt,
        previousDecision,
        phaseBias,
        wordCount,
        toolResultCount,
        multiLinePrompt,
        recentConversation,
      });
      phase = h.phase;
      tier = h.tier;
      reasoning = h.reasoning;
    }
  }

  let isBudgetForced = false;
  if (isBudgetExceeded && tier === 'high') {
    tier = 'medium';
    phase = 'implementation';
    reasoning = `Budget exceeded. Downgraded from high to medium tier. (Original: ${reasoning})`;
    isBudgetForced = true;
  }

  // Resolve to nearest available tier if the selected tier is disabled
  const resolvedTier = resolveAvailableTier(profile, tier);
  if (resolvedTier !== tier) {
    reasoning = `Resolved from ${tier} to ${resolvedTier} tier (${tier} tier is not configured). Original: ${reasoning}`;
    phase = phaseForTier(resolvedTier);
    tier = resolvedTier;
  }

  const decision = buildRoutingDecision(
    profileName,
    profile,
    tier,
    phase,
    reasoning,
    thinkingOverrides,
    false,
  );
  decision.isRuleMatched = isRuleMatched;
  decision.isBudgetForced = isBudgetForced;
  if (ruleThinkingOverride) {
    decision.thinking = ruleThinkingOverride;
  }
  if (isRuleFinal) {
    decision.isRuleFinal = true;
  }
  if (ruleModelOverride) {
    try {
      const { provider, modelId } = parseCanonicalModelRef(ruleModelOverride);
      decision.targetProvider = provider;
      decision.targetModelId = modelId;
      decision.targetLabel = ruleModelOverride;
      decision.isModelForced = true;
      decision.reasoning = `Rule model override -> ${ruleModelOverride}. (${decision.reasoning})`;
    } catch {
      // Invalid refs are already warned at config parse; keep the tier model.
    }
  }
  return decision;
};

// Re-export so the heuristic chain stays inspectable from one import surface.
export { containsAny };
