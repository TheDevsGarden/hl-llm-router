import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type {
  RouterConfig,
  RouterPinByProfile,
  RouterThinkingByProfile,
  RoutingDecision,
  CompactionRecord,
} from '../types';

export interface CommandState {
  readonly currentConfig: RouterConfig;
  routerEnabled: boolean;
  selectedProfile: string | undefined;
  readonly pinnedTierByProfile: RouterPinByProfile;
  readonly thinkingByProfile: RouterThinkingByProfile;
  readonly lastDecision: RoutingDecision | undefined;
  lastNonRouterModel: string | undefined;
  readonly accumulatedCost: number;
  readonly lastCompaction: CompactionRecord | undefined;
  debugEnabled: boolean;
  widgetEnabled: boolean;
  /** Whether the Morph tools are in pi's active tool set. */
  readonly morphToolsEnabled: boolean;
  readonly debugHistory: RoutingDecision[];
  readonly lastConfigWarnings: string[];
  /** Emergency override of the context window applied to non-router model selects. */
  contextOverride: number | undefined;
}

export interface CommandActions {
  persistState: () => void;
  updateStatus: (ctx: ExtensionContext) => void;
  reloadConfig: (
    ctx?: ExtensionContext,
    options?: { preserveDebug?: boolean },
  ) => void;
  ensureValidActiveRouterProfile: (ctx: ExtensionContext) => Promise<void>;
  switchToRouterProfile: (
    profileName: string,
    ctx: ExtensionContext,
    strict?: boolean,
  ) => Promise<boolean>;
  syncPiThinkingLevel: (level: ThinkingLevel) => void;
  /** T17: mark the next compaction as /router-initiated. */
  beginRouterCompaction: () => void;
  /** Add or remove the Morph tools from pi's active tool set. */
  setMorphToolsEnabled: (enabled: boolean) => void;
  /** Set or clear the emergency context-window override (see `/router context-override`). */
  setContextOverride: (value: number | undefined) => void;
}

export interface CommandContext {
  pi: ExtensionAPI;
  state: CommandState;
  actions: CommandActions;
}
