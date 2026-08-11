/**
 * Compact — Morph's context-compression model.
 *
 * Its own endpoint, /v1/compact, not chat completions. Verified live
 * 2026-08-08: it returns the compressed text plus the line ranges it dropped,
 * so the result is auditable rather than an opaque summary.
 *
 * This is lossy *filtering*, not summarization: it removes lines judged
 * irrelevant to `query` and marks the gaps. Compressing a small input can
 * legitimately return it unchanged with ratio 1.0 — there was nothing to drop.
 */

import { MORPH_MODELS, morphPost } from './client';

/** Aggressive at 0.3, light at 0.7. Morph's default is 0.5. */
export const DEFAULT_COMPRESSION_RATIO = 0.5;
/** Trailing messages left untouched so the live thread stays intact. */
export const DEFAULT_PRESERVE_RECENT = 2;

export interface CompactUsage {
  input_tokens: number;
  output_tokens: number;
  compression_ratio: number;
  processing_time_ms: number;
}

export interface CompactResponse {
  id: string;
  object: string;
  model: string;
  output: string;
  messages?: {
    role: string;
    content: string;
    compacted_line_ranges?: { start: number; end: number }[];
    kept_line_ranges?: { start: number; end: number }[];
  }[];
  usage: CompactUsage;
}

export const compactText = async (options: {
  input: string | { role: string; content: string }[];
  apiKey: string;
  /** Relevance filter. Omitted, Morph infers it from the last user message. */
  query?: string;
  compressionRatio?: number;
  preserveRecent?: number;
  compressSystemMessages?: boolean;
  signal?: AbortSignal;
}): Promise<CompactResponse> => {
  const {
    input,
    apiKey,
    query,
    compressionRatio = DEFAULT_COMPRESSION_RATIO,
    preserveRecent = DEFAULT_PRESERVE_RECENT,
    compressSystemMessages = false,
    signal,
  } = options;

  return morphPost<CompactResponse>(
    '/v1/compact',
    {
      model: MORPH_MODELS.compact,
      input,
      ...(query ? { query } : {}),
      compression_ratio: compressionRatio,
      preserve_recent: preserveRecent,
      compress_system_messages: compressSystemMessages,
      include_line_ranges: true,
      include_markers: true,
    },
    apiKey,
    signal,
  );
};

/** "1,240 -> 380 tokens (69% saved, 109ms)" for the tool result line. */
export const formatCompactUsage = (usage: CompactUsage): string => {
  const saved = Math.round((1 - usage.compression_ratio) * 100);
  return (
    `${usage.input_tokens.toLocaleString()} -> ` +
    `${usage.output_tokens.toLocaleString()} tokens ` +
    `(${saved}% saved, ${usage.processing_time_ms}ms)`
  );
};
