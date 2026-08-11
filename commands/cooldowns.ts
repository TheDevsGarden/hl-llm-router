import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { activeEntries, clearCooldowns, formatRemaining } from '../cooldown';
import { loadCooldowns, saveCooldowns } from '../cooldown-store';
import type { CommandContext } from './types';

export const handleCooldowns = async (
  cctx: CommandContext,
  subArgs: string[],
  ctx: ExtensionContext,
): Promise<void> => {
  const { state } = cctx;
  const action = subArgs[0] ?? 'show';
  const dir = getAgentDir();
  const now = Date.now();

  if (action === 'clear') {
    saveCooldowns(dir, clearCooldowns(), now);
    ctx.ui.notify('Cleared all router cooldowns.', 'info');
    return;
  }
  if (action !== 'show') {
    ctx.ui.notify('Usage: /router cooldowns [show|clear]', 'error');
    return;
  }

  if (state.currentConfig.cooldowns?.enabled !== true) {
    ctx.ui.notify(
      'Cooldowns are off. Add a "cooldowns" block to model-router.json to enable them.',
      'info',
    );
    return;
  }

  const entries = activeEntries(loadCooldowns(dir, now), now);
  if (entries.length === 0) {
    ctx.ui.notify('No active cooldowns — every candidate is available.', 'info');
    return;
  }

  const lines = entries.map((entry) => {
    const target = entry.scope === 'provider' ? `${entry.provider} (all models)` : entry.key;
    return `  ${target} — ${entry.reason}, ${formatRemaining(entry.until - now)} left`;
  });
  ctx.ui.notify([`Active cooldowns (${entries.length}):`, ...lines].join('\n'), 'info');
};
