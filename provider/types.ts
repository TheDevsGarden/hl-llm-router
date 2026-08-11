import type { ExtensionContext, ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type {
  RouterConfig,
  RouterPinByProfile,
  RouterThinkingByProfile,
  RouterTier,
  RoutingDecision,
  PoolClassification,
} from '../types';

export interface RouterProviderState {
  lastRegisteredModels: string;
  readonly currentConfig: RouterConfig;
  readonly currentModelRegistry:
    | ExtensionContext['modelRegistry']
    | undefined;
  readonly lastExtensionContext: ExtensionContext | undefined;
  selectedProfile: string | undefined;
  routerEnabled: boolean;
  lastDecision: RoutingDecision | undefined;
  readonly thinkingByProfile: RouterThinkingByProfile;
  readonly pinnedTierByProfile: RouterPinByProfile;
  accumulatedCost: number;
  /** T14: when the last classifier ultra escalation fired (ms epoch). */
  lastUltraAt?: number;
  /** Override for the registry wait timeout (for testing). */
  readonly registryTimeoutMs?: number;
  /** Override for the cooldown store directory (for testing). */
  readonly cooldownDir?: string;
  /** Pool classification derived from models.json + free-models cache. */
  poolClassification?: PoolClassification;
  /**
   * Raw text of the last prompt the human typed, captured from pi's `input`
   * event before skill/template expansion. Routing rules match against this
   * rather than the last role:"user" message, which pi also uses for
   * compaction summaries, `!bash` output and extension-injected messages.
   * Undefined when no input event has fired (subagents, tests) — the caller
   * then falls back to reconstructing it from the context.
   */
  readonly humanPrompt?: string;
}

export interface RouterProviderActions {
  persistState: () => void;
  recordDebugDecision: (decision: RoutingDecision) => void;
  getThinkingOverride: (profileName: string, tier: RouterTier) => ThinkingLevel | undefined;
  updateStatus: (ctx: ExtensionContext) => void;
  syncPiThinkingLevel: (level: ThinkingLevel) => void;
}

export type { ExtensionAPI };
