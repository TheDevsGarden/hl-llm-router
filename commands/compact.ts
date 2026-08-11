import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { CommandContext } from './types';

// T17: /router compact — manual compactions only, on the compactionModels chain.
//   No sub-arguments. beginRouterCompaction() flags the next compaction as
//   /router-initiated so the session_before_compact handler (in index.ts)
//   picks it up; plain /compact and auto (threshold/overflow) stay on pi's
//   own compaction path.
export const handleCompact = async (
  cctx: CommandContext,
  args: string[],
  ctx: ExtensionContext,
): Promise<void> => {
  if (args.length > 0) {
    ctx.ui.notify('Usage: /router compact (no arguments)', 'error');
    return;
  }
  const { state, actions } = cctx;
  const models = state.currentConfig.compactionModels;
  if (!models || models.length === 0) {
    ctx.ui.notify(
      'No compactionModels configured — using default compaction. Set compactionModels in model-router.json to compact on the cheap chain.',
      'warning',
    );
  } else {
    ctx.ui.notify(
      `Compacting with compactionModels (${models.map((m) => m.model).join(' → ')})...`,
      'info',
    );
  }
  actions.beginRouterCompaction();
  ctx.compact({
    onError: (error: Error) => {
      ctx.ui.notify(`Compaction failed: ${error.message}`, 'error');
    },
  });
};
