import { streamSimple } from '@earendil-works/pi-ai/compat';
import type { Context } from '@earendil-works/pi-ai';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { RouterPhase } from '../types';
import { DEFAULT_COMPLEXITY_THRESHOLDS } from '../config';
import { parseCanonicalModelRef } from '../shared/model-ref';
import { buildClassifierPrompt } from './classifier-prompt';
import { parseClassifierResponse } from './classifier-parse';
import type { ClassifierResult, ClassifierRunOptions } from './types';

export const runClassifier = async (
  classifierModelRef: string,
  modelRegistry: ExtensionContext['modelRegistry'],
  context: Context,
  currentPhase: RouterPhase | undefined,
  thinking: ThinkingLevel | undefined,
  options: ClassifierRunOptions,
): Promise<ClassifierResult | undefined> => {
  try {
    const { provider, modelId } = parseCanonicalModelRef(classifierModelRef);
    const model = modelRegistry.find(provider, modelId);
    if (!model) return undefined;

    const auth = await modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) return undefined;
    const apiKey = auth.apiKey;
    const headers = auth.headers;

    const classifierPrompt = buildClassifierPrompt(
      context,
      currentPhase,
      options,
    );

    const classifierContext: Context = {
      ...context,
      messages: [{ role: 'user', content: classifierPrompt, timestamp: Date.now() }],
    };

    const reasoningOption =
      model.reasoning && thinking && thinking !== 'off'
        ? thinking
        : undefined;

    const stream = streamSimple(model, classifierContext, {
      apiKey,
      headers,
      ...(reasoningOption ? { reasoning: reasoningOption } : {}),
    });
    let fullText = '';
    for await (const event of stream) {
      if (
        event.type === 'text_delta' &&
        typeof (event as any).delta === 'string'
      ) {
        fullText += (event as any).delta;
      }
    }

    return parseClassifierResponse(
      fullText,
      options.thresholds ?? DEFAULT_COMPLEXITY_THRESHOLDS,
      options.allowUltra,
    );
  } catch (error) {
    // Ignore classifier errors and fall back to heuristics
  }
  return undefined;
};
