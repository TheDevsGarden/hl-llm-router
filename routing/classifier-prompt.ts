import type { Context } from '@earendil-works/pi-ai';
import type { RouterPhase } from '../types';
import { DEFAULT_COMPLEXITY_THRESHOLDS } from '../config';
import type { ClassifierGateTrigger } from '../gating';
import { getLastUserText, getRecentConversationText } from './extract';
import {
  MIN_COMPLEXITY_SCORE,
  MAX_COMPLEXITY_SCORE,
  type ClassifierRunOptions,
} from './types';

const TRIGGER_NOTES: Record<ClassifierGateTrigger, string> = {
  'new-user-turn': 'This is a new user turn.',
  'fresh-feedback':
    'You are re-scoring mid-turn: the first tool results just came back, so the real shape of the work is now visible.',
  'tool-failures': 'You are re-scoring mid-turn after tool calls failed.',
  interval:
    'You are re-scoring mid-turn: this run has taken many tool calls already.',
  reuse: 'You are re-scoring mid-turn.',
};

/**
 * T14: asks for a 1-10 complexity score instead of a tier label. Kept short on
 * purpose — this runs on small fast models where format reliability matters
 * more than eloquence.
 */
export const buildClassifierPrompt = (
  context: Context,
  currentPhase: RouterPhase | undefined,
  options: ClassifierRunOptions,
): string => {
  const thresholds = options.thresholds ?? DEFAULT_COMPLEXITY_THRESHOLDS;
  const promptText = getLastUserText(context);
  const historyText = getRecentConversationText(context, 4);

  const highBandEnd = options.allowUltra
    ? thresholds.ultra - 1
    : MAX_COMPLEXITY_SCORE;
  const bands = [
    `- ${MIN_COMPLEXITY_SCORE}-${thresholds.medium - 1}: summaries, changelogs, formatting, quick explanations, small bounded transforms, simple read-only lookups.`,
    `- ${thresholds.medium}-${thresholds.high - 1}: implementing a known plan, multi-file edits, normal coding work, focused debugging, tests and fixes.`,
    `- ${thresholds.high}-${highBandEnd}: architecture, design, tradeoff analysis, broad debugging, large refactors, codebase research.`,
    ...(options.allowUltra
      ? [
          `- ${thresholds.ultra}-${MAX_COMPLEXITY_SCORE}: the hardest planning work — novel design, cross-cutting or repeatedly-failed debugging, decisions that are expensive to get wrong.`,
        ]
      : []),
  ].join('\n');

  const failureNote =
    options.trigger === 'tool-failures' || options.consecutiveFailures > 0
      ? ` ${options.consecutiveFailures} tool call(s) in a row have failed; repeated failures are evidence the current model is struggling and may justify a higher score.`
      : '';
  const triggerNote = `${TRIGGER_NOTES[options.trigger]}${failureNote}`;

  const ruleNote = options.ruleContext
    ? `A keyword rule already routed this turn: ${options.ruleContext}. Score the request on its own merits — you may override that route.\n`
    : '';

  const phaseNote = currentPhase
    ? `Current conversation phase: ${currentPhase}\n`
    : '';
  const phaseBias =
    currentPhase === 'planning'
      ? `Consider that the conversation is currently in a planning phase. Bias toward ${thresholds.high} or above unless the request is clearly a simple implementation or summary.\n`
      : currentPhase === 'implementation'
        ? `Consider that the conversation is currently in an implementation phase. Bias toward the ${thresholds.medium}-${thresholds.high - 1} band unless the request is clearly planning or a simple summary.\n`
        : '';

  return `You are a model router. Score how much reasoning capability the user's latest request needs, as an integer from ${MIN_COMPLEXITY_SCORE} to ${MAX_COMPLEXITY_SCORE}.

Scale:
${bands}

${triggerNote}
${ruleNote}${phaseNote}
Recent history:
${historyText}

Latest user message:
${promptText}

${phaseBias}Answer in exactly two lines, nothing else:
Complexity: [${MIN_COMPLEXITY_SCORE}-${MAX_COMPLEXITY_SCORE}]
Reasoning: [one short sentence]`;
};
