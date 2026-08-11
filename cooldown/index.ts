export { parseDuration, durationFor, formatRemaining } from './duration';
export {
  classifyFailure,
  advertisedWaitMs,
  isConnectivityFailure,
  MAX_ADVERTISED_WAIT_MS,
} from './classify';
export { DEFAULT_COOLDOWN_RULE, resolveRule } from './rules';
export {
  modelKey,
  EMPTY_COOLDOWN_STATE,
  activeCooldown,
  markCooling,
  clearCooldowns,
  pruneExpired,
  activeEntries,
  partitionByCooldown,
} from './state';
// Re-export the persistence layer so `from './cooldown'` covers everything.
export {
  COOLDOWN_FILE,
  cooldownPath,
  parseCooldownState,
  loadCooldowns,
  saveCooldowns,
} from '../cooldown-store';
