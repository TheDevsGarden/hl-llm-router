import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { profileNames } from '../config';
import {
  formatPinSummary,
  formatThinkingSummary,
  formatModelRef,
} from '../ui';
import type { CommandContext } from './types';

export const handleStatus = async (
  cctx: CommandContext,
  args: string[],
  ctx: ExtensionContext,
): Promise<void> => {
  if (args.length > 0) {
    ctx.ui.notify('Usage: /router status (no arguments)', 'error');
    return;
  }
  const { state, actions } = cctx;
  const names = profileNames(state.currentConfig).join(', ');
  const lines = [
    'Model Router Status:',
    `Router enabled: ${state.routerEnabled ? 'yes' : 'off'}`,
    `Selected profile: ${state.selectedProfile ?? 'none'}`,
    `Selected profile pin: ${state.selectedProfile ? (state.pinnedTierByProfile[state.selectedProfile] ?? 'auto') : 'none'}`,
    `Pins by profile: ${formatPinSummary(state.pinnedTierByProfile)}`,
    `Thinking overrides: ${formatThinkingSummary(state.thinkingByProfile)}`,
    `Widget: ${state.widgetEnabled ? 'on' : 'off'}`,
    `Phase bias: ${state.currentConfig.phaseBias}`,
    `Disabled providers: ${state.currentConfig.disabledProviders?.join(', ') ?? 'none'}`,
    `Session cost: $${state.accumulatedCost.toFixed(4)}` +
      (state.currentConfig.maxSessionBudget
        ? ` / $${state.currentConfig.maxSessionBudget.toFixed(2)}`
        : ''),
    `Available profiles: ${names}`,
    `Last non-router model: ${formatModelRef(state.lastNonRouterModel)}`,
    `Debug: ${state.debugEnabled ? 'on' : 'off'}`,
    `Debug history: ${state.debugHistory.length} decisions`,
  ];
  if (state.lastDecision) {
    lines.push(
      `Last routed tier: ${state.lastDecision.tier}`,
      `Last phase: ${state.lastDecision.phase}`,
      `Last model: ${state.lastDecision.targetProvider}/${state.lastDecision.targetModelId} (${state.lastDecision.thinking})`,
      `Reason: ${state.lastDecision.reasoning}`,
    );
  }
  if (state.lastCompaction) {
    const c = state.lastCompaction;
    lines.push(
      `Last compaction: ${c.fellBackToDefault ? 'default (all compactionModels failed)' : c.model} — ${c.summaryChars.toLocaleString()} chars, ${c.tokensBefore.toLocaleString()} tokens before${c.cost !== undefined ? `, $${c.cost.toFixed(4)}` : ''}`,
    );
  }
  if (state.lastConfigWarnings && state.lastConfigWarnings.length > 0) {
    lines.push(
      '',
      '⚠️ Configuration Warnings:',
      ...state.lastConfigWarnings.map((w) => `  - ${w}`),
    );
  }
  ctx.ui.notify(lines.join('\n'), 'info');
  actions.updateStatus(ctx);
};
