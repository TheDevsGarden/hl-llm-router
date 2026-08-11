import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import {
  type RouterConfig,
  type RouterPersistedState,
  type RoutingDecision,
  type RouterPinByProfile,
  type RouterThinkingByProfile,
  type RouterTier,
  type CustomSessionEntry,
  type CompactionRecord,
  type PoolClassification,
} from './types';
import {
  loadRouterConfig,
  profileNames,
  resolveProfileName,
  parseCanonicalModelRef,
  ROUTER_TIERS,
  getUnsupportedTiers,
} from './config';
import { MAX_DEBUG_HISTORY } from './constants';
import { isRouterPersistedState, buildPersistedState } from './state';
import { updateStatus, formatModelRef } from './ui';
import { registerCommands } from './commands';
import { registerMorphTools, type MorphToolsState } from './morph';
import { registerRouterProvider } from './provider';
import { toDisabledSet } from './providers';
import { readFreeModelCache, readQualityScores } from './shared/cache-reader';
import { classifyPools } from './routing/pools';
import { resolveCompactionSummary } from './compaction';
import { getAgentDir } from '@earendil-works/pi-coding-agent';

const routerExtension = (pi: ExtensionAPI) => {
  let currentConfig: RouterConfig = { profiles: {} };
  let currentModelRegistry: ExtensionContext['modelRegistry'] | undefined;
  let currentCwd = process.cwd();
  let lastDecision: RoutingDecision | undefined;
  let debugEnabled = false;
  let routerEnabled = false;
  let selectedProfile: string | undefined = undefined;
  let widgetEnabled = false;
  let lastRegisteredModels = '';
  let pinnedTierByProfile: RouterPinByProfile = {};
  let thinkingByProfile: RouterThinkingByProfile = {};
  let debugHistory: RoutingDecision[] = [];
  let lastNonRouterModel: string | undefined;
  let accumulatedCost = 0;
  let lastUltraAt: number | undefined;
  /** T17: last manual compaction record, surfaced in /router status. */
  let lastCompaction: CompactionRecord | undefined;
  /** Emergency context-window override set by `/router context-override`. */
  let contextOverride: number | undefined;
  let poolClassification: PoolClassification | undefined;
  /**
   * Raw text of the last prompt the human typed, captured from the `input`
   * event. Routing rules — `#sigil` rules above all, since they are `final` —
   * match this instead of the last role:"user" message: pi's convertToLlm
   * files compaction summaries, branch summaries, `!bash` output and
   * extension-injected messages under that same role, so a sigil quoted back
   * by any of them would hard-pin a model the user never asked for.
   */
  let humanPrompt: string | undefined;
  /**
   * Morph tools are profile-independent capabilities, not a routing target, so
   * this lives beside the router state rather than in a profile. Default on;
   * `/router morphtools disable` removes them from pi's active tool set.
   */
  const morphTools: MorphToolsState = { enabled: true };
  // Reassigned by registerMorphTools below, once currentConfig has been loaded.
  // Until then this is a no-op setter so nothing can call into pi too early.
  let setMorphToolsEnabled: (enabled: boolean) => void = (enabled) => {
    morphTools.enabled = enabled;
  };
  /**
   * T17: set immediately before ctx.compact() so the session_before_compact
   * handler knows this compaction was /router-initiated. reason === 'manual'
   * alone is not enough — plain /compact is also manual. Cleared in a finally
   * so a cancelled/failed compaction cannot hijack the next plain /compact.
   */
  let routerInitiated = false;
  let lastExtensionContext: ExtensionContext | undefined;
  let lastConfigWarnings: string[] = [];
  let lastPersistedSnapshot: string | undefined;
  let isInitialized = false;
  let isInternalModelSwitch = false;
  let isInternalThinkingChange = false;

  const setModelInternally = async (
    model: NonNullable<ExtensionContext['model']>,
  ) => {
    isInternalModelSwitch = true;
    try {
      return await pi.setModel(model);
    } catch {
      // Extension context may be stale after session teardown.
      return false;
    } finally {
      isInternalModelSwitch = false;
    }
  };

  const setThinkingLevelInternally = (level: ThinkingLevel) => {
    isInternalThinkingChange = true;
    try {
      pi.setThinkingLevel(level);
    } catch {
      // Extension context may be stale after session teardown.
    } finally {
      isInternalThinkingChange = false;
    }
  };

  const getPinnedTierForProfile = (
    profileName: string,
  ): RouterTier | undefined => pinnedTierByProfile[profileName];

  const setPinnedTierForProfile = (
    profileName: string,
    tier: RouterTier | undefined,
  ) => {
    if (tier) {
      pinnedTierByProfile[profileName] = tier;
    } else {
      delete pinnedTierByProfile[profileName];
    }
  };

  const recordDebugDecision = (decision: RoutingDecision) => {
    debugHistory = [...debugHistory, decision].slice(-MAX_DEBUG_HISTORY);
  };

  const getThinkingOverride = (profileName: string, tier: RouterTier) => {
    return thinkingByProfile[profileName]?.[tier];
  };

  const persistState = () => {
    const state = buildPersistedState(
      routerEnabled,
      selectedProfile,
      pinnedTierByProfile,
      thinkingByProfile,
      debugEnabled,
      widgetEnabled,
      debugHistory,
      lastDecision,
      lastNonRouterModel,
      accumulatedCost,
      lastUltraAt,
      lastCompaction,
      contextOverride,
    );
    const snapshot = JSON.stringify({
      ...state,
      timestamp: 0,
      lastDecision: state.lastDecision
        ? { ...state.lastDecision, timestamp: 0 }
        : undefined,
      debugHistory: state.debugHistory?.map((decision) => ({
        ...decision,
        timestamp: 0,
      })),
    });
    if (snapshot === lastPersistedSnapshot) {
      return;
    }
    try {
      pi.appendEntry('router-state', state);
    } catch {
      // Defensive fallback: the session_shutdown event may fire after this
      // code runs (due to event loop ordering), so isActive can still be
      // true even though the runtime is already stale.
      return;
    }
    lastPersistedSnapshot = snapshot;
  };

  const actions = {
    persistState,
    syncPiThinkingLevel: setThinkingLevelInternally,
    updateStatus: (ctx: ExtensionContext) =>
      updateStatus(
        ctx,
        routerEnabled,
        selectedProfile,
        pinnedTierByProfile,
        thinkingByProfile,
        lastDecision,
        lastNonRouterModel,
        accumulatedCost,
        widgetEnabled,
        currentConfig,
      ),
    reloadConfig: (
      ctx?: ExtensionContext,
      options?: { preserveDebug?: boolean },
    ) => {
      const loaded = loadRouterConfig(currentCwd);
      currentConfig = loaded.config;
      lastConfigWarnings = loaded.warnings;
      if (!options?.preserveDebug) {
        debugEnabled = currentConfig.debug ?? false;
      }
      selectedProfile = resolveProfileName(currentConfig, selectedProfile);
      actions.registerRouterProvider();
      if (ctx) {
        actions.updateStatus(ctx);
        if (lastConfigWarnings.length > 0) {
          ctx.ui.notify(
            `Router Configuration Warnings:\n${lastConfigWarnings.join('\n')}`,
            'warning',
          );
        }
      }
    },
    ensureValidActiveRouterProfile: async (ctx: ExtensionContext) => {
      if (ctx.model?.provider !== 'router') {
        return;
      }
      if (currentConfig.profiles[ctx.model.id]) {
        selectedProfile = ctx.model.id;
        routerEnabled = true;
        return;
      }

      // The active router model's profile no longer exists in config
      ctx.ui.notify(
        `Router profile "${ctx.model.id}" is no longer configured.`,
        'warning',
      );
      routerEnabled = false;
      selectedProfile = undefined;
    },
    switchToRouterProfile: async (
      profileName: string,
      ctx: ExtensionContext,
      strict = true,
    ) => {
      if (!currentConfig.profiles[profileName]) {
        if (strict) {
          ctx.ui.notify(`Unknown router profile: ${profileName}`, 'error');
        }
        return false;
      }

      // Ensure the provider is registered with current capacities for this profile
      actions.registerRouterProvider();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const routerModel = ctx.modelRegistry.find('router', profileName);
      if (!routerModel) {
        ctx.ui.notify(`Unknown router profile: ${profileName}`, 'error');
        return false;
      }
      if (ctx.model && ctx.model.provider !== 'router') {
        lastNonRouterModel = `${ctx.model.provider}/${ctx.model.id}`;
      }
      const success = await setModelInternally(routerModel);
      if (!success) {
        ctx.ui.notify(`Failed to switch to router/${profileName}`, 'error');
        return false;
      }
      selectedProfile = profileName;
      routerEnabled = true;
      persistState();
      actions.updateStatus(ctx);
      return true;
    },
    setMorphToolsEnabled: (enabled: boolean) => {
      setMorphToolsEnabled(enabled);
    },
    setContextOverride: (value: number | undefined) => {
      contextOverride =
        typeof value === 'number' && Number.isFinite(value) && value >= 1024
          ? Math.round(value)
          : undefined;
      persistState();
    },
    beginRouterCompaction: () => {
      routerInitiated = true;
    },
    registerRouterProvider: () => {
      registerRouterProvider(
        pi,
        {
          get lastRegisteredModels() {
            return lastRegisteredModels;
          },
          set lastRegisteredModels(v) {
            lastRegisteredModels = v;
          },
          get currentConfig() {
            return currentConfig;
          },
          get currentModelRegistry() {
            return currentModelRegistry;
          },
          get lastExtensionContext() {
            return lastExtensionContext;
          },
          get selectedProfile() {
            return selectedProfile;
          },
          set selectedProfile(v) {
            selectedProfile = v;
          },
          get routerEnabled() {
            return routerEnabled;
          },
          set routerEnabled(v) {
            routerEnabled = v;
          },
          get lastDecision() {
            return lastDecision;
          },
          set lastDecision(v) {
            lastDecision = v;
          },
          thinkingByProfile,
          pinnedTierByProfile,
          get accumulatedCost() {
            return accumulatedCost;
          },
          set accumulatedCost(v) {
            accumulatedCost = v;
          },
          get lastUltraAt() {
            return lastUltraAt;
          },
          set lastUltraAt(v) {
            lastUltraAt = v;
          },
          get poolClassification() {
            return poolClassification;
          },
          get humanPrompt() {
            return humanPrompt;
          },
        },
        {
          persistState,
          recordDebugDecision,
          getThinkingOverride,
          updateStatus: actions.updateStatus,
          syncPiThinkingLevel: setThinkingLevelInternally,
        },
      );
    },
  };

  actions.reloadConfig();

  // After reloadConfig so `morphTools.enabled` reflects model-router.json.
  // Absent config means on: these are meant to be available by default.
  morphTools.enabled = currentConfig.morphTools?.enabled !== false;
  setMorphToolsEnabled = registerMorphTools(pi, morphTools);

  const restoreStateFromSession = async (ctx: ExtensionContext) => {
    lastExtensionContext = ctx;
    currentModelRegistry = ctx.modelRegistry;
    currentCwd = ctx.cwd;
    actions.reloadConfig(ctx);

    // Give the registry a moment to synchronize after re-registration
    await new Promise((resolve) => setTimeout(resolve, 50));

    routerEnabled = ctx.model?.provider === 'router';
    selectedProfile = ctx.model?.provider === 'router'
      ? resolveProfileName(currentConfig, ctx.model.id)
      : resolveProfileName(currentConfig, selectedProfile);
    // Clear in-place to keep references intact
    for (const key of Object.keys(pinnedTierByProfile)) {
      delete pinnedTierByProfile[key];
    }
    for (const key of Object.keys(thinkingByProfile)) {
      delete thinkingByProfile[key];
    }
    widgetEnabled = false;
    debugHistory = [];
    // A sigil from the previous session must not survive a switch/fork/restore.
    humanPrompt = undefined;
    accumulatedCost = 0;
    lastUltraAt = undefined;
    lastCompaction = undefined;
    routerInitiated = false;
    lastNonRouterModel =
      ctx.model && ctx.model.provider !== 'router'
        ? `${ctx.model.provider}/${ctx.model.id}`
        : lastNonRouterModel;
    lastDecision = undefined;

    const entries = ctx.sessionManager.getBranch() as CustomSessionEntry[];
    const savedState = entries
      .filter(
        (entry) =>
          entry.type === 'custom' && entry.customType === 'router-state',
      )
      .map((entry) => entry.data)
      .findLast((data) => isRouterPersistedState(data));

    if (isRouterPersistedState(savedState)) {
      selectedProfile = resolveProfileName(
        currentConfig,
        savedState.selectedProfile,
      );
      routerEnabled = savedState.enabled;
      if (savedState.pinByProfile) {
        Object.assign(pinnedTierByProfile, savedState.pinByProfile);
      }
      if (savedState.thinkingByProfile) {
        Object.assign(thinkingByProfile, savedState.thinkingByProfile);
      }
      if (savedState.pinTier && selectedProfile) {
        pinnedTierByProfile[selectedProfile] = savedState.pinTier;
      }
      debugEnabled = savedState.debugEnabled ?? debugEnabled;
      widgetEnabled = savedState.widgetEnabled ?? widgetEnabled;
      debugHistory = savedState.debugHistory
        ? [...savedState.debugHistory].slice(-MAX_DEBUG_HISTORY)
        : [];
      lastNonRouterModel = savedState.lastNonRouterModel ?? lastNonRouterModel;
      accumulatedCost = savedState.accumulatedCost ?? 0;
      lastUltraAt = savedState.lastUltraAt;
      lastCompaction = savedState.lastCompaction;
      lastDecision = savedState.lastDecision;
      contextOverride = savedState.contextOverride;
    }

    // Read free-models cache + quality scores, classify into pools
    try {
      const agentDir = getAgentDir();
      const freeCache = readFreeModelCache(`${agentDir}/cache/free-models.json`);
      const scores = readQualityScores(`${agentDir}/cache/quality-scores.json`);
      poolClassification = classifyPools(currentConfig, freeCache, scores);
    } catch {
      poolClassification = undefined;
    }

    await actions.ensureValidActiveRouterProfile(ctx);

    if (routerEnabled && selectedProfile) {
      const routerModel = ctx.modelRegistry.find('router', selectedProfile);
      if (routerModel) {
        const success = await setModelInternally(routerModel);
        if (!success) {
          ctx.ui.notify(
            `Failed to restore router/${selectedProfile} after relaunch.`,
            'warning',
          );
          routerEnabled = false;
        } else if (lastDecision && ctx.model?.provider === 'router') {
          // Sync pi's thinking level display with the router's last decision
          // Only when router is the active model - otherwise respect user's /effort setting
          setThinkingLevelInternally(lastDecision.thinking);
        }
      } else {
        ctx.ui.notify(
          `Unable to restore router/${selectedProfile}; model is unavailable.`,
          'warning',
        );
        routerEnabled = false;
        ctx.ui.setHiddenThinkingLabel?.();
      }
    } else {
      ctx.ui.setHiddenThinkingLabel?.();
    }

    persistState();
    actions.updateStatus(ctx);
  };

  registerCommands(
    pi,
    {
      get currentConfig() {
        return currentConfig;
      },
      get routerEnabled() {
        return routerEnabled;
      },
      set routerEnabled(v) {
        routerEnabled = v;
      },
      get selectedProfile() {
        return selectedProfile;
      },
      set selectedProfile(v) {
        selectedProfile = v;
      },
      pinnedTierByProfile,
      thinkingByProfile,
      get lastDecision() {
        return lastDecision;
      },
      get lastNonRouterModel() {
        return lastNonRouterModel;
      },
      set lastNonRouterModel(v) {
        lastNonRouterModel = v;
      },
      get accumulatedCost() {
        return accumulatedCost;
      },
      get debugEnabled() {
        return debugEnabled;
      },
      set debugEnabled(v) {
        debugEnabled = v;
      },
      get widgetEnabled() {
        return widgetEnabled;
      },
      set widgetEnabled(v) {
        widgetEnabled = v;
      },
      get debugHistory() {
        return debugHistory;
      },
      get lastConfigWarnings() {
        return lastConfigWarnings;
      },
      get lastCompaction() {
        return lastCompaction;
      },
      get morphToolsEnabled() {
        return morphTools.enabled;
      },
      get contextOverride() {
        return contextOverride;
      },
    },
    actions,
  );

  pi.on('session_start', async (_event, ctx) => {
    isInitialized = true;
    // Not at load time: setActiveTools is an action, and pi rejects actions
    // during extension loading. This is the first point where it is legal.
    setMorphToolsEnabled(morphTools.enabled);
    await restoreStateFromSession(ctx);
    if (debugEnabled) {
      ctx.ui.notify(
        `Router initialized with profiles: ${profileNames(currentConfig).join(', ')}`,
        'info',
      );
    }
  });

  // Eagerly initialize the model registry from any event that provides
  // ExtensionContext. In subagent contexts (e.g. pi-dynamic-workflows),
  // session_start may never fire, but turn_start/model_select fire before every LLM
  // call — including the first call to the router provider's streamSimple.
  // Only set when not already initialized: if extensions share instances across
  // parent/subagent sessions, always overwriting would replace the parent's valid
  // registry with the subagent's — which goes stale when the subagent ends.
  const ensureInitializedFromContext = (ctx: ExtensionContext) => {
    if (!currentModelRegistry) {
      currentModelRegistry = ctx.modelRegistry;
      lastExtensionContext = ctx;
      currentCwd = ctx.cwd;
      actions.reloadConfig(ctx);
    }
  };

  // A models.json reload rebuilds the provider registry from disk, silently
  // dropping the runtime-registered 'router' provider while this module (and
  // its lastRegisteredModels dedup key) survives. Without healing, the next
  // stream dies with "No API provider registered for api: router-local-api"
  // and pi exits on an uncaughtException. turn_start/model_select fire before
  // every LLM call, so verifying here guarantees the provider exists in the
  // registry that will serve the stream.
  const healRouterRegistration = (ctx: ExtensionContext) => {
    const registry = ctx.modelRegistry as {
      getProvider?: (name: string) => unknown;
    };
    if (typeof registry?.getProvider !== 'function') return;
    if (registry.getProvider('router') !== undefined) return;
    currentModelRegistry = ctx.modelRegistry;
    lastExtensionContext = ctx;
    actions.reloadConfig(ctx);
  };

  pi.on('turn_start', async (_event, ctx) => {
    ensureInitializedFromContext(ctx);
    healRouterRegistration(ctx);
  });

  // The only place pi tells us, unambiguously, what the human typed. Fires on
  // every prompt() before skill/template expansion, so an @file reference
  // cannot smuggle a sigil in from a file's contents. source 'extension' is
  // another extension speaking (subagent briefs, injected memories): recorded
  // as "no human prompt this turn" so rules fall back to reading the context.
  pi.on('input', (event, _ctx) => {
    humanPrompt = event.source === 'extension' ? undefined : event.text;
  });

  pi.on('model_select', async (event, ctx) => {
    // Ensure the model registry is captured even if session_start hasn't fired
    // (e.g. in subagent contexts spawned by pi-dynamic-workflows).
    ensureInitializedFromContext(ctx);
    healRouterRegistration(ctx);
    if (!isInitialized || isInternalModelSwitch) return;
    if (event.model.provider === 'router') {
      const profileName = resolveProfileName(currentConfig, event.model.id);
      if (!profileName) {
        ctx.ui.notify(`Unknown router profile: ${event.model.id}`, 'error');
        return;
      }

      // If the selected model has stale capacities (e.g. from the initial registration),
      // re-apply the model from the registry to force a TUI refresh.
      const registryModel = ctx.modelRegistry.find('router', profileName);
      if (
        registryModel &&
        (registryModel.contextWindow !== event.model.contextWindow ||
          registryModel.maxTokens !== event.model.maxTokens)
      ) {
        await setModelInternally(registryModel);
      }

      // Apply context-window override (e.g. `/router context-override 1M`)
      // to the router profile facade. The facade's advertised contextWindow
      // drives pi's footer + compaction threshold; patching it stops the
      // compaction loop even when the routed underlying model is smaller
      // (truncateContext handles the actual model cap at request time).
      if (
        typeof contextOverride === 'number' &&
        contextOverride > 0 &&
        (event.model.contextWindow ?? 0) < contextOverride
      ) {
        await setModelInternally({
          ...event.model,
          contextWindow: contextOverride,
        });
      }

      routerEnabled = true;
      selectedProfile = profileName;
    } else {
      routerEnabled = false;
      lastNonRouterModel = `${event.model.provider}/${event.model.id}`;
      ctx.ui.setHiddenThinkingLabel?.();
      // Apply context-window override (e.g. `/router context-override 1M`)
      // by patching the model and re-applying it so pi's footer + compaction
      // threshold read the override value instead of the model's native cap.
      if (
        typeof contextOverride === 'number' &&
        contextOverride > 0 &&
        event.model.contextWindow !== contextOverride
      ) {
        await setModelInternally({
          ...event.model,
          contextWindow: contextOverride,
        });
      }
    }
    persistState();
    actions.updateStatus(ctx);
  });

  pi.on('turn_end', async (_event, ctx) => {
    ensureInitializedFromContext(ctx);
    if (routerEnabled && selectedProfile && ctx.model?.provider !== 'router') {
      const routerModel = ctx.modelRegistry.find('router', selectedProfile);
      if (routerModel) {
        await setModelInternally(routerModel);
      }
    }
    persistState();
    actions.updateStatus(ctx);
  });

  pi.on('thinking_level_select', (event, ctx) => {
    ensureInitializedFromContext(ctx);
    if (!isInitialized || !routerEnabled || !selectedProfile) return;
    if (isInternalThinkingChange) return;

    // User changed pi's thinking level (e.g. via shift+tab).
    // Apply as an all-tier thinking override for the active router profile.
    if (!thinkingByProfile[selectedProfile]) {
      thinkingByProfile[selectedProfile] = {};
    }
    for (const t of ROUTER_TIERS) {
      thinkingByProfile[selectedProfile]![t] = event.level;
    }
    persistState();
    actions.updateStatus(ctx);
    if (event.level !== 'off') {
      const unsupported = getUnsupportedTiers(
        currentConfig.profiles[selectedProfile],
        event.level,
      );
      if (unsupported.length > 0) {
        ctx.ui.notify(
          `Router thinking (all) set to ${event.level}. ` +
            `${unsupported.join(', ')} tier${unsupported.length > 1 ? 's' : ''} may not support '${event.level}'.`,
          'warning',
        );
      }
    }
  });
  // T17: /router compact — manual compactions only, using compactionModels.
  //   reason === 'manual' covers plain /compact too; routerInitiated (set by
  //   beginRouterCompaction just before ctx.compact()) is what scopes us to
  //   /router compact. Threshold/overflow and plain /compact keep pi's own
  //   path so an automatic compaction is never silently degraded.
  //   Never throws — a failed cheap compaction degrades to pi's default,
  //   it must not cost the session.
  pi.on('session_before_compact', async (event, ctx) => {
    if (event.reason !== 'manual' || !routerInitiated) return;
    const config = currentConfig;
    if (!config.compactionModels || config.compactionModels.length === 0) {
      return;
    }
    const registry = currentModelRegistry ?? ctx.modelRegistry;
    const disabledProviders = toDisabledSet(config);
    try {
      const outcome = await resolveCompactionSummary({
        preparation: event.preparation,
        registry,
        config,
        disabledProviders,
        cooldownDir: getAgentDir(),
        customInstructions: event.customInstructions,
        signal: event.signal,
      });
      lastCompaction = outcome.record;
      persistState();
      if (outcome.summary === undefined) {
        // Every configured model failed — let pi's default compaction run.
        ctx.ui.notify(
          'Compaction: all compactionModels failed, using default compaction.',
          'warning',
        );
        return;
      }
      ctx.ui.notify(
        `Compacted with ${outcome.record.model} (${outcome.summary.length.toLocaleString()} chars).`,
        'info',
      );
      return {
        compaction: {
          summary: outcome.summary,
          firstKeptEntryId: outcome.firstKeptEntryId,
          tokensBefore: outcome.tokensBefore,
          usage: outcome.usage,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Compaction failed: ${message}`, 'warning');
      return;
    } finally {
      routerInitiated = false;
    }
  });
};

export default routerExtension;
