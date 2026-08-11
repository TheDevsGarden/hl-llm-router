/** Heuristic token estimator (conservative: 3 characters per token). */
export const estimateTokens = (text: string): number =>
  Math.ceil(text.length / 3);

/** Same estimate from a pre-computed char count (avoids re-measuring). */
export const estimateTokensFromChars = (chars: number): number =>
  Math.ceil(chars / 3);
