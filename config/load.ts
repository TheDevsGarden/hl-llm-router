import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import type { RouterConfig, ConfigLoadResult } from '../types';
import { isObjectRecord } from './guards';
import { parseConfigFile } from './parse-file';
import { mergeConfig } from './merge';
import { normalizeConfig } from './normalize';
import { invariant } from '../invariants';

export const loadRouterConfig = (cwd: string): ConfigLoadResult => {
  const globalPath = join(getAgentDir(), 'model-router.json');
  const projectPath = join(cwd, '.pi', 'model-router.json');
  const globalResult = parseConfigFile(globalPath);
  const projectResult = parseConfigFile(projectPath);
  const baseConfig: RouterConfig = { profiles: {} };
  const merged = mergeConfig(
    mergeConfig(baseConfig, globalResult.config),
    projectResult.config,
  );
  const normalized = normalizeConfig(merged);
  return {
    config: normalized.config,
    warnings: [
      ...globalResult.warnings,
      ...projectResult.warnings,
      ...normalized.warnings,
    ],
  };
};

/**
 * T15: the config file a command mutation should write to — the
 * highest-precedence file that exists (project wins over global, matching
 * loadRouterConfig's merge order). Falls back to the global path so a
 * mutation can bootstrap a config file when none exists yet.
 */
export const resolveWritableConfigPath = (cwd: string): string => {
  const projectPath = join(cwd, '.pi', 'model-router.json');
  if (existsSync(projectPath)) return projectPath;
  return join(getAgentDir(), 'model-router.json');
};

/**
 * T15: persist the disabledProviders list into a config file immediately
 * (read-modify-write; the field is always written, `[]` included, so a
 * stale list in a lower-precedence config file can never win the merge).
 * Config files are strict JSON — comments cannot exist — so a re-stringify
 * loses nothing. Throws on unreadable/unparsable files; callers surface it.
 */
export const writeDisabledProviders = (
  path: string,
  disabled: string[],
): void => {
  const parsed: unknown = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf-8'))
    : {};
  if (!isObjectRecord(parsed)) {
    throw new Error(`Config file ${path} does not contain a JSON object.`);
  }
  // Always write the field — even empty. Deleting it would let a stale
  // disabledProviders list in a lower-precedence config file win the merge
  // and silently re-disable a provider the user just re-enabled.
  parsed.disabledProviders = [...disabled].sort();
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`, 'utf-8');
  // Read back: a file that lost the field would let a stale list in a
  // lower-precedence config win the merge and silently re-disable a provider
  // the user just re-enabled — the exact failure this function exists to stop.
  const readBack: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  invariant(
    isObjectRecord(readBack) && Array.isArray(readBack.disabledProviders),
    `${path} does not contain disabledProviders after write`,
  );
};
