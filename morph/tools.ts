/**
 * The three Morph tools, registered with pi so any profile can call them.
 *
 * They are deliberately profile-independent: the router picks which *model*
 * runs the turn, while these are capabilities the turn can reach for, whatever
 * model that is. `/router morphtools disable` takes them out of the active set
 * via pi's setActiveTools, so the model stops seeing them immediately — no
 * restart, and no half-state where a tool is advertised but refuses to run.
 */

import { Type } from 'typebox';
import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { MORPH_MODELS, resolveMorphKey } from './client';
import { warpGrepSearch, type ExecFn } from './warpgrep';
import { fastApply } from './apply';
import { compactText, formatCompactUsage } from './compact';

export const MORPH_TOOL_NAMES = [
  'codebase_search',
  'fast_apply',
  'compact_context',
] as const;

/** Files listed for the search subagent. Bounded so huge trees stay usable. */
const MAX_REPO_FILES = 4_000;

const text = (value: string) => ({
  content: [{ type: 'text' as const, text: value }],
  details: undefined,
});

const failure = (value: string) => ({
  content: [{ type: 'text' as const, text: value }],
  details: undefined,
  isError: true,
});

/**
 * A flat, newline-separated file list. `rg --files` honours .gitignore, which
 * keeps node_modules and build output out of the model's view for free.
 */
const buildRepoStructure = async (
  exec: ExecFn,
  repoRoot: string,
  signal?: AbortSignal,
): Promise<string> => {
  const { stdout } = await exec('rg', ['--files'], { cwd: repoRoot, signal });
  const files = stdout.split('\n').filter(Boolean);
  return files.slice(0, MAX_REPO_FILES).join('\n');
};

export interface MorphToolsState {
  enabled: boolean;
}

/**
 * Register all three tools and return a setter that flips their visibility.
 * Registration always happens; visibility is what the toggle controls.
 */
