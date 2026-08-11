import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { profileNames } from '../config';
import type { CommandContext } from './types';

export const handleReload = async (
  cctx: CommandContext,
  args: string[],
  ctx: ExtensionContext,
): Promise<void> => {
  const { state, actions } = cctx;
  if (args.length > 0) {
    ctx.ui.notify('Usage: /router reload (no arguments)', 'error');
    return;
  }
  actions.reloadConfig(ctx, { preserveDebug: true });
  await actions.ensureValidActiveRouterProfile(ctx);
  ctx.ui.notify(
    `Router config reloaded. Profiles: ${profileNames(state.currentConfig).join(', ')}`,
    'info',
  );
};
