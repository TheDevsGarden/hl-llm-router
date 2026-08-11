import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { RouterTier } from '../types';
import { ROUTER_PIN_VALUES } from '../config';
import type { CommandContext } from './types';

export const handlePin = async (
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
        `Pinned tier: ${state.pinnedTierByProfile[currentProfile] ?? 'auto'}`,
        `Usage: /router pin <high|medium|low|auto>`,
      ].join('\n'),
      'info',
    );
    actions.updateStatus(ctx);
    return;
  }

  if (args.length > 1) {
    ctx.ui.notify(
      'Usage: /router pin <high|medium|low|auto>',
      'error',
    );
    return;
  }

  const pinValue = args[0];

  if (!ROUTER_PIN_VALUES.includes(pinValue as any)) {
    ctx.ui.notify(
      `Invalid router pin: ${pinValue}. Use one of: ${ROUTER_PIN_VALUES.join(', ')}`,
      'error',
    );
    return;
  }

  const nextTier = pinValue === 'auto' ? undefined : (pinValue as RouterTier);
  if (nextTier) {
    state.pinnedTierByProfile[currentProfile] = nextTier;
  } else {
    delete state.pinnedTierByProfile[currentProfile];
  }
  actions.persistState();
  actions.updateStatus(ctx);
  ctx.ui.notify(
    nextTier
      ? `Router pinned to ${nextTier}`
      : `Router pin cleared; heuristic routing restored`,
    'info',
  );
};
