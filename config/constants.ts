import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { ComplexityThresholds } from '../types';
import { invariant } from '../invariants';

export const ROUTER_TIERS = ['high', 'medium', 'low'] as const;

export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];
export const ROUTER_PIN_VALUES = ['auto', 'high', 'medium', 'low'] as const;

export const DEFAULT_THINKING_LEVELS: readonly ThinkingLevel[] = ['high', 'medium', 'low'] as const;

// Frozen: normalizeComplexityThresholds returns this object BY REFERENCE on
// every fallback path, so one careless mutation by a caller would corrupt the
// default for every later config load in the process.
export const DEFAULT_COMPLEXITY_THRESHOLDS: ComplexityThresholds = Object.freeze(
  {
    medium: 4,
    high: 7,
    ultra: 9,
  },
);

invariant(
  DEFAULT_COMPLEXITY_THRESHOLDS.medium >= 2 &&
    DEFAULT_COMPLEXITY_THRESHOLDS.medium < DEFAULT_COMPLEXITY_THRESHOLDS.high &&
    DEFAULT_COMPLEXITY_THRESHOLDS.high < DEFAULT_COMPLEXITY_THRESHOLDS.ultra &&
    DEFAULT_COMPLEXITY_THRESHOLDS.ultra <= 10,
  'DEFAULT_COMPLEXITY_THRESHOLDS violates 2 <= medium < high < ultra <= 10',
);

// The router has exactly three tiers. `ultra` is a forced-route signal, never
// a tier — adding it here would silently break tier resolution everywhere.
invariant(
  !(ROUTER_TIERS as readonly string[]).includes('ultra'),
  "ROUTER_TIERS must not contain 'ultra'",
);
