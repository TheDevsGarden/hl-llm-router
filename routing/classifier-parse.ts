import type { ComplexityThresholds } from '../types';
import { isRouterTier } from '../config';
import { invariant } from '../invariants';
import {
  MIN_COMPLEXITY_SCORE,
  MAX_COMPLEXITY_SCORE,
  type ClassifierResult,
  type ClassifierVerdict,
} from './types';
import { verdictForScore } from './tier';

/**
 * Small models wrap answers in markdown. Decoration is stripped only at the
 * edges, so identifiers inside the reasoning text survive intact.
 */
const stripDecoration = (line: string): string =>
  line.replace(/^[\s>#*_`-]+/, '').replace(/[\s*_`]+$/, '');

const findLabelledLine = (
  lines: readonly string[],
  label: string,
): string | undefined =>
  lines.find((line) => line.toLowerCase().startsWith(label));

/** Everything after the first colon, so reasoning text may contain colons. */
const valueAfterLabel = (line: string): string =>
  stripDecoration(line.slice(line.indexOf(':') + 1));

const clampScore = (value: number): number =>
  Math.min(
    MAX_COMPLEXITY_SCORE,
    Math.max(MIN_COMPLEXITY_SCORE, Math.round(value)),
  );

/**
 * T14: parses the complexity answer, falling back to the legacy `Tier:` shape
 * so an older/confused classifier still produces a usable verdict.
 */
export const parseClassifierResponse = (
  text: string,
  thresholds: ComplexityThresholds,
  allowUltra: boolean,
): ClassifierResult | undefined => {
  const lines = text
    .trim()
    .split('\n')
    .map(stripDecoration)
    .filter(Boolean);

  const reasoningLine = findLabelledLine(lines, 'reasoning:');
  const reasoning = reasoningLine
    ? valueAfterLabel(reasoningLine)
    : 'Classifier decision.';

  const complexityLine = findLabelledLine(lines, 'complexity');
  if (complexityLine) {
    // Read the number from the raw post-colon text: stripDecoration() treats a
    // leading "-" as a markdown bullet, so a malformed "Complexity: -9" would
    // otherwise parse as 9 and escalate straight to the ultra route.
    const match = complexityLine
      .slice(complexityLine.indexOf(':') + 1)
      .match(/-?\d+(?:\.\d+)?/);
    if (match) {
      const parsed = Number(match[0]);
      if (Number.isFinite(parsed)) {
        const score = clampScore(parsed);
        // Guards the class of bug where decoration stripping ate a minus sign
        // and a malformed "Complexity: -9" was read as 9, escalating to ultra.
        invariant(
          Number.isInteger(score) &&
            score >= MIN_COMPLEXITY_SCORE &&
            score <= MAX_COMPLEXITY_SCORE,
          `classifier score out of domain: ${score} (raw ${match[0]})`,
        );
        return {
          tier: verdictForScore(score, thresholds, allowUltra),
          reasoning,
          score,
        };
      }
    }
  }

  const tierLine = findLabelledLine(lines, 'tier:');
  if (tierLine) {
    const tierValue = valueAfterLabel(tierLine).toLowerCase();
    if (isRouterTier(tierValue)) {
      return { tier: tierValue as ClassifierVerdict, reasoning };
    }
  }

  return undefined;
};
