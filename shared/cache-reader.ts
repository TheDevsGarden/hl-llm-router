import { readFileSync, statSync } from 'node:fs';
import type { FreeCacheEntry, FreeModelScore } from '../types';

/** Read free-models.json cache. Returns Set of canonical IDs where free === true.
 *  Never throws — returns empty Set on any error (missing file, bad JSON). */
export const readFreeModelCache = (cachePath: string): ReadonlySet<string> => {
  try {
    const raw = readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as { models?: unknown };
    if (!Array.isArray(parsed.models)) return new Set();
    const result = new Set<string>();
    for (const entry of parsed.models as FreeCacheEntry[]) {
      if (entry && typeof entry.id === 'string' && entry.free === true) {
        result.add(entry.id);
      }
    }
    return result;
  } catch {
    return new Set();
  }
};

/** Read quality-scores.json cache (written by free-model-finder).
 *  Returns Record of canonical ID -> FreeModelScore. Never throws. */
export const readQualityScores = (
  scoresPath: string,
): Readonly<Record<string, FreeModelScore>> => {
  try {
    const raw = readFileSync(scoresPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as Record<string, FreeModelScore>;
  } catch {
    return {};
  }
};

/** Best-effort mtime check. 0 if missing. */
export const cacheMtimeMs = (cachePath: string): number => {
  try {
    return statSync(cachePath).mtimeMs;
  } catch {
    return 0;
  }
};
