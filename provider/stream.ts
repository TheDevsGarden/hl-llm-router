import type {
  Api,
  Context,
  Model,
  SimpleStreamOptions,
  AssistantMessageEventStream,
} from '@earendil-works/pi-ai';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import type { RoutingDecision } from '../types';
import {
  shouldRunClassifier,
  contextEscalationTier,
  estimateContextChars,
} from '../gating';
import {
  decideRouting,
  buildRoutingDecision,
  phaseForTier,
  hasImageAttachment,
} from '../routing';
import { toDisabledSet } from '../providers';
import { delegateToChain } from '../delegate';
import { createErrorMessage } from '../shared/error-message';
import { waitForRegistry } from './registry-wait';
import { resolveClassifierDecision } from './classifier-decision';
import { preserveGoogleThinkingContinuation } from './google-continuation';
import { escalateTierForImages, modelSupportsImage } from './images';
import { applyDisabledProviderFilter } from './filter';
import { deriveCandidates } from '../routing/pools';
import { activeCooldown, loadCooldowns } from '../cooldown';
import { safeParseModelRef } from '../shared/model-ref';
import type { RouterProviderState, RouterProviderActions } from './types';

/**
 * Build the cooling predicate handed to pool derivation, or undefined when
 * cooldowns are off. Reads the store once per turn rather than per candidate.
 */
const buildCoolingTest = (
  state: RouterProviderState,
): ((canonicalId: string) => boolean) | undefined => {
  if (state.currentConfig.cooldowns?.enabled !== true) return undefined;
  const now = Date.now();
  const cooldowns = loadCooldowns(state.cooldownDir ?? getAgentDir(), now);
  return (canonicalId: string): boolean => {
    const parsed = safeParseModelRef(canonicalId);
    if (!parsed) return false;
    return !!activeCooldown(cooldowns, parsed.provider, parsed.modelId, now);
  };
};

/**
 * The router stream body: resolve a decision, run the classifier override,
 * apply post-route escalations (google continuation, images, context
 * threshold), thin the chain by disabled providers, then delegate.
 *
 * Extracted as one cohesive async flow rather than step functions: the steps
 * share a large mutable closure (state, decision, modelsToTry) and splitting
 * them would pass an 8-field bag through every call, adding indirection
 * without removing any concept. Kept together so the linear flow stays legible.
 */
