import type { CooldownReason, CooldownRule } from '../types';

const DURATION_PATTERN = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i;

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Parse "5h" / "90s" / "250ms" / 60000 into milliseconds. */
export const parseDuration = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const match = DURATION_PATTERN.exec(value.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;
  const unit = (match[2] ?? 'ms').toLowerCase();
  return amount * (UNIT_MS[unit] ?? 1);
};

export const durationFor = (
  reason: CooldownReason,
  rule: Required<CooldownRule>,
): number => {
  if (reason === 'quota') return rule.quota;
  if (reason === 'rate-limit') return rule.rateLimit;
  if (reason === 'auth') return rule.auth;
  return rule.server;
};

export const formatRemaining = (ms: number): string => {
  if (ms <= 0) return '0s';
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

export { UNIT_MS };
