import { readFileSync } from 'node:fs';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import type {
  PoolName,
  PoolCandidate,
  PoolClassification,
  RouterConfig,
  RouterProfile,
  RouterTier,
  FreeModelScore,
} from '../types';
import { invariant } from '../invariants';

/** Subscription providers — these are paid subscriptions, not free or metered. */
const SUBS_PROVIDER_SET = new Set([
  'opencode-go',
  'opencode-go-anthropic',
  'ollama',
  'mimo-token-plan',
  'minimax',
]);

/** Compute a single numeric quality score for sorting.
 *  Priority: aaIndex > mmlu > mmluPro > swebench > 0.
 *  Returns 0 for unknown models (they sort last). */
export const qualityScore = (
  canonicalId: string,
  scores: Readonly<Record<string, FreeModelScore>>,
): number => {
  const s = scores[canonicalId];
  if (!s) return 0;
  return s.aaIndex ?? s.mmlu ?? s.mmluPro ?? s.swebench ?? 0;
};

/** Read models.json from disk. Returns the raw providers structure.
 *  Never throws — returns empty object on any error. */
const readModelsJson = (): Record<string, {
  models?: Array<{
    id: string;
    contextWindow?: number;
    cost?: { input?: number };
  }>;
}> => {
  try {
    const path = `${getAgentDir()}/models.json`;
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as { providers?: unknown };
    if (typeof parsed.providers !== 'object' || parsed.providers === null) return {};
    return parsed.providers as Record<string, {
      models?: Array<{
        id: string;
        contextWindow?: number;
        cost?: { input?: number };
      }>;
    }>;
  } catch {
    return {};
  }
};

/** Classify every model in models.json into exactly one pool.
 *  Reads models.json directly (config.models is a normalized alias map, not
 *  the raw provider structure with cost data).
 *  Invariant: free.length + subs.length + metered.length === total non-disabled models. */
export const classifyPools = (
  config: RouterConfig,
  freeCache: ReadonlySet<string>,
  scores: Readonly<Record<string, FreeModelScore>>,
): PoolClassification => {
  const providers = readModelsJson();
  const free: PoolCandidate[] = [];
  const subs: PoolCandidate[] = [];
  const metered: PoolCandidate[] = [];

  const disabledSet = new Set(config.disabledProviders ?? []);

  let expectedTotal = 0;
  for (const [providerName, provider] of Object.entries(providers)) {
    if (!Array.isArray(provider.models)) continue;
    if (disabledSet.has(providerName)) continue;
    expectedTotal += provider.models.length;

    for (const model of provider.models) {
      const canonicalId = `${providerName}/${model.id}`;
      const costInput = model.cost?.input ?? 99;
      const ctxWindow = model.contextWindow ?? 0;
      const score = qualityScore(canonicalId, scores);

      // Subscription membership is checked FIRST and deliberately.
      // Plan-billed providers (ollama, mimo-token-plan, ...) publish
      // cost.input: 0 because usage is drawn from a prepaid plan, not because
      // the model is free. Testing cost first put all 28 ollama models in the
      // free pool, so the "free-first" profile drained a paid plan believing
      // it was free. Zero cost only means free when the provider is not a
      // subscription.
      const pool: PoolName = SUBS_PROVIDER_SET.has(providerName)
        ? 'subs'
        : costInput === 0 || freeCache.has(canonicalId)
          ? 'free'
          : 'metered';

      const candidate: PoolCandidate = {
        canonicalId,
        pool,
        contextWindow: ctxWindow,
        qualityScore: score,
      };

      if (pool === 'free') free.push(candidate);
      else if (pool === 'subs') subs.push(candidate);
      else metered.push(candidate);
    }
  }

  const total = free.length + subs.length + metered.length;
  invariant(
    total === expectedTotal,
    `pool classification lost models: got ${total}, expected ${expectedTotal}`,
  );

  return { free, subs, metered, total };
};

