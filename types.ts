import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export type RouterTier = "high" | "medium" | "low";

/** The three exhaustion pools. Order in poolOrder determines drain sequence. */
export type PoolName = "free" | "subs" | "metered";
export type RouterPin = RouterTier | "auto";
export type RouterPhase = "planning" | "implementation" | "lightweight";
export type RouterPinByProfile = Partial<Record<string, RouterTier>>;
export type RouterThinkingByTier = Partial<Record<RouterTier, ThinkingLevel>>;
export type RouterThinkingByProfile = Record<string, RouterThinkingByTier>;

export interface RoutingRule {
	matches: string | string[];
	tier: RouterTier;
	model?: string; // T12: optional model override (canonical provider/model ref)
	thinking?: ThinkingLevel; // T13: per-rule thinking, bypasses the tier's level
	/**
	 * T16: hard escape — the classifier never overrides this rule's decision,
	 * not even on tool-failure re-classification. Default false: soft rules set
	 * the initial route but the classifier may re-route on failure evidence.
	 */
	final?: boolean;
	reason?: string;
}

/**
 * T13: a model pinned outside the tier ladder (first turn, classifier ultra).
 * `thinking` is applied verbatim — it is NOT clamped to the tier's levels,
 * because the model is deliberately not the tier's primary.
 */
export interface ForcedRouteConfig {
	model: string;
	thinking?: ThinkingLevel;
}

/**
 * T14: score-to-tier boundaries for the complexity classifier.
 * A turn scoring >= ultra maps to the ultra route, >= high to the high
 * tier, >= medium to medium, below that low. Internal only — every
 * user-visible surface still shows tier labels.
 */
export interface ComplexityThresholds {
	medium: number;
	high: number;
	ultra: number;
}

export interface ModelDefinition {
	model: string;
	contextWindow?: number;
	maxTokens?: number;
	reasoning?: boolean;
	thinkingLevels?: ThinkingLevel[];
	/**
	 * Per-model hang-guard budget. The hang guard waits this long for the
	 * first byte before declaring the model hung and cooling it. Default is
	 * 180s (3 min) for non-reasoning models, 600s (10 min) for reasoning
	 * models. Cap is 1800000ms (30 min) — beyond that the user should be
	 * running a local model on a different daemon.
	 */
	responseTimeoutMs?: number;
}

export interface ClassifierConfig {
	model: string;
	thinking?: ThinkingLevel;
}

export interface RoutedTierConfig {
	model: string;
	thinking?: ThinkingLevel;
	fallbacks?: string[];
	contextWindow?: number;
	maxTokens?: number;
	reasoning?: boolean;
	thinkingLevels?: ThinkingLevel[];
	resolvedContextWindow?: number;
	resolvedMaxTokens?: number;
	resolvedThinkingLevels?: ThinkingLevel[];
	/**
	 * Per-model hang-guard budget, in milliseconds. Carried from models.json
	 * into the routed tier config so the tier ladder can compute a timeout
	 * before the model is looked up via the registry. See ModelDefinition for
	 * the full semantics.
	 */
	responseTimeoutMs?: number;
}

export interface RouterProfile {
	high?: RoutedTierConfig;
	medium?: RoutedTierConfig;
	low?: RoutedTierConfig;
	/**
	 * Drain order for this profile's pool-derived fallbacks, overriding the
	 * top-level `poolOrder`. This is what makes profiles true opposites:
	 * free-first drains ['free','subs','metered'], subs-first drains
	 * ['subs','free','metered']. A single-entry order ('free-only') confines the
	 * profile to one pool and never escalates past it.
	 */
	poolOrder?: PoolName[];
}

export type CooldownScope = "provider" | "model";
export type CooldownReason =
	| "quota"
	| "rate-limit"
	| "auth"
	| "server"
	| "hang"
	| "manual";

/** Cooldown windows in milliseconds (config accepts "5h"/"90s"; normalized on load). */
export interface CooldownRule {
	rateLimit: number;
	quota: number;
	auth: number;
	server: number;
	scope: CooldownScope;
}

export interface CooldownSettings {
	enabled: boolean;
	defaults: Partial<CooldownRule>;
	providers: Record<string, Partial<CooldownRule>>;
}

export interface CooldownEntry {
	key: string;
	scope: CooldownScope;
	provider: string;
	model?: string;
	reason: CooldownReason;
	/** True when the window came from the provider's own retry hint, not config. */
	advertised?: boolean;
	since: number;
	until: number;
}

export interface CooldownState {
	entries: Record<string, CooldownEntry>;
}

/** A model classified into a pool, ready for quality sorting. */
export interface PoolCandidate {
	readonly canonicalId: string;
	readonly pool: PoolName;
	readonly contextWindow: number;
	readonly qualityScore: number;
}

/** Result of classifying all models.json entries into pools. */
export interface PoolClassification {
	readonly free: readonly PoolCandidate[];
	readonly subs: readonly PoolCandidate[];
	readonly metered: readonly PoolCandidate[];
	readonly total: number;
}

/** Shape of one model in free-models.json cache. */
export interface FreeCacheEntry {
	readonly id: string;
	readonly free: boolean;
}

export interface FreeModelScore {
	readonly aaIndex?: number;
	readonly mmlu?: number;
	readonly mmluPro?: number;
	readonly swebench?: number;
	readonly terminalBench?: number;
	readonly liveCodeBench?: number;
}

