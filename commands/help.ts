import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { CommandContext } from './types';

export const ROUTER_HELP = [
  'Router Subcommands:',
  '  status                      Show current status, profile, pin, cost, and last decision.',
  '  cooldowns [show|clear]      List providers/models cooling down after quota or rate-limit hits.',
  '  compact                     Compact the session using compactionModels (cheaper chain). Manual only; auto-compaction is unaffected.',
  '  morphtools [enable|disable] Morph tools (codebase_search, fast_apply, compact_context) for any profile. On by default.',
  '  profile [name]              Switch to a profile (enables router if off). Lists available if no name.',
  '  pin <tier|auto>             Force a tier (high|medium|low) or set to auto.',
  '  thinking [tier] <level>     Override thinking level (off|minimal|...|max|auto). Not all tier models may support every level.',
  '  disable                     Disable the router and restore the last used non-router model.',
  '  provider [list]             List every provider in the config with enabled/disabled status and usages.',
  '  provider <enable|disable> <name>  Toggle a provider everywhere (written to the config file immediately).',
  '  fix <tier>                  Correct the last routing decision and pin that tier for the current profile.',
  '  widget <on|off|toggle>      Control the persistent status widget visibility.',
  '  debug <on|off|show|clear>   Control routing debug logging to notifications and history.',
  '  reload                      Hot-reload the configuration JSON from .pi/model-router.json.',
  '  help, ?                     Show this help message.',
].join('\n');

export const handleHelp = async (
  cctx: CommandContext,
  subArgs: string[],
  ctx: ExtensionContext,
): Promise<void> => {
  if (subArgs.length > 0) {
    ctx.ui.notify('Usage: /router help (no arguments)', 'error');
    return;
  }
  ctx.ui.notify(ROUTER_HELP, 'info');
};
