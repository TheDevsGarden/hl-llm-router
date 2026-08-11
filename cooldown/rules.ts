import type { CooldownRule } from '../types';

export const DEFAULT_COOLDOWN_RULE: Required<CooldownRule> = {
  rateLimit: 60_000, // per-minute limits recover fast
  quota: 3_600_000, // plan/daily caps: back off an hour unless configured
  auth: 900_000,
  server: 300_000,
  scope: 'model',
};

export const resolveRule = (
  provider: string,
  defaults: Partial<CooldownRule> | undefined,
  perProvider: Record<string, Partial<CooldownRule>> | undefined,
): Required<CooldownRule> => ({
  ...DEFAULT_COOLDOWN_RULE,
  ...(defaults ?? {}),
  ...(perProvider?.[provider] ?? {}),
});
