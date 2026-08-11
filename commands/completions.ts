import type { AutocompleteItem } from '@earendil-works/pi-tui';
import {
  profileNames,
  ROUTER_PIN_VALUES,
  ROUTER_TIERS,
  THINKING_LEVELS,
} from '../config';
import { collectProviders } from '../providers';
import type { CommandContext } from './types';

const SUBCOMMAND_DETAILS = [
  { name: 'status', desc: 'Show current router status' },
  { name: 'profile', desc: 'Switch to a different router profile' },
  { name: 'pin', desc: 'Pin routing for a profile to a specific tier' },
  { name: 'thinking', desc: 'Override thinking level for a tier or profile' },
  { name: 'disable', desc: 'Disable the router and restore last model' },
  { name: 'provider', desc: 'List providers or enable/disable one everywhere' },
  { name: 'fix', desc: 'Correct the last routing decision and pin that tier' },
  { name: 'widget', desc: 'Toggle the router status widget' },
  { name: 'debug', desc: 'Toggle or clear router debug history' },
  { name: 'reload', desc: 'Reload the model router configuration' },
  { name: 'cooldowns', desc: 'Show or clear provider/model cooldowns' },
  { name: 'cool', desc: 'Manually cool a model for a duration' },
  { name: 'uncool', desc: 'Remove a manual cooldown from a model' },
  { name: 'compact', desc: 'Compact the session using compactionModels' },
  { name: 'help', desc: 'Show usage help for subcommands' },
];

const getSubcommandCompletions = (
  prefix: string,
): AutocompleteItem[] | null => {
  const items = SUBCOMMAND_DETAILS.filter((s) =>
    s.name.startsWith(prefix),
  ).map((s) => ({
    value: s.name,
    label: s.name,
    description: s.desc,
  }));
  return items.length > 0 ? items : null;
};

const getPinCompletions = (args: string[]): AutocompleteItem[] | null => {
  // pin <tier|auto>
  if (args.length <= 1) {
    const token = args[0] ?? '';
    const items = ROUTER_PIN_VALUES.filter((value) =>
      value.startsWith(token),
    ).map((value) => ({
      value,
      label: value,
      description: value === 'auto'
        ? 'Restore auto-routing (clear pin) for the active profile'
        : `Pin active profile to ${value} tier`,
    }));
    return items.length > 0 ? items : null;
  }
  return null;
};

const getThinkingCompletions = (
  args: string[],
): AutocompleteItem[] | null => {
  // thinking [tier] <level|auto>
  const tierValues = [...ROUTER_TIERS];
  const levelValues = ['auto', ...THINKING_LEVELS];

  if (args.length <= 1) {
    const token = args[0] ?? '';
    return [
      ...levelValues
        .filter((v) => v.startsWith(token))
        .map((v) => ({
          value: v,
          label: v,
          description: v === 'auto'
            ? 'Restore default thinking level'
            : `Set thinking level to ${v}`,
        })),
      ...tierValues
        .filter((v) => v.startsWith(token))
        .map((v) => ({
          value: v,
          label: v,
          description: `Override thinking for ${v} tier`,
        })),
    ];
  }

  if (levelValues.includes(args[0])) {
    return null;
  }

  if ((tierValues as string[]).includes(args[0])) {
    const tier = args[0];
    const levelPrefix = args[1] ?? '';
    return levelValues
      .filter((v) => v.startsWith(levelPrefix))
      .map((v) => ({
        value: `${tier} ${v}`,
        label: `${tier} ${v}`,
        description: v === 'auto'
          ? `Restore default thinking level for ${tier} tier`
          : `Set thinking level to ${v} for ${tier} tier`,
      }));
  }

  return null;
};

