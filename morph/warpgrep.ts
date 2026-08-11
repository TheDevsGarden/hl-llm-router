/**
 * WarpGrep — Morph's code-search subagent, driven as a local tool loop.
 *
 * Protocol (verified live 2026-08-08, not just from docs): you POST the repo
 * structure plus a natural-language query to /v1/chat/completions with model
 * `morph-warp-grep-v2.1`. The model's tools are built in — you do NOT send a
 * `tools` array. It replies with standard OpenAI `tool_calls`; you execute them
 * against the local filesystem and feed results back as `tool` messages. It
 * ends by calling `finish` with `path:lines` specs, which you read and return.
 *
 * SECURITY. Every tool argument here is attacker-influenced input: it is text
 * a remote model produced, and repo contents can steer that model. Two rules
 * follow, and both are load-bearing:
 *
 *   1. No shell. Morph's own reference client runs `list_directory`'s argument
 *      through `subprocess.run(command, shell=True)` — a remote model handing
 *      your shell a string. We parse it and run `ls`/`find` via argv instead.
 *   2. No escaping the repo. Every path is resolved and checked to live under
 *      repoRoot before it is opened.
 */

import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  MORPH_MODELS,
  morphPost,
  type ChatCompletion,
  type ChatToolCall,
} from './client';

export const MAX_TURNS = 6;
const MAX_GREP_LINES = 200;
const MAX_READ_LINES = 800;
const MAX_LIST_LINES = 200;
const MAX_GLOB_MATCHES = 100;
const MAX_TOOL_RESULT_CHARS = 30_000;
/** v2.1 has roughly a 135k-token window; stop feeding it well before that. */
const MAX_CONTEXT_CHARS = 540_000;

export interface WarpGrepContext {
  file: string;
  content: string;
}

export interface WarpGrepResult {
  contexts: WarpGrepContext[];
  turns: number;
  truncated: boolean;
}

/** Runs a command with an argv array — never a shell string. */
export type ExecFn = (
  command: string,
  args: string[],
  options?: { cwd?: string; signal?: AbortSignal },
) => Promise<{ stdout: string; stderr: string; code: number | null }>;

const clamp = (text: string, maxLines: number): string => {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text.slice(0, MAX_TOOL_RESULT_CHARS);
  return (
    lines.slice(0, maxLines).join('\n') +
    `\n\n... truncated (${lines.length} lines, limit ${maxLines})`
  ).slice(0, MAX_TOOL_RESULT_CHARS);
};

/**
 * Resolve a model-supplied path inside the repo, or undefined if it escapes.
 * Absolute paths are allowed only when they already point inside repoRoot.
 */
export const safeResolve = (
  repoRoot: string,
  candidate: string,
): string | undefined => {
  const root = resolve(repoRoot);
  const target = isAbsolute(candidate)
    ? resolve(candidate)
    : resolve(root, candidate);
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) return undefined;
  return target;
};

/**
 * `list_directory` arrives as a shell command string. Accept only a bare `ls`
 * or `find` with flag/path arguments, and reject anything carrying shell
 * metacharacters — that is where command chaining, substitution and
 * redirection would live.
 */
