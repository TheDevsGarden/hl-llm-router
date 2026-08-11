/** Keyword lists driving the heuristic router. Extracted from decideRouting. */

export const EXPLICIT_HIGH_HINTS: readonly string[] = [
  'think hard',
  'highest quality',
  'ultrathink',
];

export const EXPLICIT_LOW_HINTS: readonly string[] = [
  'fast',
  'cheap',
  'quick',
  'quickly',
  'brief',
  'briefly',
  'one sentence',
  'one line',
  'tiny',
  'small',
];

export const PLANNING_KEYWORDS: readonly string[] = [
  'plan',
  'planning',
  'architecture',
  'architect',
  'design',
  'tradeoff',
  'trade-off',
  'research',
  'investigate',
  'root cause',
  'analyze',
  'analysis',
  'migration',
  'strategy',
  'compare',
  'options',
  'approach',
];

export const SUMMARY_KEYWORDS: readonly string[] = [
  'summarize',
  'summary',
  'changelog',
  'rewrite',
  'reformat',
  'format',
  'rename',
  'explain briefly',
  'recap',
  'tl;dr',
];

export const IMPLEMENTATION_KEYWORDS: readonly string[] = [
  'implement',
  'code',
  'fix',
  'update',
  'edit',
  'write',
  'refactor',
  'add tests',
  'patch',
  'change',
  'apply',
  'continue',
  'resume',
  'make the changes',
  'go ahead',
];

export const LOOKUP_KEYWORDS: readonly string[] = [
  'where is',
  'which file',
  'show me',
  'list',
  'what files',
  'find',
  'grep',
];
