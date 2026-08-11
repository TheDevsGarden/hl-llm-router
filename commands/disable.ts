import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { parseCanonicalModelRef } from '../shared/model-ref';
import type { CommandContext } from './types';

export const handleDisable = async (
  cctx: CommandContext,
  args: string[],
  ctx: ExtensionContext,
): Promise<void> => {
  const { state, actions } = cctx;
  if (args.length > 0) {
    ctx.ui.notify('Usage: /router disable (no arguments)', 'error');
    return;
  }
  if (!state.lastNonRouterModel) {
    ctx.ui.notify(
      'No previous non-router model recorded. Use /model to pick a concrete model.',
      'warning',
    );
    return;
  }
  const { provider, modelId } = parseCanonicalModelRef(
    state.lastNonRouterModel,
  );
  const targetModel = ctx.modelRegistry.find(provider, modelId);
  if (!targetModel) {
    ctx.ui.notify(
      `Recorded non-router model is unavailable: ${state.lastNonRouterModel}`,
      'error',
    );
    return;
  }
  const success = await cctx.pi.setModel(targetModel);
  if (!success) {
    ctx.ui.notify(`Failed to switch to ${state.lastNonRouterModel}`, 'error');
    return;
  }
  state.routerEnabled = false;
  actions.persistState();
  actions.updateStatus(ctx);
  ctx.ui.notify(
    `Router disabled. Restored ${state.lastNonRouterModel}`,
    'info',
  );
};
