import type {
  RouterConfig,
  RouterProfile,
  ConfigLoadResult,
  RouterTier,
  RoutingRule,
  ClassifierConfig,
  ForcedRouteConfig,
  ComplexityThresholds,
  ModelDefinition,
  PoolName,
} from '../types';
import { isObjectRecord, isRouterTier, isThinkingLevel } from './guards';
import { resolveModelRef } from './parse-file';
import { parseCanonicalModelRef } from '../shared/model-ref';
import { normalizeModelsMap } from './models-map';
import { normalizeForcedRoute, normalizeComplexityThresholds } from './forced-route';
import { normalizeTierConfig } from './tier';
import { normalizeCooldowns } from './cooldowns';
import type { MorphToolsConfig } from '../types';

/**
 * The `morphTools` block. Anything malformed falls back to enabled with a
 * warning: silently dropping three tools because of a typo is worse than
 * ignoring a bad value the user can see flagged in /router status.
 */
const normalizeMorphTools = (
  raw: unknown,
  warnings: string[],
): MorphToolsConfig => {
  if (raw === undefined) return { enabled: true };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    warnings.push('morphTools must be an object. Using defaults (enabled).');
    return { enabled: true };
  }
  const enabled = (raw as { enabled?: unknown }).enabled;
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    warnings.push('morphTools.enabled must be a boolean. Using default (true).');
    return { enabled: true };
  }
  return { enabled: enabled !== false };
};
import { normalizeDisabledProviders, normalizeModelChoiceList } from './misc';
import { invariant } from '../invariants';

const VALID_POOLS: readonly PoolName[] = ['free', 'subs', 'metered'];

/**
 * Validate a pool drain order. Used for both the top-level `poolOrder` and the
 * per-profile override, so a typo is reported identically in either place.
 * Returns undefined when absent or fully invalid, letting the caller fall back
 * to the next level of the chain (profile -> global -> built-in default).
 */
const normalizePoolOrder = (
  rawOrder: unknown,
  label: string,
  warnings: string[],
): PoolName[] | undefined => {
  if (!Array.isArray(rawOrder) || rawOrder.length === 0) return undefined;
  const valid = rawOrder.filter((pool): pool is PoolName =>
    (VALID_POOLS as readonly string[]).includes(pool),
  );
  if (valid.length !== rawOrder.length) {
    warnings.push(
      `${label} contains invalid pool names; kept: ${valid.join(', ') || '(none)'}`,
    );
  }
  return valid.length > 0 ? valid : undefined;
};

