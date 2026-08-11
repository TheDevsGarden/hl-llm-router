import type { ClassifierConfig, ModelDefinition } from '../types';
import { isObjectRecord, isThinkingLevel } from './guards';
import { resolveModelRef } from './parse-file';
import { parseCanonicalModelRef } from '../shared/model-ref';

/**
 * T15: validate the disabledProviders list. Non-strings and empty entries
 * are dropped with a warning; duplicates collapse. undefined = feature off.
 */
export const normalizeDisabledProviders = (
  raw: unknown,
  warnings: string[],
): string[] | undefined => {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    warnings.push('disabledProviders must be an array of provider names. Ignored.');
    return undefined;
  }
  const names = new Set<string>();
  for (const entry of raw) {
    const name = typeof entry === 'string' ? entry.trim() : '';
    if (!name) {
      warnings.push('disabledProviders entry is not a provider name. Ignored.');
      continue;
    }
    names.add(name);
  }
  return names.size > 0 ? [...names] : undefined;
};

export const normalizeModelChoiceList = (
  rawList: unknown,
  fieldName: string,
  warnings: string[],
  models: Record<string, ModelDefinition> | undefined,
): ClassifierConfig[] => {
  const result: ClassifierConfig[] = [];
  if (!Array.isArray(rawList)) {
    if (rawList !== undefined) {
      warnings.push(`${fieldName} must be an array of model refs. Ignored.`);
    }
    return result;
  }
  for (const entry of rawList) {
    const modelRef =
      typeof entry === 'string'
        ? entry.trim()
        : isObjectRecord(entry) && typeof entry.model === 'string'
          ? entry.model.trim()
          : '';
    if (!modelRef) {
      warnings.push(`${fieldName} entry is missing a model ref. Ignored.`);
      continue;
    }
    try {
      const resolved = resolveModelRef(modelRef, models);
      parseCanonicalModelRef(resolved.canonicalRef);
      const rawThinking = isObjectRecord(entry) ? entry.thinking : undefined;
      const thinking = isThinkingLevel(rawThinking) ? rawThinking : undefined;
      result.push({ model: resolved.canonicalRef, thinking });
    } catch (error) {
      warnings.push(
        `Invalid ${fieldName} entry: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return result;
};