/** Sort pool candidates by quality score descending, then context window descending.
 *  Pure function — does not mutate input. */
export const sortByQuality = (
  candidates: readonly PoolCandidate[],
): readonly PoolCandidate[] =>
  [...candidates].sort((a, b) => {
    if (b.qualityScore !== a.qualityScore) {
      return b.qualityScore - a.qualityScore;
    }
    return b.contextWindow - a.contextWindow;
  });

/** Upper bound on a pool-derived chain.
 *  invariants.ts documents the routing path as "O(n) over a chain of <= ~20
 *  refs"; an unbounded pool chain is every model in models.json (~146) and
 *  breaks that assumption. Candidates are quality-sorted, so the tail is the
 *  weakest models anyway — if the top 20 all fail, the 21st will not save the
 *  turn. */
const MAX_POOL_CANDIDATES = 20;

/** Build the full candidate chain for a routing decision.
 *  1. If profile[tier].fallbacks is non-empty -> [primary, ...fallbacks] (curated mode)
 *  2. Otherwise -> [primary, ...sorted pool candidates per poolOrder] (pool mode)
 *  Always deduped. Primary model always first. */
export const deriveCandidates = (
  decision: { targetLabel: string; tier: RouterTier },
  profile: RouterProfile,
  classification: PoolClassification,
  poolOrder: readonly PoolName[],
  /**
   * Optional cooling test. Cooling candidates are deferred to the end of the
   * chain rather than dropped, which is what makes "exhaust free, then subs"
   * real: while free models are healthy they fill the 20 slots, but as quota
   * failures cool them they stop consuming slots and the next pool moves up.
   * Without this the free pool (35 models) would always fill the cap and
   * free-first could never reach subs.
   */
  isCooling?: (canonicalId: string) => boolean,
): string[] => {
  const tierConfig = profile[decision.tier];

  // Curated mode: explicit fallbacks override pool derivation
  if (tierConfig?.fallbacks && tierConfig.fallbacks.length > 0) {
    return [decision.targetLabel, ...tierConfig.fallbacks];
  }

  // Pool mode: derive from pool membership
  const poolMap: Record<PoolName, readonly PoolCandidate[]> = {
    free: classification.free,
    subs: classification.subs,
    metered: classification.metered,
  };

  const candidates: string[] = [decision.targetLabel];
  const seen = new Set<string>([decision.targetLabel]);

  const deferred: string[] = [];

  for (const poolName of poolOrder) {
    const sorted = sortByQuality(poolMap[poolName]);
    for (const candidate of sorted) {
      if (candidates.length >= MAX_POOL_CANDIDATES) break;
      if (seen.has(candidate.canonicalId)) continue;
      if (isCooling?.(candidate.canonicalId)) {
        deferred.push(candidate.canonicalId);
        continue;
      }
      seen.add(candidate.canonicalId);
      candidates.push(candidate.canonicalId);
    }
    if (candidates.length >= MAX_POOL_CANDIDATES) break;
  }

  // Backfill with cooling candidates so a fully-cooled ladder still produces a
  // chain — a stale cooldown must never starve the turn down to the primary.
  for (const ref of deferred) {
    if (candidates.length >= MAX_POOL_CANDIDATES) break;
    if (seen.has(ref)) continue;
    seen.add(ref);
    candidates.push(ref);
  }

  // Invariant: every candidate came from pool classification (i.e. exists
  // in models.json). The primary model is NOT validated here — it comes
  // from decideRouting which already resolved it.
  const allPoolIds = new Set([
    ...classification.free.map(c => c.canonicalId),
    ...classification.subs.map(c => c.canonicalId),
    ...classification.metered.map(c => c.canonicalId),
  ]);
  for (let i = 1; i < candidates.length; i++) {
    invariant(
      allPoolIds.has(candidates[i]),
      `candidate ${candidates[i]} not in any pool`,
    );
  }

  return candidates;
};