export const parseListCommand = (
  command: string,
): { bin: string; args: string[] } | undefined => {
  if (/[;&|`$(){}<>\n\\!*?[\]"']/.test(command)) return undefined;
  const parts = command.trim().split(/\s+/).filter(Boolean);
  const bin = parts[0];
  if (bin !== 'ls' && bin !== 'find') return undefined;
  return { bin, args: parts.slice(1) };
};

const executeGrep = async (
  repoRoot: string,
  args: Record<string, unknown>,
  exec: ExecFn,
  signal?: AbortSignal,
): Promise<string> => {
  const pattern = typeof args.pattern === 'string' ? args.pattern : '';
  if (!pattern) return 'Error: grep_search requires a pattern';
  const searchPath = safeResolve(repoRoot, String(args.path ?? '.'));
  if (!searchPath) return 'Error: path outside the repository';

  const argv = [
    '--line-number',
    '--no-heading',
    '--color',
    'never',
    '-i',
    '-C',
    '1',
  ];
  if (typeof args.glob === 'string' && args.glob) argv.push('--glob', args.glob);
  const limit = Number(args.limit);
  if (Number.isFinite(limit) && limit > 0) {
    argv.push('--max-count', String(Math.floor(limit)));
  }
  // `--` stops rg treating a model-chosen pattern that starts with `-` as flags.
  argv.push('--', pattern, searchPath);

  try {
    const { stdout } = await exec('rg', argv, { cwd: repoRoot, signal });
    const output = stdout.trim().split(resolve(repoRoot) + '/').join('');
    return output ? clamp(output, MAX_GREP_LINES) : 'no matches';
  } catch (error) {
    return `Error: ripgrep failed (${
      error instanceof Error ? error.message : String(error)
    }). Is rg installed?`;
  }
};

const selectLines = (all: string[], spec: string): string[] => {
  const picked: string[] = [];
  for (const part of spec.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.includes('-')) {
      const [rawStart, rawEnd] = trimmed.split('-', 2);
      const start = Number(rawStart);
      const end = Number(rawEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      for (let i = Math.max(1, start); i <= Math.min(end, all.length); i++) {
        picked.push(`${i}|${all[i - 1]}`);
      }
      continue;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n) && n >= 1 && n <= all.length) {
      picked.push(`${n}|${all[n - 1]}`);
    }
  }
  return picked;
};

export const readFileLines = (
  repoRoot: string,
  path: string,
  lines?: string,
): string => {
  const target = safeResolve(repoRoot, path);
  if (!target) return 'Error: path outside the repository';
  let raw: string;
  try {
    if (statSync(target).isDirectory()) return `Error: ${path} is a directory`;
    raw = readFileSync(target, 'utf8');
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
  const all = raw.split('\n').map((l) => l.replace(/\s+$/, ''));

  if (lines && lines !== '*') {
    return clamp(selectLines(all, lines).join('\n'), MAX_READ_LINES);
  }
  return clamp(
    all
      .slice(0, MAX_READ_LINES)
      .map((l, i) => `${i + 1}|${l}`)
      .join('\n'),
    MAX_READ_LINES,
  );
};

const executeTool = async (
  repoRoot: string,
  name: string,
  args: Record<string, unknown>,
  exec: ExecFn,
  signal?: AbortSignal,
): Promise<string> => {
  switch (name) {
    case 'grep_search':
    case 'ripgrep':
    case 'grep':
      return executeGrep(repoRoot, args, exec, signal);

    case 'read':
      return readFileLines(
        repoRoot,
        String(args.path ?? ''),
        typeof args.lines === 'string' ? args.lines : undefined,
      );

    case 'list_directory': {
      const raw = String(args.command ?? args.path ?? '.');
      const parsed = parseListCommand(raw);
      if (!parsed) {
        // Not a command we will run: fall back to listing whatever path it meant.
        const dir = safeResolve(repoRoot, raw.trim() || '.');
        if (!dir) return 'Error: path outside the repository';
        const { stdout } = await exec('ls', ['-1', dir], {
          cwd: repoRoot,
          signal,
        });
        return clamp(stdout.trim() || 'empty directory', MAX_LIST_LINES);
      }
      const { stdout } = await exec(parsed.bin, parsed.args, {
        cwd: repoRoot,
        signal,
      });
      return clamp(stdout.trim() || 'empty directory', MAX_LIST_LINES);
    }

    case 'glob': {
      const pattern = String(args.pattern ?? '');
      if (!pattern) return 'Error: glob requires a pattern';
      const base = safeResolve(repoRoot, String(args.path ?? '.'));
      if (!base) return 'Error: path outside the repository';
      // rg --files honours .gitignore, which plain globbing does not.
      const { stdout } = await exec(
        'rg',
        ['--files', '--glob', pattern, base],
        { cwd: repoRoot, signal },
      );
      const matches = stdout.trim().split('\n').filter(Boolean);
      if (!matches.length) return 'no matches';
      const root = resolve(repoRoot) + '/';
      return matches
        .slice(0, MAX_GLOB_MATCHES)
        .map((m) => (m.startsWith(root) ? m.slice(root.length) : m))
        .join('\n');
    }

    default:
      return `Error: unsupported tool ${name}`;
  }
};

/** `finish` sends "path:lines" per line; `*` or a bare path means whole file. */
export const parseFinishFiles = (
  spec: string,
): { path: string; lines?: string }[] => {
  const out: { path: string; lines?: string }[] = [];
  for (const line of spec.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.lastIndexOf(':');
    if (idx === -1) {
      out.push({ path: trimmed });
      continue;
    }
    const path = trimmed.slice(0, idx);
    const lines = trimmed.slice(idx + 1).trim();
    out.push(lines && lines !== '*' ? { path, lines } : { path });
  }
  return out;
};

const parseArguments = (call: ChatToolCall): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(call.function.arguments || '{}');
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

/**
 * Run the search. `repoStructure` is a flat newline-separated list of paths —
 * the model wants no tree formatting.
 */
export const warpGrepSearch = async (options: {
  query: string;
  repoRoot: string;
  repoStructure: string;
  apiKey: string;
  exec: ExecFn;
  signal?: AbortSignal;
  onTurn?: (turn: number, toolNames: string[]) => void;
}): Promise<WarpGrepResult> => {
  const { query, repoRoot, repoStructure, apiKey, exec, signal, onTurn } =
    options;

  const messages: Record<string, unknown>[] = [
    {
      role: 'user',
      content: `<repo_structure>\n${repoStructure}\n</repo_structure>\n\n<search_string>\n${query}\n</search_string>`,
    },
  ];

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const completion = await morphPost<ChatCompletion>(
      '/v1/chat/completions',
      {
        model: MORPH_MODELS.warpGrep,
        messages,
        temperature: 0,
        max_tokens: 2048,
      },
      apiKey,
      signal,
    );

    const message = completion.choices?.[0]?.message;
    const calls = message?.tool_calls ?? [];
    if (!calls.length) {
      return { contexts: [], turns: turn, truncated: false };
    }
    onTurn?.(
      turn,
      calls.map((c) => c.function.name),
    );

    const finishCall = calls.find((c) => c.function.name === 'finish');
    if (finishCall) {
      const spec = String(parseArguments(finishCall).files ?? '');
      const contexts = parseFinishFiles(spec)
        .map(({ path, lines }) => ({
          file: path,
          content: readFileLines(repoRoot, path, lines),
        }))
        .filter((c) => !c.content.startsWith('Error:'));
      return { contexts, turns: turn, truncated: false };
    }

    messages.push({
      role: 'assistant',
      content: message?.content ?? '',
      tool_calls: calls,
    });

    for (const call of calls) {
      const result = await executeTool(
        repoRoot,
        call.function.name,
        parseArguments(call),
        exec,
        signal,
      );
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result,
      });
    }

    const size = messages.reduce(
      (sum, m) => sum + String(m.content ?? '').length,
      0,
    );
    if (size > MAX_CONTEXT_CHARS) {
      return { contexts: [], turns: turn, truncated: true };
    }
  }

  return { contexts: [], turns: MAX_TURNS, truncated: true };
};
