import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { RouterTier } from '../types';
import { ROUTER_TIERS, THINKING_LEVELS, getUnsupportedTiers } from '../config';
import type { CommandContext } from './types';

export const handleThinking = async (
  cctx: CommandContext,
  args: string[],
  ctx: ExtensionContext,
): Promise<void> => {
  const { state, actions } = cctx;
  const currentProfile = state.selectedProfile;
  if (!currentProfile) {
    ctx.ui.notify('No router profile is active. Select a router model first.', 'error');
    return;
  }
  if (args.length === 0) {
    ctx.ui.notify(
      [
        `Profile: ${currentProfile}`,
        `Thinking overrides: ${JSON.stringify(state.thinkingByProfile[currentProfile] ?? {})}`,
        'Usage: /router thinking <level|auto>           (applies to all tiers)',
        '   or: /router thinking <tier> <level|auto>    (applies to one tier)',
        'Note: not all tier models may support every thinking level.',
      ].join('\n'),
      'info',
    );
    return;
  }

  if (args.length > 2) {
    ctx.ui.notify('Too many arguments for /router thinking.', 'error');
    return;
  }

  let tier: RouterTier | 'all' | undefined = undefined;
  let levelValue = '';

  const tierValues = ['high', 'medium', 'low'];
  const levelValues = ['auto', ...THINKING_LEVELS];

  if (args.length === 1) {
    levelValue = args[0];
    tier = 'all';
  } else if (args.length === 2) {
    if (tierValues.includes(args[0]) || args[0] === 'all') {
      tier = args[0] as RouterTier | 'all';
      levelValue = args[1];
    } else {
      ctx.ui.notify(
        `Invalid tier: ${args[0]}. Use high, medium, or low.`,
        'error',
      );
      return;
    }
  }

  if (tier !== 'all' && !tierValues.includes(tier as string)) {
    ctx.ui.notify(
      `Invalid tier: ${tier}. Use high, medium, or low.`,
      'error',
    );
    return;
  }
  if (!levelValues.includes(levelValue)) {
    ctx.ui.notify(
      `Invalid thinking level: ${levelValue}. Use auto or: ${THINKING_LEVELS.join(', ')}`,
      'error',
    );
    return;
  }

  const nextLevel = levelValue === 'auto' ? undefined : (levelValue as any);
  if (tier === 'all') {
    for (const t of ROUTER_TIERS) {
      if (!state.thinkingByProfile[currentProfile])
        state.thinkingByProfile[currentProfile] = {};
      if (nextLevel) state.thinkingByProfile[currentProfile]![t] = nextLevel;
      else delete state.thinkingByProfile[currentProfile]![t];
    }
  } else {
    if (!state.thinkingByProfile[currentProfile])
      state.thinkingByProfile[currentProfile] = {};
    if (nextLevel)
      state.thinkingByProfile[currentProfile]![tier as RouterTier] = nextLevel;
    else delete state.thinkingByProfile[currentProfile]![tier as RouterTier];
  }
  if (
    state.thinkingByProfile[currentProfile] &&
    Object.keys(state.thinkingByProfile[currentProfile]!).length === 0
  ) {
    delete state.thinkingByProfile[currentProfile];
  }

  actions.persistState();
  actions.updateStatus(ctx);
  if (nextLevel) {
    actions.syncPiThinkingLevel(nextLevel);
  } else if (state.lastDecision) {
    actions.syncPiThinkingLevel(state.lastDecision.thinking);
  }
  // Only warn when the level isn't supported by some tiers; skip for 'off' and 'auto'
  if (nextLevel && nextLevel !== 'off') {
    const unsupported = getUnsupportedTiers(
      state.currentConfig.profiles[currentProfile],
      nextLevel,
    );
    if (unsupported.length > 0) {
      ctx.ui.notify(
        `Router thinking (${tier}) set to ${nextLevel}. ` +
          `${unsupported.join(', ')} tier${unsupported.length > 1 ? 's' : ''} may not support '${nextLevel}'.`,
        'warning',
      );
    }
  }
};
