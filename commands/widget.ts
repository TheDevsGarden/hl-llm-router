import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { CommandContext } from './types';

export const handleWidget = async (
  cctx: CommandContext,
  args: string[],
  ctx: ExtensionContext,
): Promise<void> => {
  const { state, actions } = cctx;
  if (args.length > 1) {
    ctx.ui.notify('Usage: /router widget <on|off|toggle>', 'error');
    return;
  }
  const cmd = args[0]?.toLowerCase();
  if (cmd === 'on') state.widgetEnabled = true;
  else if (cmd === 'off') state.widgetEnabled = false;
  else state.widgetEnabled = !state.widgetEnabled;
  actions.persistState();
  actions.updateStatus(ctx);
  ctx.ui.notify(
    `Router widget ${state.widgetEnabled ? 'enabled' : 'disabled'}.`,
    'info',
  );
};
