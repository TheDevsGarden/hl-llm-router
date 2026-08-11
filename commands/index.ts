import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { AutocompleteItem } from '@earendil-works/pi-tui';
import type { CommandContext, CommandState, CommandActions } from './types';
import { getArgumentCompletions } from './completions';
import { dispatch } from './router';

export const registerCommands = (
  pi: ExtensionAPI,
  state: CommandState,
  actions: CommandActions,
): void => {
  const cctx: CommandContext = { pi, state, actions };

  pi.registerCommand('router', {
    description: 'Model router control center',
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null =>
      getArgumentCompletions(cctx, prefix),
    handler: (args: string | undefined, ctx: ExtensionContext) =>
      dispatch(cctx, args, ctx),
  });
};
