import type {
  Context,
  SimpleStreamOptions,
  AssistantMessageEventStream,
} from '@earendil-works/pi-ai';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type {
  CooldownSettings,
  RouterProfile,
  RouterTier,
  RoutingDecision,
} from '../types';
import { clampThinkingLevel } from '../config';

export interface DelegateChainParams {
  modelsToTry: string[];
  registry: ExtensionContext['modelRegistry'];
  profile: RouterProfile;
  decision: RoutingDecision;
  context: Context;
  options: SimpleStreamOptions | undefined;
  stream: AssistantMessageEventStream;
  /** Context window the virtual router model reported (honesty baseline). */
  reportedContextWindow: number;
  profileId: string;
  getThinkingOverride: (
    profileName: string,
    tier: RouterTier,
  ) => ThinkingLevel | undefined;
  setThinkingLabel: (label?: string) => void;
  addCost: (cost: number) => void;
  /** Local fork: the config's `cooldowns` block. undefined/disabled = upstream behavior. */
  cooldowns: CooldownSettings | undefined;
  /** Local fork: agent dir holding router-cooldowns.json. '' when cooldowns are off. */
  cooldownDir: string;
}

export interface DelegateChainResult {
  success: boolean;
  /** True when the primary was skipped/failed and a fallback carried the turn. */
  fellBack: boolean;
  lastError: unknown;
}

/**
 * Resolve the reasoning level actually sent to the target model: the router's
 * thinking (override > decision) clamped to what the tier declares, and dropped
 * entirely when the target model does not reason.
 */
export const resolveDelegatedReasoning = (
  params: DelegateChainParams,
  decision: RoutingDecision,
  targetSupportsReasoning: boolean | undefined,
): SimpleStreamOptions['reasoning'] | undefined => {
  const thinkingOverride = params.getThinkingOverride(
    params.profileId,
    decision.tier,
  );
  let requestedReasoning = thinkingOverride ?? decision.thinking;

  if (requestedReasoning !== 'off' && targetSupportsReasoning) {
    const tierConfig = params.profile[decision.tier];
    if (tierConfig?.resolvedThinkingLevels) {
      requestedReasoning = clampThinkingLevel(
        requestedReasoning as ThinkingLevel,
        tierConfig.resolvedThinkingLevels,
      ) as typeof requestedReasoning;
    }
  }

  return targetSupportsReasoning && requestedReasoning !== 'off'
    ? (requestedReasoning as SimpleStreamOptions['reasoning'])
    : undefined;
};