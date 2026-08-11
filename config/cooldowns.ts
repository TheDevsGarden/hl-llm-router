import type { CooldownRule, CooldownSettings } from '../types';
import { isObjectRecord } from './guards';
import { parseDuration } from '../cooldown';

const COOLDOWN_WINDOW_KEYS = ['rateLimit', 'quota', 'auth', 'server'] as const;

/**
 * Normalize the `cooldowns` block. Durations accept "5h"/"90s"/ms numbers and
 * are stored as milliseconds; anything unparseable warns and falls back to the
 * built-in defaults rather than disabling the feature.
 */
export const normalizeCooldowns = (
  raw: unknown,
  warnings: string[],
): CooldownSettings | undefined => {
  if (raw === undefined) return undefined;
  if (!isObjectRecord(raw)) {
    warnings.push('Ignored "cooldowns": expected an object.');
    return undefined;
  }

  const readRule = (
    value: unknown,
    label: string,
  ): Partial<CooldownRule> | undefined => {
    if (!isObjectRecord(value)) {
      warnings.push(`Ignored ${label}: expected an object.`);
      return undefined;
    }
    const rule: Partial<CooldownRule> = {};
    for (const key of COOLDOWN_WINDOW_KEYS) {
      if (value[key] === undefined) continue;
      const ms = parseDuration(value[key]);
      if (ms === undefined) {
        warnings.push(
          `${label}.${key} is not a valid duration ("5h", "90s", or milliseconds). Ignored.`,
        );
        continue;
      }
      rule[key] = ms;
    }
    if (value.scope !== undefined) {
      if (value.scope === 'provider' || value.scope === 'model') {
        rule.scope = value.scope;
      } else {
        warnings.push(`${label}.scope must be "provider" or "model". Ignored.`);
      }
    }
    return rule;
  };

  const defaults = raw.defaults === undefined
    ? {}
    : (readRule(raw.defaults, 'cooldowns.defaults') ?? {});

  const providers: Record<string, Partial<CooldownRule>> = {};
  if (isObjectRecord(raw.providers)) {
    for (const [name, value] of Object.entries(raw.providers)) {
      const rule = readRule(value, `cooldowns.providers["${name}"]`);
      if (rule) providers[name] = rule;
    }
  } else if (raw.providers !== undefined) {
    warnings.push('Ignored "cooldowns.providers": expected an object.');
  }

  return {
    enabled: raw.enabled === undefined ? true : raw.enabled === true,
    defaults,
    providers,
  };
};