export const normalizeConfig = (raw: RouterConfig): ConfigLoadResult => {
  const warnings: string[] = [];

  // Normalize models map first so aliases are available during tier normalization
  const normalizedModels = normalizeModelsMap(
    raw.models as Record<string, unknown> | undefined,
    warnings,
  );
  const hasModels = Object.keys(normalizedModels).length > 0;

  const normalizedProfiles: Record<string, RouterProfile> = {};

  for (const [name, profile] of Object.entries(raw.profiles ?? {})) {
    const high = normalizeTierConfig(
      profile?.high,
      name,
      'high',
      warnings,
      hasModels ? normalizedModels : undefined,
    );
    const medium = normalizeTierConfig(
      profile?.medium,
      name,
      'medium',
      warnings,
      hasModels ? normalizedModels : undefined,
    );
    const low = normalizeTierConfig(
      profile?.low,
      name,
      'low',
      warnings,
      hasModels ? normalizedModels : undefined,
    );

    if (!high && !medium && !low) {
      warnings.push(
        `Profile "${name}" has no valid tiers. Skipped.`,
      );
      continue;
    }

    // Post-condition: a profile that survives normalization must carry at
    // least one tier. A future normalizeTierConfig that returns a truthy but
    // empty tier config would otherwise ship a profile that buildRoutingDecision
    // cannot route for any tier.
    invariant(
      !!(high || medium || low),
      `normalizeConfig: profile "${name}" kept with no tiers`,
    );

    const profilePoolOrder = normalizePoolOrder(
      (profile as { poolOrder?: unknown } | undefined)?.poolOrder,
      `profile "${name}"`,
      warnings,
    );

    normalizedProfiles[name] = {
      high,
      medium,
      low,
      ...(profilePoolOrder ? { poolOrder: profilePoolOrder } : {}),
    };
  }

  const phaseBias =
    typeof raw.phaseBias === 'number'
      ? Math.max(0, Math.min(1, raw.phaseBias))
      : 0.5;

  const maxSessionBudget =
    typeof raw.maxSessionBudget === 'number' && raw.maxSessionBudget > 0
      ? raw.maxSessionBudget
      : undefined;

  const rules: RoutingRule[] = [];
  if (Array.isArray(raw.rules)) {
    for (const rule of raw.rules) {
      if (isObjectRecord(rule)) {
        const matches = rule.matches;
        const tier = rule.tier;
        if (
          (typeof matches === 'string' || Array.isArray(matches)) &&
          isRouterTier(tier)
        ) {
          let ruleModel: string | undefined;
          if (typeof rule.model === 'string' && rule.model.trim()) {
            try {
              parseCanonicalModelRef(rule.model.trim());
              ruleModel = rule.model.trim();
            } catch {
              warnings.push(
                `Routing rule model "${rule.model}" is not a canonical provider/model ref; rule kept without model override.`,
              );
            }
          }
          const ruleThinking = isThinkingLevel(rule.thinking) ? rule.thinking : undefined;
          if (rule.thinking !== undefined && !ruleThinking) {
            warnings.push(
              `Routing rule has invalid thinking level "${String(rule.thinking)}"; rule kept without a thinking override.`,
            );
          }
          if (rule.final !== undefined && typeof rule.final !== 'boolean') {
            warnings.push(
              `Routing rule has non-boolean "final" value "${String(rule.final)}"; treated as soft.`,
            );
          }
          rules.push({
            matches,
            tier,
            model: ruleModel,
            thinking: ruleThinking,
            final: rule.final === true ? true : undefined,
            reason: typeof rule.reason === 'string' ? rule.reason : undefined,
          });
        } else {
          warnings.push(
            `Ignored invalid routing rule: ${JSON.stringify(rule)}`,
          );
        }
      }
    }
  }

  // Resolve classifierModel — accepts string or { model, thinking } object
  let classifierModel: ClassifierConfig | undefined;
  const rawClassifier = raw.classifierModel as unknown;
  if (typeof rawClassifier === 'string' && rawClassifier.trim()) {
    const resolved = resolveModelRef(
      rawClassifier.trim(),
      hasModels ? normalizedModels : undefined,
    );
    try {
      parseCanonicalModelRef(resolved.canonicalRef);
      classifierModel = { model: resolved.canonicalRef };
    } catch (error) {
      warnings.push(
        `Invalid classifierModel: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else if (isObjectRecord(rawClassifier)) {
    const modelRef = typeof rawClassifier.model === 'string' ? rawClassifier.model.trim() : '';
    if (modelRef) {
      const resolved = resolveModelRef(
        modelRef,
        hasModels ? normalizedModels : undefined,
      );
      try {
        parseCanonicalModelRef(resolved.canonicalRef);
        const thinking = isThinkingLevel(rawClassifier.thinking)
          ? rawClassifier.thinking
          : undefined;
        if (rawClassifier.thinking !== undefined && !thinking) {
          warnings.push(
            `classifierModel has invalid thinking level "${String(rawClassifier.thinking)}". Ignored.`,
          );
        }
        classifierModel = { model: resolved.canonicalRef, thinking };
      } catch (error) {
        warnings.push(
          `Invalid classifierModel: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else {
      warnings.push('classifierModel object is missing the "model" field. Ignored.');
    }
  }

  // T11: classifier fallback list, gating knobs, context thresholds.
  const classifierModels = normalizeModelChoiceList(
    raw.classifierModels,
    'classifierModels',
    warnings,
    hasModels ? normalizedModels : undefined,
  );

  const compactionModels = normalizeModelChoiceList(
    raw.compactionModels,
    'compactionModels',
    warnings,
    hasModels ? normalizedModels : undefined,
  );
  const nonNegative = (value: unknown, name: string): number | undefined => {
    if (value === undefined) return undefined;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
    warnings.push(`${name} must be a non-negative number. Ignored.`);
    return undefined;
  };
  const percent = (value: unknown, name: string): number | undefined => {
    if (value === undefined) return undefined;
    if (typeof value === 'number' && value > 0 && value <= 100) return value;
    warnings.push(`${name} must be a percentage in (0, 100]. Ignored.`);
    return undefined;
  };
  const classifierRunOnceAfterToolCount = nonNegative(
    raw.classifierRunOnceAfterToolCount,
    'classifierRunOnceAfterToolCount',
  );
  const classifierRunAfterToolFailures = nonNegative(
    raw.classifierRunAfterToolFailures,
    'classifierRunAfterToolFailures',
  );
  const classifierInterval = nonNegative(raw.classifierInterval, 'classifierInterval');
  const defaultContextThresholdPercent = percent(
    raw.defaultContextThresholdPercent,
    'defaultContextThresholdPercent',
  );
  let contextThresholdPercentOverrides: Record<string, number> | undefined;
  if (isObjectRecord(raw.contextThresholdPercentOverrides)) {
    contextThresholdPercentOverrides = {};
    for (const [ref, value] of Object.entries(raw.contextThresholdPercentOverrides)) {
      const parsed = percent(value, `contextThresholdPercentOverrides["${ref}"]`);
      if (parsed !== undefined) contextThresholdPercentOverrides[ref] = parsed;
    }
    if (Object.keys(contextThresholdPercentOverrides).length === 0) {
      contextThresholdPercentOverrides = undefined;
    }
  }

  const cooldowns = normalizeCooldowns(
    (raw as { cooldowns?: unknown }).cooldowns,
    warnings,
  );

  const poolOrder = normalizePoolOrder(
    (raw as { poolOrder?: unknown }).poolOrder,
    'poolOrder',
    warnings,
  );

  const morphTools = normalizeMorphTools(
    (raw as { morphTools?: unknown }).morphTools,
    warnings,
  );

  return {
    config: {
      debug: typeof raw.debug === 'boolean' ? raw.debug : false,
      cooldowns,
      morphTools,
      classifierModel,
      classifierModels: classifierModels.length > 0 ? classifierModels : undefined,
      compactionModels: compactionModels.length > 0 ? compactionModels : undefined,
      classifierRunOnceAfterToolCount,
      classifierRunAfterToolFailures,
      classifierInterval,
      defaultContextThresholdPercent,
      contextThresholdPercentOverrides,
      phaseBias,
      maxSessionBudget,
      firstTurn: normalizeForcedRoute(
        raw.firstTurn,
        'firstTurn',
        warnings,
        hasModels ? normalizedModels : undefined,
      ),
      classifierUltra: normalizeForcedRoute(
        raw.classifierUltra,
        'classifierUltra',
        warnings,
        hasModels ? normalizedModels : undefined,
      ),
      ultraCooldownMinutes: nonNegative(raw.ultraCooldownMinutes, 'ultraCooldownMinutes'),
      classifierComplexityThresholds: normalizeComplexityThresholds(
        raw.classifierComplexityThresholds,
        warnings,
      ),
      disabledProviders: normalizeDisabledProviders(raw.disabledProviders, warnings),
      rules: rules.length > 0 ? rules : undefined,
      profiles: normalizedProfiles,
      models: hasModels ? normalizedModels : undefined,
      poolOrder,
    },
    warnings,
  };
};
