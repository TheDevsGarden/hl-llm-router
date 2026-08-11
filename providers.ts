import type {
  RouterConfig,
  RouterProfile,
  RouterTier,
  ProviderInfo,
  ProviderUsage,
} from './types';
import { ROUTER_TIERS } from './config';
import { invariant } from './invariants';

/**
 * T15: provider enable/disable support. Pure helpers only — no IO, no state.
 * A "provider" is the first path segment of a canonical model ref
 * ("opencode-go/glm-5.2" -> "opencode-go"). Refs here are already validated
 * by config normalization, so an unparsable ref simply yields no provider.
 */

export const providerOf = (modelRef: string): string | undefined => {
  const slashIndex = modelRef.indexOf('/');
  if (slashIndex <= 0) return undefined;
  return modelRef.slice(0, slashIndex).trim() || undefined;
};

export const toDisabledSet = (config: RouterConfig): ReadonlySet<string> =>
  new Set(config.disabledProviders ?? []);

export const isProviderDisabled = (
  modelRef: string,
  disabled: ReadonlySet<string>,
): boolean => {
  if (disabled.size === 0) return false;
  const provider = providerOf(modelRef);
  return provider !== undefined && disabled.has(provider);
};

export const filterDisabledRefs = (
  refs: string[],
  disabled: ReadonlySet<string>,
): { kept: string[]; dropped: string[] } => {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const ref of refs) {
    (isProviderDisabled(ref, disabled) ? dropped : kept).push(ref);
  }
  return { kept, dropped };
};

/** Every canonical ref a tier would try, primary first. */
export const tierChainRefs = (
  profile: RouterProfile,
  tier: RouterTier,
): string[] => {
  const tierConfig = profile[tier];
  if (!tierConfig) return [];
  return [tierConfig.model, ...(tierConfig.fallbacks ?? [])];
};

/**
 * Option A degrade: when the routed tier's whole chain is provider-disabled,
 * walk the other tiers in resolveAvailableTier order (up first, then down)
 * and return the first tier whose chain survives filtering. undefined means
 * no tier anywhere survives — callers must fail LOUD, never silently.
 */
export const degradeAcrossTiers = (
  profile: RouterProfile,
  preferred: RouterTier,
  disabled: ReadonlySet<string>,
): { tier: RouterTier; kept: string[] } | undefined => {
  const order: RouterTier[] = ['low', 'medium', 'high'];
  const startIdx = order.indexOf(preferred);
  const candidates: RouterTier[] = [
    preferred,
    ...order.slice(startIdx + 1),
    ...order.slice(0, startIdx).reverse(),
  ];
  for (const tier of candidates) {
    const { kept } = filterDisabledRefs(tierChainRefs(profile, tier), disabled);
    if (kept.length > 0) {
      invariant(
        !kept.some((ref) => isProviderDisabled(ref, disabled)),
        `degradeAcrossTiers returned a disabled ref for ${tier}: ${kept.join(', ')}`,
      );
      return { tier, kept };
    }
  }
  return undefined;
};

const pushUsage = (
  map: Map<string, ProviderUsage[]>,
  ref: string | undefined,
  where: string,
): void => {
  if (!ref) return;
  const provider = providerOf(ref);
  if (!provider) return;
  const usages = map.get(provider) ?? [];
  usages.push({ ref, where });
  map.set(provider, usages);
};

/**
 * Inventory of every provider referenced anywhere in the config, for
 * /router provider list. Disabled providers with zero references still
 * appear (so a stale disable is visible and clearable).
 */
export const collectProviders = (config: RouterConfig): ProviderInfo[] => {
  const usagesByProvider = new Map<string, ProviderUsage[]>();

  for (const [profileName, profile] of Object.entries(config.profiles)) {
    for (const tier of ROUTER_TIERS) {
      const tierConfig = profile[tier];
      if (!tierConfig) continue;
      pushUsage(usagesByProvider, tierConfig.model, `profile ${profileName}/${tier}`);
      for (const fallback of tierConfig.fallbacks ?? []) {
        pushUsage(usagesByProvider, fallback, `fallback ${profileName}/${tier}`);
      }
    }
  }

  const classifierList =
    config.classifierModels ??
    (config.classifierModel ? [config.classifierModel] : []);
  for (const classifier of classifierList) {
    pushUsage(usagesByProvider, classifier.model, 'classifier');
  }
  pushUsage(usagesByProvider, config.firstTurn?.model, 'firstTurn');
  pushUsage(usagesByProvider, config.classifierUltra?.model, 'ultra');
  for (const rule of config.rules ?? []) {
    if (!rule.model) continue;
    const matches = Array.isArray(rule.matches) ? rule.matches : [rule.matches];
    pushUsage(usagesByProvider, rule.model, `rule ${matches[0]}`);
  }

  const disabled = toDisabledSet(config);
  for (const name of disabled) {
    if (!usagesByProvider.has(name)) usagesByProvider.set(name, []);
  }

  return [...usagesByProvider.entries()]
    .map(([name, usages]) => ({ name, enabled: !disabled.has(name), usages }))
    .sort((a, b) => a.name.localeCompare(b.name));
};
