import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { profileNames } from '../config';
import type { CommandContext } from './types';

export const handleProfile = async (
  cctx: CommandContext,
  args: string[],
  ctx: ExtensionContext,
): Promise<void> => {
  if (args.length > 1) {
    ctx.ui.notify('Usage: /router profile [name]', 'error');
    return;
  }
  const { state, actions } = cctx;
  const profileName = args[0];
  if (!profileName) {
    ctx.ui.notify(
      `Current profile: ${state.selectedProfile}. Available: ${profileNames(state.currentConfig).join(', ')}`,
      'info',
    );
    return;
  }
  const success = await actions.switchToRouterProfile(profileName, ctx);
  if (success) {
    ctx.ui.notify(
      `Switched to router profile: ${state.selectedProfile}`,
      'info',
    );
  }
};
