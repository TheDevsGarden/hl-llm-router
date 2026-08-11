/**
 * Minimal HTTP client for api.morphllm.com.
 *
 * Deliberately dependency-free. `@morphllm/morphsdk` would handle the WarpGrep
 * loop for us, but extensions load from ~/.pi/agent/extensions/ and resolve
 * modules against pi's own NODE_PATH — a third-party package installed anywhere
 * else is simply not resolvable there. Raw fetch is the only thing guaranteed
 * to work on a fresh machine.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MORPH_BASE_URL = 'https://api.morphllm.com';

/** Verified live 2026-08-08 against /v1/models. */
export const MORPH_MODELS = {
  warpGrep: 'morph-warp-grep-v2.1',
  fastApply: 'morph-v3-fast',
  fastApplyLarge: 'morph-v3-large',
  compact: 'morph-compactor',
} as const;

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1_000;

export class MorphError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'MorphError';
  }
}

/**
 * The API key, in precedence order:
 *   1. MORPH_API_KEY in the environment
 *   2. providers.morph.apiKey in models.json (materialized from keys.env)
 *
 * models.json is the same file the `morph` provider reads, so one key in
 * keys.env serves both the hosted-model profile and these tools.
 */
export const resolveMorphKey = (agentDir: string): string | undefined => {
  const fromEnv = process.env.MORPH_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const raw = readFileSync(join(agentDir, 'models.json'), 'utf8');
    const key = JSON.parse(raw)?.providers?.morph?.apiKey;
    // An unexpanded ${PI_KEY_MORPH} means install.sh ran without keys.env.
    if (typeof key === 'string' && key.trim() && !key.startsWith('${')) {
      return key.trim();
    }
  } catch {
    // models.json unreadable or unparseable — the caller reports "no key".
  }
  return undefined;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST JSON, retrying transient failures. Returns the parsed body.
 *
 * `signal` is threaded through so Esc actually aborts the in-flight request.
 * This setup has been bitten before by calls that hang rather than error, and
 * nothing downstream advances on silence.
 */
export const morphPost = async <T>(
  path: string,
  body: unknown,
  apiKey: string,
  signal?: AbortSignal,
  timeoutMs = 60_000,
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const composite = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await fetch(`${MORPH_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: composite,
      });

      if (RETRY_STATUSES.has(response.status) && attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_BASE_MS * 2 ** attempt);
        continue;
      }
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 400);
        throw new MorphError(
          `Morph ${path} failed: ${response.status} ${detail}`,
          response.status,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      // A caller-initiated abort is a decision, not a failure to retry around.
      if (signal?.aborted) throw error;
      if (error instanceof MorphError) throw error;
      lastError = error;
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_BASE_MS * 2 ** attempt);
        continue;
      }
    }
  }

  throw new MorphError(
    `Morph ${path} failed after ${MAX_RETRIES} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
};

export interface ChatToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

export interface ChatCompletion {
  choices: {
    message: {
      role: string;
      content: string | null;
      tool_calls?: ChatToolCall[];
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
