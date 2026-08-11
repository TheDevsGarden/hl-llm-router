import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import type { CommandContext } from './types';
import { MORPH_TOOL_NAMES, resolveMorphKey } from '../morph';

/**
 * `/router morphtools [enable|disable|status]`
 *
 * The Morph tools are profile-independent — the router chooses which model runs
 * the turn, these are capabilities that turn can reach for regardless. So the
 * toggle is global rather than per-profile, and enabled is the default.
 */
export const handleMorphTools = async (
  cctx: CommandContext,
  args: string[],
  ctx: ExtensionContext,
): Promise<void> => {
  const { state, actions } = cctx;
  const action = args[0]?.toLowerCase() ?? 'status';

  if (action !== 'enable' && action !== 'disable' && action !== 'status') {
    ctx.ui.notify('Usage: /router morphtools [enable|disable|status]', 'error');
    return;
  }

  if (action === 'status') {
    const hasKey = resolveMorphKey(getAgentDir()) !== undefined;
    const on = state.morphToolsEnabled;
    ctx.ui.notify(
      `Morph tools: ${on ? 'enabled' : 'disabled'}\n` +
        `  tools:   ${MORPH_TOOL_NAMES.join(', ')}\n` +
        `  api key: ${hasKey ? 'found' : 'MISSING — set MORPH_API_KEY or PI_KEY_MORPH in keys.env'}`,
      hasKey ? 'info' : 'warning',
    );
    return;
  }

  const enable = action === 'enable';
  if (enable && resolveMorphKey(getAgentDir()) === undefined) {
    // Enabling without a key would advertise three tools that fail on first use.
    ctx.ui.notify(
      'No Morph API key found. Set MORPH_API_KEY, or add PI_KEY_MORPH to ' +
        'keys.env and re-run install.sh. Not enabling.',
      'error',
    );
    return;
  }

  actions.setMorphToolsEnabled(enable);
  actions.persistState();
  actions.updateStatus(ctx);
  ctx.ui.notify(
    `Morph tools ${enable ? 'enabled' : 'disabled'} (${MORPH_TOOL_NAMES.join(', ')}).`,
    'info',
  );
};
