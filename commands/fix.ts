import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { RouterTier } from '../types';
import { ROUTER_TIERS } from '../config';
import type { CommandContext } from './types';

export const handleFix = async (
  cctx: CommandContext,
  args: string[],
  ctx: ExtensionContext,
): Promise<void> => {
  const { state, actions } = cctx;
  if (args.length !== 1) {
    ctx.ui.notify('Usage: /router fix <high|medium|low>', 'error');
    return;
  }
  const tier = args[0]?.toLowerCase();
  if (!ROUTER_TIERS.includes(tier as RouterTier)) {
    ctx.ui.notify('Usage: /router fix <high|medium|low>', 'error');
    return;
  }
  if (!state.lastDecision) {
    ctx.ui.notify('No recent routing decision to fix.', 'warning');
    return;
  }
  state.pinnedTierByProfile[state.lastDecision.profile] = tier as RouterTier;
  actions.persistState();
  actions.updateStatus(ctx);
  ctx.ui.notify(
    `Router decision corrected. ${state.lastDecision.profile} is now pinned to ${tier}.`,
    'info',
  );
};