export const registerMorphTools = (
  pi: ExtensionAPI,
  state: MorphToolsState,
): ((enabled: boolean) => void) => {
  // Restricted hosts (older pi, some subagent contexts) may not expose the tool
  // registry. The router's job is routing; losing three optional tools must
  // never be what stops a session from starting.
  if (typeof pi.registerTool !== 'function') {
    state.enabled = false;
    return (enabled: boolean) => {
      state.enabled = enabled;
    };
  }

  const exec: ExecFn = async (command, args, options) => {
    const result = await pi.exec(command, args, {
      cwd: options?.cwd,
      signal: options?.signal,
    } as Parameters<ExtensionAPI['exec']>[2]);
    return {
      stdout: (result as { stdout?: string }).stdout ?? '',
      stderr: (result as { stderr?: string }).stderr ?? '',
      code: (result as { code?: number | null }).code ?? null,
    };
  };

  const keyOrError = (): { key: string } | { error: string } => {
    const key = resolveMorphKey(getAgentDir());
    if (!key) {
      return {
        error:
          'No Morph API key. Set MORPH_API_KEY, or add PI_KEY_MORPH to keys.env ' +
          'and re-run install.sh so providers.morph.apiKey is materialized.',
      };
    }
    return { key };
  };

  pi.registerTool({
    name: 'codebase_search',
    label: 'Codebase Search',
    description:
      'Search this codebase with a natural-language question and get back the ' +
      'relevant code. Runs as a separate search agent in its own context, so it ' +
      'does not consume yours. Ask in plain English ("How does auth work?", ' +
      '"Where is the retry logic?") — this is NOT regex and NOT keyword search; ' +
      'do not pass grep patterns to it.',
    promptSnippet:
      'codebase_search — natural-language code search over the whole repo.',
    parameters: Type.Object({
      query: Type.String({
        description:
          'A plain-English question about the codebase. Not a regex, not keywords.',
      }),
      path: Type.Optional(
        Type.String({
          description: 'Directory to search in. Defaults to the project root.',
        }),
      ),
    }),
    execute: async (_id, params, signal, _onUpdate, ctx: ExtensionContext) => {
      const resolved = keyOrError();
      if ('error' in resolved) return failure(resolved.error);

      const repoRoot = params.path
        ? `${ctx.cwd}/${params.path}`.replace(/\/+$/, '')
        : ctx.cwd;
      try {
        const structure = await buildRepoStructure(exec, repoRoot, signal);
        if (!structure) {
          return failure(
            'No files found to search. Is ripgrep (rg) installed and is this a repo?',
          );
        }
        const result = await warpGrepSearch({
          query: params.query,
          repoRoot,
          repoStructure: structure,
          apiKey: resolved.key,
          exec,
          signal,
        });
        if (!result.contexts.length) {
          return text(
            result.truncated
              ? `No results (search hit its ${result.turns}-turn budget).`
              : 'No relevant code found.',
          );
        }
        const body = result.contexts
          .map((c) => `--- ${c.file} ---\n${c.content}`)
          .join('\n\n');
        return text(
          `Found ${result.contexts.length} relevant file(s) in ${result.turns} turn(s):\n\n${body}`,
        );
      } catch (error) {
        return failure(
          `codebase_search failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  });

  pi.registerTool({
    name: 'fast_apply',
    label: 'Fast Apply',
    description:
      'Apply an edit to a file by describing only what changes. Write the edit ' +
      'snippet with "// ... existing code ..." standing in for every untouched ' +
      'region — do not reproduce the whole file. A merge model splices it in at ' +
      '~10,500 tok/s. Best for large files where a full rewrite is wasteful.',
    promptSnippet:
      'fast_apply — apply a lazy edit snippet to a file without rewriting it.',
    parameters: Type.Object({
      path: Type.String({
        description: 'File to edit, relative to the project root.',
      }),
      instruction: Type.String({
        description:
          'One first-person sentence describing the change, e.g. "I am adding error handling".',
      }),
      update: Type.String({
        description:
          'The edit snippet. Include only changed regions; use "// ... existing code ..." for the rest.',
      }),
      dry_run: Type.Optional(
        Type.Boolean({
          description: 'Return the merged result without writing to disk.',
        }),
      ),
    }),
    execute: async (_id, params, signal, _onUpdate, ctx: ExtensionContext) => {
      const resolved = keyOrError();
      if ('error' in resolved) return failure(resolved.error);
      try {
        const result = await fastApply({
          repoRoot: ctx.cwd,
          path: params.path,
          instruction: params.instruction,
          update: params.update,
          apiKey: resolved.key,
          signal,
          dryRun: params.dry_run === true,
        });
        if (!result.changed) {
          return text(`No change: the merge matched ${result.path} exactly.`);
        }
        const verb = params.dry_run
          ? 'Merged (dry run, not written)'
          : 'Applied';
        return text(
          `${verb} to ${result.path} — ${result.bytesBefore} -> ${result.bytesAfter} bytes.` +
            (params.dry_run ? `\n\n${result.merged}` : ''),
        );
      } catch (error) {
        return failure(
          `fast_apply failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  });

  pi.registerTool({
    name: 'compact_context',
    label: 'Compact',
    description:
      'Compress long text — a file, a log, a transcript — down to the parts ' +
      'relevant to a query, keeping the original wording and marking what was ' +
      'dropped. Use before feeding something large into your own reasoning. ' +
      'This does not compact the pi session itself; that is /router compact.',
    promptSnippet:
      'compact_context — filter long text down to what is relevant to a query.',
    parameters: Type.Object({
      input: Type.String({ description: 'The text to compress.' }),
      query: Type.Optional(
        Type.String({
          description:
            'What to keep relevance against. Omit to let Morph infer it.',
        }),
      ),
      compression_ratio: Type.Optional(
        Type.Number({
          description:
            'Target reduction: 0.3 aggressive, 0.5 default, 0.7 light.',
          minimum: 0.1,
          maximum: 0.95,
        }),
      ),
    }),
    execute: async (_id, params, signal) => {
      const resolved = keyOrError();
      if ('error' in resolved) return failure(resolved.error);
      try {
        const result = await compactText({
          input: params.input,
          apiKey: resolved.key,
          query: params.query,
          compressionRatio: params.compression_ratio,
          preserveRecent: 0,
          signal,
        });
        return text(`${formatCompactUsage(result.usage)}\n\n${result.output}`);
      } catch (error) {
        return failure(
          `compact_context failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  });

  const setEnabled = (enabled: boolean): void => {
    state.enabled = enabled;
    if (
      typeof pi.getActiveTools !== 'function' ||
      typeof pi.setActiveTools !== 'function'
    ) {
      return;
    }
    const active = pi.getActiveTools();
    // setActiveTools REPLACES the whole set. An empty read means pi has not
    // populated it yet, and writing our three names then would strip read,
    // bash, edit and everything else — the agent comes up with no tools and
    // hangs. registerTool already leaves these active, so doing nothing here
    // is both safe and correct.
    if (!active.length) return;

    const next = enabled
      ? [...new Set([...active, ...MORPH_TOOL_NAMES])]
      : active.filter(
          (name) => !(MORPH_TOOL_NAMES as readonly string[]).includes(name),
        );
    if (!next.length) return;
    pi.setActiveTools(next);
  };

  // Deliberately NOT called here. setActiveTools is an action method, and pi
  // throws "Extension runtime not initialized" if an action runs during
  // loading. registerTool is the only part that is legal at load time; the
  // caller applies visibility once session_start has fired.
  return setEnabled;
};

export { MORPH_MODELS };
