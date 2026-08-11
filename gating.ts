// T11 (clean-room): classifier gating triggers and context-threshold escalation.
// Behavior derived from kdejaeger/pi-model-router's public README documentation only —
// no code from that (unlicensed) repository. Pure functions; no IO.
import type { Context } from '@earendil-works/pi-ai';
import type { RouterTier } from './types';
import { estimateTokensFromChars } from './shared/tokens';

export type ClassifierGateTrigger =
  | 'new-user-turn'
  | 'fresh-feedback'
  | 'tool-failures'
  | 'interval'
  | 'reuse';

export interface ClassifierGateResult {
  run: boolean;
  trigger: ClassifierGateTrigger;
}

export interface GatingSettings {
  runOnceAfterToolCount: number; // 0 disables
  runAfterToolFailures: number; // 0 disables
  interval: number; // 0 disables
}

export const toolContinuationCount = (context: Context): number => {
  let count = 0;
  for (let i = context.messages.length - 1; i >= 0; i--) {
    const role = context.messages[i]?.role;
    if (role === 'user') break;
    if (role === 'toolResult') count++;
  }
  return count;
};

export const consecutiveToolFailures = (context: Context): number => {
  let count = 0;
  for (let i = context.messages.length - 1; i >= 0; i--) {
    const message = context.messages[i] as { role?: string; isError?: boolean };
    if (message?.role === 'user') break;
    if (message?.role !== 'toolResult') continue;
    if (message.isError) count++;
    else break;
  }
  return count;
};

export const shouldRunClassifier = (
  context: Context,
  settings: GatingSettings,
): ClassifierGateResult => {
  const last = context.messages[context.messages.length - 1];
  if (last?.role !== 'toolResult') {
    return { run: true, trigger: 'new-user-turn' };
  }
  const cont = toolContinuationCount(context);
  if (settings.runOnceAfterToolCount > 0 && cont === settings.runOnceAfterToolCount) {
    return { run: true, trigger: 'fresh-feedback' };
  }
  if (
    settings.runAfterToolFailures > 0 &&
    consecutiveToolFailures(context) >= settings.runAfterToolFailures
  ) {
    return { run: true, trigger: 'tool-failures' };
  }
  if (settings.interval > 0 && cont > 0 && cont % settings.interval === 0) {
    return { run: true, trigger: 'interval' };
  }
  return { run: false, trigger: 'reuse' };
};

const TIER_ORDER: RouterTier[] = ['low', 'medium', 'high'];

// Text-length estimate of the full context (system prompt + message text parts).
// Cheaper and more accurate than JSON.stringify: no key/quote overhead, and the
// system prompt is included.
export const estimateContextChars = (context: Context): number => {
  let chars = (context as { systemPrompt?: string }).systemPrompt?.length ?? 0;
  for (const message of context.messages) {
    const content = (message as { content?: unknown }).content;
    if (typeof content === 'string') {
      chars += content.length;
    } else if (Array.isArray(content)) {
      for (const part of content) {
        const p = part as { text?: string; thinking?: string };
        if (typeof p.text === 'string') chars += p.text.length;
        if (typeof p.thinking === 'string') chars += p.thinking.length;
      }
    }
  }
  return chars;
};

export const contextEscalationTier = (
  currentTier: RouterTier,
  targetLabel: string,
  contextChars: number,
  windows: Partial<Record<RouterTier, number>>,
  defaultThresholdPercent: number | undefined,
  overrides: Record<string, number> | undefined,
): RouterTier | undefined => {
  const threshold = overrides?.[targetLabel] ?? defaultThresholdPercent;
  if (!threshold) return undefined; // feature off unless configured
  const tokens = estimateTokensFromChars(contextChars);
  const currentWindow = windows[currentTier];
  if (!currentWindow || tokens <= (currentWindow * threshold) / 100) return undefined;
  for (let i = TIER_ORDER.indexOf(currentTier) + 1; i < TIER_ORDER.length; i++) {
    const tier = TIER_ORDER[i];
    const window = windows[tier];
    if (window && tokens <= (window * threshold) / 100) return tier;
  }
  return undefined;
};
