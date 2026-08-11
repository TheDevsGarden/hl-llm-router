/**
 * Fast Apply — merge a terse edit snippet into a full file.
 *
 * The wire format is not negotiable: one user message carrying three XML tags,
 * `<instruction>`, `<code>` and `<update>`, to /v1/chat/completions. The merged
 * file comes back as plain text in `choices[0].message.content` — not a diff,
 * not JSON. Verified live 2026-08-08.
 *
 * `<update>` is meant to be lazy: only the changed regions, with
 * `// ... existing code ...` standing in for everything untouched. That laziness
 * is the entire point — it is what makes this cheaper than a full rewrite.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { MORPH_MODELS, morphPost, type ChatCompletion } from './client';
import { safeResolve } from './warpgrep';

export const EXISTING_CODE_MARKER = '// ... existing code ...';

export interface FastApplyResult {
  path: string;
  merged: string;
  original: string;
  changed: boolean;
  bytesBefore: number;
  bytesAfter: number;
}

/**
 * Merge `update` into the file at `path` and write the result.
 *
 * `dryRun` returns the merge without touching disk, which is what the tool uses
 * when the caller only wants to see the result.
 */
export const fastApply = async (options: {
  repoRoot: string;
  path: string;
  instruction: string;
  update: string;
  apiKey: string;
  model?: string;
  signal?: AbortSignal;
  dryRun?: boolean;
}): Promise<FastApplyResult> => {
  const {
    repoRoot,
    path,
    instruction,
    update,
    apiKey,
    model = MORPH_MODELS.fastApply,
    signal,
    dryRun = false,
  } = options;

  const target = safeResolve(repoRoot, path);
  if (!target) {
    throw new Error(`Refusing to apply outside the repository: ${path}`);
  }

  const original = readFileSync(target, 'utf8');

  const completion = await morphPost<ChatCompletion>(
    '/v1/chat/completions',
    {
      model,
      messages: [
        {
          role: 'user',
          content:
            `<instruction>${instruction}</instruction>\n` +
            `<code>${original}</code>\n` +
            `<update>${update}</update>`,
        },
      ],
    },
    apiKey,
    signal,
  );

  const merged = completion.choices?.[0]?.message?.content;
  if (typeof merged !== 'string' || !merged.trim()) {
    throw new Error('Fast Apply returned an empty merge; file left untouched.');
  }
  // A merge that still contains the laziness marker means the model echoed the
  // snippet instead of merging it. Writing that would delete the real code.
  if (merged.includes(EXISTING_CODE_MARKER)) {
    throw new Error(
      'Fast Apply returned an unmerged result (it still contains the ' +
        '"existing code" marker); file left untouched.',
    );
  }

  const changed = merged !== original;
  if (changed && !dryRun) writeFileSync(target, merged, 'utf8');

  return {
    path,
    merged,
    original,
    changed,
    bytesBefore: Buffer.byteLength(original),
    bytesAfter: Buffer.byteLength(merged),
  };
};
