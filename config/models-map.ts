import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { ModelDefinition } from '../types';
import { isObjectRecord, isThinkingLevel } from './guards';
import { parseCanonicalModelRef } from '../shared/model-ref';

/**
 * Validate and normalize the models map from config.
 */
export const normalizeModelsMap = (
  raw: Record<string, unknown> | undefined,
  warnings: string[],
): Record<string, ModelDefinition> => {
  const result: Record<string, ModelDefinition> = {};
  if (!raw || !isObjectRecord(raw)) return result;

  for (const [alias, entry] of Object.entries(raw)) {
    if (!isObjectRecord(entry)) {
      warnings.push(`Ignored invalid model definition "${alias}": expected an object.`);
      continue;
    }

    const model = typeof entry.model === 'string' ? entry.model.trim() : '';
    if (!model) {
      warnings.push(`Model definition "${alias}" is missing the "model" field. Skipped.`);
      continue;
    }

    try {
      parseCanonicalModelRef(model);
    } catch (error) {
      warnings.push(
        `Model definition "${alias}": ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    const contextWindow =
      typeof entry.contextWindow === 'number' && entry.contextWindow > 0
        ? entry.contextWindow
        : undefined;
    if (entry.contextWindow !== undefined && !contextWindow) {
      warnings.push(
        `Model definition "${alias}" has invalid contextWindow. Ignored.`,
      );
    }

    const maxTokens =
      typeof entry.maxTokens === 'number' && entry.maxTokens > 0
        ? entry.maxTokens
        : undefined;
    if (entry.maxTokens !== undefined && !maxTokens) {
      warnings.push(
        `Model definition "${alias}" has invalid maxTokens. Ignored.`,
      );
    }

    const reasoning =
      typeof entry.reasoning === 'boolean' ? entry.reasoning : undefined;

    let thinkingLevels: ThinkingLevel[] | undefined;
    if (Array.isArray(entry.thinkingLevels)) {
      thinkingLevels = entry.thinkingLevels.filter(
        (l): l is ThinkingLevel => isThinkingLevel(l),
      );
      if (thinkingLevels.length === 0) thinkingLevels = undefined;
    }

    result[alias] = { model, contextWindow, maxTokens, reasoning, thinkingLevels };
  }

  return result;
};
