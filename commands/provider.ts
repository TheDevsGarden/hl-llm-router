import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
  profileNames,
  ROUTER_TIERS,
  resolveWritableConfigPath,
  writeDisabledProviders,
} from '../config';
import {
  collectProviders,
  tierChainRefs,
  filterDisabledRefs,
} from '../providers';
import { formatProviderList } from '../ui';
import type { CommandContext } from './types';

// T15: everything the current disabledProviders list switches off — tier
// chains (degrade at routing time) and whole features (classifier,
// firstTurn, ultra go silently inert). The command surfaces all of it so
// a disable never silently costs more than the user thinks.
export const disabledImpactWarnings = (
  cctx: CommandContext,
): string[] => {
  const config = cctx.state.currentConfig;
  const disabled = new Set(config.disabledProviders ?? []);
  if (disabled.size === 0) return [];
  const warnings: string[] = [];

  const emptied: string[] = [];
  for (const profileName of profileNames(config)) {
    const profile = config.profiles[profileName];
    for (const tier of ROUTER_TIERS) {
      const refs = tierChainRefs(profile, tier);
      if (refs.length === 0) continue;
      const { kept } = filterDisabledRefs(refs, disabled);
      if (kept.length === 0) emptied.push(`${profileName}/${tier}`);
    }
  }
  if (emptied.length > 0) {
    warnings.push(
      `Fully disabled tier chains (degrade at routing time): ${emptied.join(', ')}`,
    );
  }

  const classifierRefs = (
    config.classifierModels ??
    (config.classifierModel ? [config.classifierModel] : [])
  ).map((classifier) => classifier.model);
  if (
    classifierRefs.length > 0 &&
    filterDisabledRefs(classifierRefs, disabled).kept.length === 0
  ) {
    warnings.push(
      'Every classifier model is on a disabled provider — routing falls back to keyword heuristics.',
    );
  }
  if (
    config.firstTurn &&
    filterDisabledRefs([config.firstTurn.model], disabled).kept.length === 0
  ) {
    warnings.push('firstTurn boost is off (its provider is disabled).');
  }
  if (
    config.classifierUltra &&
    filterDisabledRefs([config.classifierUltra.model], disabled).kept.length === 0
  ) {
    warnings.push('ultra escalation is off (its provider is disabled).');
  }
  return warnings;
};

export const handleProvider = async (
  cctx: CommandContext,
  args: string[],
  ctx: ExtensionContext,
): Promise<void> => {
  const { state, actions } = cctx;
  const verb = args[0]?.toLowerCase();

  if (!verb || verb === 'list') {
    if (args.length > 1) {
      ctx.ui.notify('Usage: /router provider [list]', 'error');
      return;
    }
    const lines = [
      'Providers referenced by the router config:',
      ...formatProviderList(collectProviders(state.currentConfig)),
    ];
    const impact = disabledImpactWarnings(cctx);
    if (impact.length > 0) {
      lines.push('', ...impact.map((warning) => `⚠️  ${warning}`));
    }
    ctx.ui.notify(lines.join('\n'), 'info');
    return;
  }

  if ((verb !== 'enable' && verb !== 'disable') || args.length !== 2) {
    ctx.ui.notify(
      'Usage: /router provider [list] | /router provider <enable|disable> <name>',
      'error',
    );
    return;
  }

  const name = args[1];
  const known = collectProviders(state.currentConfig);
  if (!known.some((info) => info.name === name)) {
    ctx.ui.notify(
      `Unknown provider: ${name}. Known providers: ${known.map((info) => info.name).join(', ')}`,
      'error',
    );
    return;
  }

  const disabled = new Set(state.currentConfig.disabledProviders ?? []);
  if (verb === 'disable' && disabled.has(name)) {
    ctx.ui.notify(`Provider ${name} is already disabled.`, 'info');
    return;
  }
  if (verb === 'enable' && !disabled.has(name)) {
    ctx.ui.notify(`Provider ${name} is not disabled.`, 'info');
    return;
  }
  if (verb === 'disable') disabled.add(name);
  else disabled.delete(name);

  // ctx.cwd is what reloadConfig reads from — using process.cwd() here
  // could write one file and reload another.
  const configPath = resolveWritableConfigPath(ctx.cwd);
  try {
    writeDisabledProviders(configPath, [...disabled]);
  } catch (error) {
    ctx.ui.notify(
      `Failed to update ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
    return;
  }

  actions.reloadConfig(ctx, { preserveDebug: true });
  await actions.ensureValidActiveRouterProfile(ctx);
  actions.updateStatus(ctx);

  const lines = [
    verb === 'disable'
      ? `Provider ${name} disabled everywhere (written to ${configPath}).`
      : `Provider ${name} re-enabled (written to ${configPath}).`,
  ];
  const impact = disabledImpactWarnings(cctx);
  lines.push(...impact.map((warning) => `⚠️  ${warning}`));
  ctx.ui.notify(lines.join('\n'), impact.length > 0 ? 'warning' : 'info');
};
