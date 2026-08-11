import type { RouterTier, RoutingRule } from '../types';
import { containsAny } from './extract';

/**
 * Find the highest-tier rule whose match list hits the prompt. Returns the
 * winning rule and its tier, or undefined when no rule matches. Ties resolve
 * to the highest tier (low < medium < high).
 */
export const matchRules = (
  prompt: string,
  rules: RoutingRule[] | undefined,
): { winningRule: RoutingRule; highestTier: RouterTier } | undefined => {
  if (!rules) return undefined;

  let highestTier: RouterTier | undefined;
  let winningRule: RoutingRule | undefined;
  const tierRank: Record<RouterTier, number> = {
    low: 1,
    medium: 2,
    high: 3,
  };

  for (const rule of rules) {
    const matches = Array.isArray(rule.matches) ? rule.matches : [rule.matches];
    const lowercaseMatches = matches.map((m) => m.toLowerCase());
    if (containsAny(prompt, lowercaseMatches)) {
      if (!highestTier || tierRank[rule.tier] > tierRank[highestTier]) {
        highestTier = rule.tier;
        winningRule = rule;
      }
    }
  }

  if (!winningRule || !highestTier) return undefined;
  return { winningRule, highestTier };
};