export const getArgumentCompletions = (
  cctx: CommandContext,
  prefix: string,
): AutocompleteItem[] | null => {
  const { state } = cctx;
  const trimmedLeft = prefix.trimStart();
  const hasTrailingSpace = /\s$/.test(prefix);
  const parts = trimmedLeft.length > 0 ? trimmedLeft.split(/\s+/) : [];

  if (parts.length === 0) {
    return getSubcommandCompletions('');
  }

  if (parts.length === 1 && !hasTrailingSpace) {
    return getSubcommandCompletions(parts[0]);
  }

  const subcommand = parts[0];
  const subArgs = parts.slice(1);
  if (hasTrailingSpace && parts.length === 1) {
    subArgs.push('');
  }

  switch (subcommand) {
    case 'profile': {
      const profilePrefix = subArgs[0] ?? '';
      const items = profileNames(state.currentConfig)
        .filter((name) => name.startsWith(profilePrefix))
        .map((name) => ({
          value: `profile ${name}`,
          label: `router/${name}`,
          description: `Switch to router profile "${name}"`,
        }));
      return items.length > 0 ? items : null;
    }
    case 'pin': {
      const completions = getPinCompletions(subArgs);
      return (
        completions?.map((c) => ({
          ...c,
          value: `pin ${c.value}`,
          description: c.description ?? `Pin routing to ${c.label}`,
        })) ?? null
      );
    }
    case 'thinking': {
      const completions = getThinkingCompletions(subArgs);
      return (
        completions?.map((c) => ({
          ...c,
          value: `thinking ${c.value}`,
          description: c.description ?? `Set thinking level to ${c.label}`,
        })) ?? null
      );
    }
    case 'fix': {
      const fixPrefix = subArgs[0] ?? '';
      const items = ['high', 'medium', 'low']
        .filter((t) => t.startsWith(fixPrefix.toLowerCase()))
        .map((t) => ({
          value: `fix ${t}`,
          label: t,
          description: `Correct decision and pin to ${t} tier`,
        }));
      return items.length > 0 ? items : null;
    }
    case 'widget': {
      const widgetPrefix = subArgs[0] ?? '';
      const items = ['on', 'off', 'toggle']
        .filter((v) => v.startsWith(widgetPrefix))
        .map((v) => ({
          value: `widget ${v}`,
          label: v,
          description: `Set widget to ${v}`,
        }));
      return items.length > 0 ? items : null;
    }
    case 'provider': {
      if (subArgs.length <= 1) {
        const verbPrefix = subArgs[0] ?? '';
        const items = ['list', 'disable', 'enable']
          .filter((v) => v.startsWith(verbPrefix))
          .map((v) => ({
            value: `provider ${v}`,
            label: v,
            description:
              v === 'list'
                ? 'List every provider in the config with its status'
                : `${v === 'disable' ? 'Disable' : 'Re-enable'} a provider everywhere`,
          }));
        return items.length > 0 ? items : null;
      }
      const verb = subArgs[0];
      if (verb !== 'enable' && verb !== 'disable') return null;
      const namePrefix = subArgs[1] ?? '';
      const items = collectProviders(state.currentConfig)
        // disable completes enabled providers; enable completes disabled ones
        .filter((info) => (verb === 'disable' ? info.enabled : !info.enabled))
        .filter((info) => info.name.startsWith(namePrefix))
        .map((info) => ({
          value: `provider ${verb} ${info.name}`,
          label: info.name,
          description: `${verb === 'disable' ? 'Disable' : 'Re-enable'} ${info.name} (${info.usages.length} ref(s))`,
        }));
      return items.length > 0 ? items : null;
    }
    case 'compact': {
      // /router compact takes no arguments.
      return null;
    }
    case 'debug': {
      const debugPrefix = subArgs[0] ?? '';
      const items = ['on', 'off', 'toggle', 'clear', 'show']
        .filter((v) => v.startsWith(debugPrefix))
        .map((v) => ({
          value: `debug ${v}`,
          label: v,
          description: `Router debug: ${v}`,
        }));
      return items.length > 0 ? items : null;
    }
  }

  return null;
};
