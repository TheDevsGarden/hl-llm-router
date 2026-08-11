export const parseCanonicalModelRef = (
  value: string,
): { provider: string; modelId: string } => {
  const slashIndex = value.indexOf('/');
  if (slashIndex === -1) {
    throw new Error(
      `Invalid model reference "${value}". Expected "provider/model".`,
    );
  }
  const provider = value.slice(0, slashIndex).trim();
  const modelId = value.slice(slashIndex + 1).trim();
  if (!provider || !modelId) {
    throw new Error(
      `Invalid model reference "${value}". Expected "provider/model".`,
    );
  }
  return { provider, modelId };
};

/**
 * Tolerant model-ref parse for cooldown bookkeeping — never throws.
 * Replaces three inline copies (provider, delegate, compaction).
 */
export const safeParseModelRef = (
  ref: string,
): { provider: string; modelId: string } | undefined => {
  try {
    return parseCanonicalModelRef(ref);
  } catch {
    return undefined;
  }
};
