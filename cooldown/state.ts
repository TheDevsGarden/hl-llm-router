import type { CooldownEntry, CooldownReason, CooldownRule, CooldownState } from '../types';
import { durationFor } from './duration';
import { invariant } from '../invariants';

export const modelKey = (provider: string, modelId: string): string =>
  `${provider}/${modelId}`;

export const EMPTY_COOLDOWN_STATE: CooldownState = { entries: {} };

/**
 * The active cooldown covering this model, if any. Both the provider-wide key
 * and the model key are considered; the one expiring latest wins so a
 * provider-wide quota block is never masked by a shorter per-model entry.
 */
export const activeCooldown = (
  state: CooldownState,
  provider: string,
  modelId: string,
  now: number,
): CooldownEntry | undefined => {
  const candidates = [
    state.entries[provider],
    state.entries[modelKey(provider, modelId)],
  ].filter((entry): entry is CooldownEntry => !!entry && entry.until > now);
  if (candidates.length === 0) return undefined;
  return candidates.reduce((latest, entry) =>
    entry.until > latest.until ? entry : latest,
  );
};

export const markCooling = (
  state: CooldownState,
  params: {
    provider: string;
    modelId: string;
    reason: CooldownReason;
    rule: Required<CooldownRule>;
    now: number;
    /** Wait the provider itself advertised; overrides the configured window. */
    advertisedMs?: number;
  },
): CooldownState => {
  const configured = durationFor(params.reason, params.rule);
  const duration = params.advertisedMs ?? configured;
  if (duration <= 0) return state;

  const isProviderScope = params.rule.scope === 'provider';
  const key = isProviderScope
    ? params.provider
    : modelKey(params.provider, params.modelId);
  const entry: CooldownEntry = {
    key,
    scope: params.rule.scope,
    provider: params.provider,
    ...(isProviderScope ? {} : { model: params.modelId }),
    reason: params.reason,
    ...(params.advertisedMs === undefined ? {} : { advertised: true }),
    since: params.now,
    until: params.now + duration,
  };

  return { entries: { ...state.entries, [key]: entry } };
};

export const clearCooldowns = (): CooldownState => EMPTY_COOLDOWN_STATE;

export const pruneExpired = (
  state: CooldownState,
  now: number,
): CooldownState => {
  const entries = Object.entries(state.entries).filter(
    ([, entry]) => entry.until > now,
  );
  if (entries.length === Object.keys(state.entries).length) return state;
  return { entries: Object.fromEntries(entries) };
};

export const activeEntries = (
  state: CooldownState,
  now: number,
): CooldownEntry[] =>
  Object.values(state.entries)
    .filter((entry) => entry.until > now)
    .sort((a, b) => a.until - b.until);

/**
 * Split candidate model refs into those that are usable now and those cooling.
 * Order is preserved; cooling candidates are returned sorted by soonest expiry
 * so the caller can still pick the least-bad option when everything is cooling.
 */
export const partitionByCooldown = (
  candidates: readonly string[],
  state: CooldownState,
  now: number,
  parse: (ref: string) => { provider: string; modelId: string } | undefined,
): { available: string[]; cooling: string[] } => {
  const available: string[] = [];
  const cooling: { ref: string; until: number }[] = [];

  for (const ref of candidates) {
    const parsed = parse(ref);
    if (!parsed) {
      available.push(ref);
      continue;
    }
    const entry = activeCooldown(state, parsed.provider, parsed.modelId, now);
    if (entry) {
      cooling.push({ ref, until: entry.until });
    } else {
      available.push(ref);
    }
  }

  // Lossless partition: every candidate lands in exactly one bucket.
  // delegate/order.ts relies on this to never silently shorten the chain.
  invariant(
    available.length + cooling.length === candidates.length,
    `partitionByCooldown lost candidates: ${candidates.length} -> ${available.length + cooling.length}`,
  );

  return {
    available,
    cooling: cooling.sort((a, b) => a.until - b.until).map((item) => item.ref),
  };
};
