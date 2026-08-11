import type {
  RouterConfig,
  RouterProfile,
  RoutedTierConfig,
  ModelDefinition,
} from '../types';

const mergeTier = (
  existing?: RoutedTierConfig,
  next?: Partial<RoutedTierConfig>,
): RoutedTierConfig | undefined => {
  if (!existing && !next) return undefined;
  if (!next) return existing;
  if (!existing) return next as RoutedTierConfig;
  return { ...existing, ...next };
};

export const mergeConfig = (
  base: RouterConfig,
  override: Partial<RouterConfig>,
): RouterConfig => {
  const mergedProfiles: Record<string, RouterProfile> = { ...base.profiles };
  for (const [name, profile] of Object.entries(override.profiles ?? {})) {
    const existing = mergedProfiles[name];
    const nextProfile = profile as Partial<RouterProfile>;
    mergedProfiles[name] = {
      high: mergeTier(existing?.high, nextProfile.high),
      medium: mergeTier(existing?.medium, nextProfile.medium),
      low: mergeTier(existing?.low, nextProfile.low),
    };
  }

  const mergedModels: Record<string, ModelDefinition> = {
    ...(base.models ?? {}),
    ...(override.models ?? {}),
  };

  return {
    debug: override.debug ?? base.debug,
    cooldowns: override.cooldowns ?? base.cooldowns,
    classifierModel: override.classifierModel ?? base.classifierModel,
    classifierModels: override.classifierModels ?? base.classifierModels,
    compactionModels: override.compactionModels ?? base.compactionModels,
    classifierRunOnceAfterToolCount:
      override.classifierRunOnceAfterToolCount ?? base.classifierRunOnceAfterToolCount,
    classifierRunAfterToolFailures:
      override.classifierRunAfterToolFailures ?? base.classifierRunAfterToolFailures,
    classifierInterval: override.classifierInterval ?? base.classifierInterval,
    defaultContextThresholdPercent:
      override.defaultContextThresholdPercent ?? base.defaultContextThresholdPercent,
    contextThresholdPercentOverrides:
      override.contextThresholdPercentOverrides ?? base.contextThresholdPercentOverrides,
    phaseBias: override.phaseBias ?? base.phaseBias,
    maxSessionBudget: override.maxSessionBudget ?? base.maxSessionBudget,
    firstTurn: override.firstTurn ?? base.firstTurn,
    classifierUltra: override.classifierUltra ?? base.classifierUltra,
    ultraCooldownMinutes: override.ultraCooldownMinutes ?? base.ultraCooldownMinutes,
    classifierComplexityThresholds:
      override.classifierComplexityThresholds ?? base.classifierComplexityThresholds,
    disabledProviders: override.disabledProviders ?? base.disabledProviders,
    rules: override.rules ?? base.rules,
    profiles: mergedProfiles,
    models: Object.keys(mergedModels).length > 0 ? mergedModels : undefined,
  };
};
