import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { formatDecision } from '../ui';
import type { CommandContext } from './types';

export const handleDebug = async (
  cctx: CommandContext,
  args: string[],
  ctx: ExtensionContext,
): Promise<void> => {
  const { state, actions } = cctx;
  if (args.length > 1) {
    ctx.ui.notify('Usage: /router debug <on|off|show|clear>', 'error');
    return;
  }
  const cmd = args[0]?.toLowerCase();
  if (cmd === 'on') state.debugEnabled = true;
  else if (cmd === 'off') state.debugEnabled = false;
  else if (cmd === 'clear') state.debugHistory.length = 0;
  else if (cmd === 'show') {
    if (state.debugHistory.length === 0) {
      ctx.ui.notify('No recent routing decisions.', 'info');
    } else {
      const history = state.debugHistory
        .map(
          (d) =>
            `[${new Date(d.timestamp).toLocaleTimeString()}] ${formatDecision(d)}`,
        )
        .join('\n');
      ctx.ui.notify(`Recent Routing Decisions:\n${history}`, 'info');
    }
    return;
  } else {
    state.debugEnabled = !state.debugEnabled;
  }
  actions.persistState();
  ctx.ui.notify(
    `Router debug ${state.debugEnabled ? 'enabled' : 'disabled'}.`,
    'info',
  );
};