export const runRouterStream = async (
  state: RouterProviderState,
  actions: RouterProviderActions,
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions | undefined,
  stream: AssistantMessageEventStream,
): Promise<void> => {
  try {
    // Wait for the router to be fully initialized (session_start sets currentModelRegistry).
    const registry = await waitForRegistry(state, state.registryTimeoutMs);
    if (!registry) {
      throw new Error(
        'Router provider initialization timed out. session_start may not have fired.',
      );
    }
    const profile = state.currentConfig.profiles[model.id];
    if (!profile) {
      throw new Error(`Unknown router profile: ${model.id}`);
    }

    state.selectedProfile = model.id;
    state.routerEnabled = true;

    const disabledProviders = toDisabledSet(state.currentConfig);

    const pinnedTier = state.pinnedTierByProfile[model.id];
    const isBudgetExceeded =
      state.currentConfig.maxSessionBudget !== undefined &&
      state.accumulatedCost >= state.currentConfig.maxSessionBudget;

    let decision: RoutingDecision = decideRouting(
      context,
      model.id,
      profile,
      state.lastDecision,
      pinnedTier,
      state.thinkingByProfile[model.id],
      state.currentConfig.phaseBias,
      state.currentConfig.rules,
      isBudgetExceeded,
      state.humanPrompt,
    );

    const classifierResolved = await resolveClassifierDecision({
      context,
      registry,
      config: state.currentConfig,
      profile,
      profileId: model.id,
      decision,
      pinnedTier,
      isBudgetExceeded,
      lastDecision: state.lastDecision,
      lastUltraAt: state.lastUltraAt,
      disabledProviders,
      thinkingOverrides: state.thinkingByProfile[model.id],
      cooldownDir: state.cooldownDir ?? getAgentDir(),
    });
    decision = classifierResolved.decision;
    if (classifierResolved.ultraFiredAt !== undefined) {
      state.lastUltraAt = classifierResolved.ultraFiredAt;
    }

    const lastMessage = context.messages[context.messages.length - 1];
    decision = preserveGoogleThinkingContinuation(
      decision,
      state.lastDecision,
      lastMessage,
      model.id,
    );

    const imageAttached = hasImageAttachment(context);

    if (imageAttached) {
      decision = escalateTierForImages(
        decision,
        profile,
        model.id,
        registry,
        state.thinkingByProfile[model.id],
      );
    }

    // T11.3: context-threshold escalation (post-route correction; off unless configured).
    const escalatedTier = contextEscalationTier(
      decision.tier,
      decision.targetLabel,
      estimateContextChars(context),
      {
        low: profile.low?.resolvedContextWindow,
        medium: profile.medium?.resolvedContextWindow,
        high: profile.high?.resolvedContextWindow,
      },
      state.currentConfig.defaultContextThresholdPercent,
      state.currentConfig.contextThresholdPercentOverrides,
    );
    if (escalatedTier && profile[escalatedTier]) {
      decision = buildRoutingDecision(
        model.id,
        profile,
        escalatedTier,
        phaseForTier(escalatedTier),
        `Context threshold exceeded for ${decision.targetLabel}; escalated to ${escalatedTier}. (${decision.reasoning})`,
        state.thinkingByProfile[model.id],
        false,
      );
      decision.isContextForced = true;
    }

    // T15: candidate chain — either curated (explicit fallbacks) or
    // pool-based (derived from models.json + free-models cache).
    const tierPrimary = profile[decision.tier]?.model;
    // Profile order wins over the global default: that is what lets
    // free-first and subs-first drain the pools in opposite directions, and
    // what makes a single-entry order ("free-only") stay inside one pool.
    const poolOrder = profile.poolOrder ??
      state.currentConfig.poolOrder ?? ['free', 'subs', 'metered'];
    const derivedCandidates = state.poolClassification
      ? deriveCandidates(
          decision,
          profile,
          state.poolClassification,
          poolOrder,
          buildCoolingTest(state),
        )
      : [
          decision.targetLabel,
          ...(decision.isModelForced && tierPrimary ? [tierPrimary] : []),
          ...(profile[decision.tier]?.fallbacks ?? []),
        ];
    const filtered = applyDisabledProviderFilter(
      decision,
      [...new Set(derivedCandidates)],
      profile,
      model.id,
      disabledProviders,
      state.thinkingByProfile[model.id],
    );
    decision = filtered.decision;
    let modelsToTry = filtered.modelsToTry;

    state.lastDecision = decision;
    actions.recordDebugDecision(decision);

    const effectiveThinking =
      actions.getThinkingOverride(model.id, decision.tier) ??
      decision.thinking;
    try {
      actions.syncPiThinkingLevel(effectiveThinking);
      if (state.lastExtensionContext) {
        actions.updateStatus(state.lastExtensionContext);
      }
    } catch {
      // Stale extension context — skip non-critical UI updates.
    }

    if (imageAttached) {
      modelsToTry = modelsToTry.filter((ref) =>
        modelSupportsImage(registry, ref),
      );
      if (modelsToTry.length === 0) {
        modelsToTry = [decision.targetLabel];
      }
    }

    const cooldownsEnabled =
      state.currentConfig.cooldowns?.enabled === true;
    const delegation = await delegateToChain({
      modelsToTry,
      registry,
      profile,
      decision,
      context,
      options,
      stream,
      reportedContextWindow: model.contextWindow!,
      profileId: model.id,
      getThinkingOverride: actions.getThinkingOverride,
      setThinkingLabel: (label) => {
        try {
          if (!state.lastExtensionContext) return;
          if (label) {
            state.lastExtensionContext.ui.setHiddenThinkingLabel?.(label);
          } else {
            state.lastExtensionContext.ui.setHiddenThinkingLabel?.();
          }
        } catch {
          // Stale extension context — skip non-critical UI updates.
        }
      },
      addCost: (cost) => {
        state.accumulatedCost += cost;
      },
      cooldowns: state.currentConfig.cooldowns,
      cooldownDir:
        state.cooldownDir ?? (cooldownsEnabled ? getAgentDir() : ''),
    });
    if (delegation.fellBack) decision.isFallback = true;

    if (!delegation.success) {
      const lastError = delegation.lastError;
      throw lastError instanceof Error
        ? lastError
        : new Error(
            typeof lastError === 'string'
              ? lastError
              : 'Failed to delegate to any model in the chain.',
          );
    }

    stream.end();
  } catch (error) {
    // When a subagent session is torn down (e.g. by pi-dynamic-workflows),
    // the extension runtime is invalidated and any pi/ctx call throws a
    // stale-context error. Push a graceful done event so the stream's
    // result() promise resolves (required by AssistantMessageEventStream).
    const isStaleCtx =
      error instanceof Error && error.message.includes('stale');
    if (isStaleCtx) {
      stream.push({
        type: 'done',
        reason: 'stop',
        message: createErrorMessage(model, ''),
      });
    } else {
      stream.push({
        type: 'error',
        reason: 'error',
        error: createErrorMessage(
          model,
          error instanceof Error ? error.message : String(error),
        ),
      });
    }
    stream.end();
  } finally {
    try {
      actions.persistState();
    } catch {
      // Ignore: extension context may be stale after session teardown.
    }
  }
};