/**
 * Morph tool availability. Not a profile setting: the router picks which model
 * runs a turn, while these are capabilities any turn can reach for.
 */
export interface MorphToolsConfig {
	/** Default true — absent config means the tools are available. */
	enabled?: boolean;
}

export interface RouterConfig {
	debug?: boolean;
	cooldowns?: CooldownSettings;
	morphTools?: MorphToolsConfig;
	classifierModel?: ClassifierConfig;
	classifierModels?: ClassifierConfig[];
	classifierRunOnceAfterToolCount?: number;
	classifierRunAfterToolFailures?: number;
	classifierInterval?: number;
	defaultContextThresholdPercent?: number;
	contextThresholdPercentOverrides?: Record<string, number>;
	phaseBias?: number;
	maxSessionBudget?: number;
	/** T13: model for the first user turn of a session only. */
	firstTurn?: ForcedRouteConfig;
	/** T13: opt-in 4th classifier tier for the hardest planning turns. */
	classifierUltra?: ForcedRouteConfig;
	/** T14: minutes that must pass between ultra escalations (0/absent = off). */
	ultraCooldownMinutes?: number;
	/** T14: score boundaries for the complexity classifier. */
	classifierComplexityThresholds?: ComplexityThresholds;
	/**
	 * T17: models for `/router compact`, in fallback order. MANUAL compactions
	 * only — threshold and overflow keep pi's own compaction path, so an
	 * automatic compaction is never silently degraded by this list. Same
	 * `{ model, thinking }` shape as `classifierModels`, so it inherits the
	 * ordered-fallback, provider-disable, and cooldown-filtering semantics.
	 */
	compactionModels?: ClassifierConfig[];
	/**
	 * T15: provider names (first segment of a canonical model ref) excluded
	 * from ALL model resolution — tier primaries, fallbacks, the classifier
	 * list, firstTurn, classifierUltra, and rule model overrides. Managed via
	 * /router provider enable|disable, which writes this field to the config
	 * file immediately.
	 */
	disabledProviders?: string[];
	rules?: RoutingRule[];
	profiles: Record<string, RouterProfile>;
	models?: Record<string, ModelDefinition>;
	/** Pool drain order. Default: ['free', 'subs', 'metered'].
	 *  Used when a tier has no explicit fallbacks. */
	poolOrder?: PoolName[];
}

export interface RoutingDecision {
	profile: string;
	tier: RouterTier;
	phase: RouterPhase;
	targetProvider: string;
	targetModelId: string;
	targetLabel: string;
	reasoning: string;
	thinking: ThinkingLevel;
	timestamp: number;
	isClassifier?: boolean;
	isFallback?: boolean;
	isBudgetForced?: boolean;
	isRuleMatched?: boolean;
	/** T16: the matched rule is a hard escape (final: true). */
	isRuleFinal?: boolean;
	isContextForced?: boolean;
	isReused?: boolean;
	isModelForced?: boolean;
	isFirstTurn?: boolean;
	isUltra?: boolean;
	/** T15: the candidate chain was thinned or re-tiered by disabled providers. */
	isProviderFiltered?: boolean;
	/** Candidates skipped this turn because they were cooling down. */
	skippedCooling?: string[];
}

/** T15: one place a provider is referenced in the active config. */
export interface ProviderUsage {
	/** Canonical model ref that uses this provider. */
	ref: string;
	/** Human-readable location, e.g. "profile x/high", "fallback x/medium", "classifier". */
	where: string;
}

/** T15: inventory row for /router provider list. */
export interface ProviderInfo {
	name: string;
	enabled: boolean;
	usages: ProviderUsage[];
}

/**
 * T17: record of the last manual compaction, surfaced in `/router status`.
 * `fellBackToDefault` is load-bearing — without it the status line would
 * claim a cheap compaction that never ran when every configured model failed.
 */
export interface CompactionRecord {
	/** Canonical ref that produced the summary. */
	model: string;
	tokensBefore: number;
	summaryChars: number;
	/** Reported into session totals when the provider returns usage. */
	cost?: number;
	timestamp: number;
	/**
	 * True when every configured model failed and pi's default compaction ran
	 * instead. The difference between an honest status line and a hopeful one.
	 */
	fellBackToDefault: boolean;
}

export interface RouterPersistedState {
	enabled: boolean;
	selectedProfile: string;
	pinTier?: RouterTier;
	pinByProfile?: RouterPinByProfile;
	thinkingByProfile?: RouterThinkingByProfile;
	debugEnabled?: boolean;
	widgetEnabled?: boolean;
	debugHistory?: RoutingDecision[];
	lastPhase?: RouterPhase;
	lastDecision?: RoutingDecision;
	lastNonRouterModel?: string;
	accumulatedCost?: number;
	/** T14: when the last classifier ultra escalation fired (ms epoch). */
	lastUltraAt?: number;
	/** T17: record of the last manual compaction, for `/router status`. */
	lastCompaction?: CompactionRecord;
	/** Emergency context-window override set by `/router context-override`. */
	contextOverride?: number;
	timestamp: number;
}

export interface ConfigLoadResult {
	config: RouterConfig;
	warnings: string[];
}

export interface ParsedConfigFile {
	config: Partial<RouterConfig>;
	warnings: string[];
}

export interface CustomSessionEntry {
	type: string;
	customType?: string;
	data?: unknown;
}
