import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type {
  RoutingDecision,
  RouterConfig,
  RouterPinByProfile,
  RouterThinkingByProfile,
  ProviderInfo,
} from './types';

const getEffectiveThinking = (
  thinkingByProfile: RouterThinkingByProfile,
  profileName: string,
  decision: RoutingDecision,
) => thinkingByProfile[profileName]?.[decision.tier] ?? decision.thinking;

const getDecisionFlags = (decision: RoutingDecision): string[] => {
  const flags: string[] = [];
  if (decision.isFallback) flags.push('fallback');
  if (decision.isBudgetForced) flags.push('budget-limit');
  if (decision.isRuleMatched) flags.push('rule');
  if (decision.isContextForced) flags.push('context');
  if (decision.isReused) flags.push('reused');
  if (decision.isModelForced) flags.push('model-rule');
  if (decision.isFirstTurn) flags.push('first-turn');
  if (decision.isUltra) flags.push('ultra');
  if (decision.isProviderFiltered) flags.push('provider-filtered');
  return flags;
};

export const formatDecision = (decision: RoutingDecision): string => {
  return `${decision.profile}: ${decision.tier} -> ${decision.targetProvider}/${decision.targetModelId} [${decision.thinking}] (${decision.reasoning})`;
};

export const formatPinSummary = (
  pinnedTierByProfile: RouterPinByProfile,
): string => {
  const entries = Object.entries(pinnedTierByProfile)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([profile, tier]) => `${profile}:${tier}`);
  return entries.length > 0 ? entries.join(', ') : 'none';
};

export const formatThinkingSummary = (
  thinkingByProfile: RouterThinkingByProfile,
): string => {
  const entries = Object.entries(thinkingByProfile)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([profile, tierMap]) => {
      const tiers = Object.entries(tierMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tier, level]) => `${tier}:${level}`);
      return `${profile}(${tiers.join(',')})`;
    });
  return entries.length > 0 ? entries.join(', ') : 'none';
};

export const formatModelRef = (ref: string | undefined): string => {
  return ref ?? 'none';
};

const MAX_USAGES_SHOWN = 4;

/** T15: one line per provider for /router provider list. */
export const formatProviderList = (infos: ProviderInfo[]): string[] => {
  if (infos.length === 0) {
    return ['No providers are referenced in the router config.'];
  }
  return infos.map((info) => {
    const marker = info.enabled ? '✓' : '✗';
    const status = info.enabled ? 'enabled' : 'DISABLED';
    if (info.usages.length === 0) {
      return `${marker} ${info.name} [${status}] — not referenced by the current config`;
    }
    const shown = info.usages
      .slice(0, MAX_USAGES_SHOWN)
      .map((usage) => usage.where);
    const overflow = info.usages.length - shown.length;
    const usageText =
      overflow > 0
        ? `${shown.join(', ')}, +${overflow} more`
        : shown.join(', ');
    return `${marker} ${info.name} [${status}] — ${info.usages.length} ref(s): ${usageText}`;
  });
};

export const updateStatus = (
  ctx: ExtensionContext,
  routerEnabled: boolean,
  selectedProfile: string | undefined,
  pinnedTierByProfile: RouterPinByProfile,
  thinkingByProfile: RouterThinkingByProfile,
  lastDecision: RoutingDecision | undefined,
  lastNonRouterModel: string | undefined,
  accumulatedCost: number,
  widgetEnabled: boolean,
  currentConfig: RouterConfig,
) => {
  const activeRouterProfile = routerEnabled ? selectedProfile : undefined;
  const statusProfile = selectedProfile ?? 'none';
  const activePin = selectedProfile ? pinnedTierByProfile[selectedProfile] : undefined;
  const pinLabel = activePin ? ` [pin:${activePin}]` : '';

  if (activeRouterProfile) {
    const matchesProfile =
      lastDecision && lastDecision.profile === activeRouterProfile;
    const matchesPin = activePin ? lastDecision?.tier === activePin : true;

    let statusText: string;
    if (lastDecision && matchesProfile && matchesPin) {
      const effectiveThinking = getEffectiveThinking(
        thinkingByProfile,
        activeRouterProfile,
        lastDecision,
      );
      statusText = `router:${activeRouterProfile}${pinLabel} -> ${lastDecision.tier} -> ${lastDecision.targetProvider}/${lastDecision.targetModelId} (${effectiveThinking})`;
    } else if (activePin && currentConfig.profiles[activeRouterProfile]?.[activePin]) {
      // A pin fixes the tier deterministically — render it straight from the
      // profile config instead of showing "waiting" until a matching decision
      // is recorded (the decision lags mid-turn, so "waiting" showed even while
      // the pinned model was actively streaming).
      const tierCfg = currentConfig.profiles[activeRouterProfile][activePin]!;
      const effectiveThinking =
        thinkingByProfile[activeRouterProfile]?.[activePin] ?? tierCfg.thinking ?? activePin;
      statusText = `router:${activeRouterProfile}${pinLabel} -> ${activePin} -> ${tierCfg.model} (${effectiveThinking})`;
    } else {
      statusText = `router:${activeRouterProfile}${pinLabel} -> waiting`;
    }
    ctx.ui.setStatus('router', `🚥 ${statusText}`);
  } else {
    ctx.ui.setStatus('router', undefined);
  }

  if (!widgetEnabled) {
    ctx.ui.setWidget('router', undefined);
    return;
  }

  const widgetLines = [
    `Router: ${routerEnabled ? 'enabled' : 'disabled'}`,
    `Profile: ${statusProfile}${activeRouterProfile ? ' (active)' : ''}`,
    `Pin: ${activePin ?? 'auto'}`,
    `Cost: $${accumulatedCost.toFixed(4)}` +
      (currentConfig.maxSessionBudget
        ? ` / $${currentConfig.maxSessionBudget.toFixed(2)}`
        : ''),
  ];
  if (lastDecision && lastDecision.profile === statusProfile) {
    const effectiveThinking = getEffectiveThinking(
      thinkingByProfile,
      statusProfile,
      lastDecision,
    );
    const flags = getDecisionFlags(lastDecision);
    const flagsStr = flags.length > 0 ? ` [${flags.join(',')}]` : '';

    widgetLines.push(
      `Route: ${lastDecision.tier}${flagsStr} -> ${lastDecision.targetProvider}/${lastDecision.targetModelId} (${effectiveThinking})`,
      `Phase: ${lastDecision.phase}`,
    );
  } else if (!routerEnabled && lastNonRouterModel) {
    widgetLines.push(`Fallback: ${lastNonRouterModel}`);
  }
  if (Object.keys(pinnedTierByProfile).length > 1) {
    widgetLines.push(`Pins: ${formatPinSummary(pinnedTierByProfile)}`);
  }
  ctx.ui.setWidget(
    'router',
    widgetLines.map((line) => ctx.ui.theme.fg('dim', line)),
  );
};
