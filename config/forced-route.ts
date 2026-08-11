import type {
  ForcedRouteConfig,
  ModelDefinition,
  ComplexityThresholds,
} from '../types';
import { isObjectRecord, isThinkingLevel } from './guards';
import { resolveModelRef } from './parse-file';
import { parseCanonicalModelRef } from '../shared/model-ref';
import { DEFAULT_COMPLEXITY_THRESHOLDS } from './constants';
import { invariant } from '../invariants';

/**
 * T13: validate a forced-route block ({ model, thinking }) used by
 * `firstTurn` and `classifierUltra`. Resolves model aliases. Returns
 * undefined (feature off) when the block is absent or invalid.
 */
export const normalizeForcedRoute = (
  raw: unknown,
  fieldName: string,
  warnings: string[],
  models?: Record<string, ModelDefinition>,
): ForcedRouteConfig | undefined => {
  if (raw === undefined) return undefined;
  if (!isObjectRecord(raw)) {
    warnings.push(`Ignored ${fieldName}: expected an object with a "model" field.`);
    return undefined;
  }
  const rawModel = typeof raw.model === 'string' ? raw.model.trim() : '';
  if (!rawModel) {
    warnings.push(`${fieldName} is missing the "model" field. Ignored.`);
    return undefined;
  }
  const resolved = resolveModelRef(rawModel, models);
  try {
    parseCanonicalModelRef(resolved.canonicalRef);
  } catch (error) {
    warnings.push(`${fieldName}: ${error instanceof Error ? error.message : String(error)} Ignored.`);
    return undefined;
  }
  const thinking = isThinkingLevel(raw.thinking) ? raw.thinking : undefined;
  if (raw.thinking !== undefined && !thinking) {
    warnings.push(`${fieldName} has invalid thinking level "${String(raw.thinking)}". Ignored.`);
  }
  return { model: resolved.canonicalRef, thinking };
};

/**
 * T14: validate the complexity score boundaries. Each must be 1-10 and
 * strictly ascending; anything else falls back to the defaults so a typo
 * cannot silently collapse the ladder onto one tier.
 */
export const normalizeComplexityThresholds = (
  raw: unknown,
  warnings: string[],
): ComplexityThresholds => {
  if (raw === undefined) return DEFAULT_COMPLEXITY_THRESHOLDS;
  if (!isObjectRecord(raw)) {
    warnings.push('classifierComplexityThresholds must be an object. Using defaults.');
    return DEFAULT_COMPLEXITY_THRESHOLDS;
  }
  const read = (key: keyof ComplexityThresholds): number | undefined => {
    const value = raw[key];
    if (value === undefined) return DEFAULT_COMPLEXITY_THRESHOLDS[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 10) {
      return value;
    }
    warnings.push(`classifierComplexityThresholds.${key} must be a number in [1, 10]. Using defaults.`);
    return undefined;
  };
  const medium = read('medium');
  const high = read('high');
  const ultra = read('ultra');
  if (medium === undefined || high === undefined || ultra === undefined) {
    return DEFAULT_COMPLEXITY_THRESHOLDS;
  }
  // medium >= 2 keeps the prompt's low band "1-(medium-1)" non-empty;
  // strict high < ultra keeps the high band non-empty when ultra is enabled.
  if (medium >= 2 && medium < high && high < ultra) {
    invariant(
      ultra <= 10,
      `thresholds out of range: ${JSON.stringify({ medium, high, ultra })}`,
    );
  }
  if (!(medium >= 2 && medium < high && high < ultra)) {
    warnings.push('classifierComplexityThresholds must satisfy 2 <= medium < high < ultra <= 10. Using defaults.');
    return DEFAULT_COMPLEXITY_THRESHOLDS;
  }
  return { medium, high, ultra };
};
