import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { CommandContext } from './types';

/**
 * Parse a context-window shorthand string into a number of tokens.
 * Accepts: "1048576", "1M", "1.05M", "1050k", "1.05m", "262144".
 * Returns null for unparseable input.
 */
const parseContextValue = (raw: string): number | null => {
  const s = raw.trim();
  if (!s) return null;
  const upper = s.toUpperCase();
  const match = upper.match(/^(\d+(?:\.\d+)?)\s*([KM])?$/);
  if (!match) return null;
  const n = parseFloat(match[1]!);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = match[2];
  if (unit === 'K') return Math.round(n * 1000);
  if (unit === 'M') return Math.round(n * 1_000_000);
  return Math.round(n);
};

/**
 * `/router context-override <value|disable>`
 *
 * Emergency unblock: override the displayed/used context window on every model
 * for the rest of this session. Accepts raw token counts or shorthand like
 * `1M`, `1050k`. `disable` clears the override and returns to native values.
 *
 * Scope: model_select only. When pi picks a non-router model (e.g. via `#oss`),
 * we patch its contextWindow with the override before calling setModel.
 * Router profile models are passed through unchanged — the override applies to
 * the actual target model the chat loop uses, not the router's facade.
 *
 * Persistence: written to RouterPersistedState.contextOverride so the
 * override survives a `/router reload` within the same pi process.
 */
export const handleContextOverride = async (
  cctx: CommandContext,
  subArgs: string[],
  ctx: ExtensionContext,
): Promise<void> => {
  const { state, actions } = cctx;
  const arg = subArgs[0];

  if (!arg || arg === 'show') {
    if (typeof state.contextOverride === 'number' && state.contextOverride > 0) {
      ctx.ui.notify(
        `Context override active: ${state.contextOverride.toLocaleString()} tokens (applies to non-router model selects). Use \`/router context-override disable\` to clear.`,
        'info',
      );
    } else {
      ctx.ui.notify(
        'No context override set. Native context windows apply. Usage: /router context-override <1M|1050k|262144|disable>',
        'info',
      );
    }
    return;
  }

  if (arg === 'disable' || arg === 'clear' || arg === 'off') {
    if (typeof state.contextOverride !== 'number') {
      ctx.ui.notify('Context override was already off.', 'info');
      return;
    }
    actions.setContextOverride(undefined);
    ctx.ui.notify(
      'Context override cleared. Native context windows apply on the next model select.',
      'info',
    );
    return;
  }

  const value = parseContextValue(arg);
  if (value === null) {
    ctx.ui.notify(
      `Unparseable value "${arg}". Use raw tokens (1048576), shorthand (1M, 1050k), or "disable".`,
      'error',
    );
    return;
  }
  if (value < 1024) {
    ctx.ui.notify(
      `Refusing context override of ${value} tokens — too small to be useful.`,
      'error',
    );
    return;
  }

  actions.setContextOverride(value);
  ctx.ui.notify(
    `Context override set: ${value.toLocaleString()} tokens. Next model select will apply it.`,
    'info',
  );
};

export const parseContextValueForTest = parseContextValue;