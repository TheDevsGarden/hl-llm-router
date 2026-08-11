/**
 * Sigil matching for routing rules: `#opus`, `#r1`, `#q38`, `#k2.7`.
 *
 * Sigils are identifiers, not prose, and nearly every sigil rule is
 * `final: true` — a false positive hard-pins a model for the turn with no
 * classifier override. So they get two properties plain substring matching
 * cannot give:
 *
 *   1. EXACT TOKEN. `#r1` fires on `#r1` and not on `#r10`, `#r1x`, `#r1_b`
 *      or `foo#r1`. `String.includes` matched every one of those.
 *   2. NOT INSIDE CODE. Sigils in fenced blocks or inline code spans are
 *      quoted text, not instructions, and never match.
 *
 * Provenance — the sigil must be in something the *user typed* — is enforced
 * one layer up, by `getHumanPromptText` in ./extract and the `input`-event
 * capture in ../index.ts.
 *
 * Non-sigil keywords (`plan the`, `ultrathink`, the EXPLICIT_*_HINTS lists)
 * keep plain substring semantics. They are prose, they are not `final`, and
 * tightening them would change tier selection across the board.
 */

const SIGIL_PREFIX = '#';

/**
 * Characters that can carry on an identifier. Unicode-aware so a sigil
 * followed by a non-ASCII letter is a continuation, not a boundary.
 */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

/**
 * Characters that may not sit immediately before a sigil. Word chars block
 * `foo#r1`; `#` blocks `##r1`; `/` blocks a URL fragment like
 * `example.com/docs#r1`.
 */
const isBlockedBefore = (char: string): boolean =>
  WORD_CHAR.test(char) || char === SIGIL_PREFIX || char === '/';

/**
 * True when the sigil keeps going past `at`, so the hit is a prefix of a
 * longer token rather than a match.
 *
 * `.` and `-` count as continuations only when a word char follows, which is
 * what separates the sigil `#k2.7` (so `#k2` must not match it) from ordinary
 * sentence punctuation (`use #r1.` and `#r1-` still match).
 */
const continuesPast = (text: string, at: number): boolean => {
  const next = text[at];
  if (next === undefined) return false;
  if (WORD_CHAR.test(next)) return true;
  if (next !== '.' && next !== '-') return false;
  const after = text[at + 1];
  return after !== undefined && WORD_CHAR.test(after);
};

/** A keyword is a sigil when it is `#` followed by at least one character. */
export const isSigil = (keyword: string): boolean =>
  keyword.length > 1 && keyword.startsWith(SIGIL_PREFIX);

/**
 * Fenced blocks and inline code spans, replaced by a space so the surrounding
 * words do not fuse. The `(?:```|$)` tail makes an *unterminated* fence — a
 * half-pasted snippet — swallow the rest of the message rather than being
 * ignored entirely.
 */
const CODE_SPANS: readonly RegExp[] = [
  /```[\s\S]*?(?:```|$)/g,
  /~~~[\s\S]*?(?:~~~|$)/g,
  /`[^`\n]*`/g,
];

export const stripCodeSpans = (text: string): string =>
  CODE_SPANS.reduce((acc, pattern) => acc.replace(pattern, ' '), text);

/** Exact-token search for a `#sigil`. Both arguments must already be lowercased. */
export const matchesSigil = (text: string, keyword: string): boolean => {
  let from = 0;
  for (;;) {
    const at = text.indexOf(keyword, from);
    if (at === -1) return false;
    const before = at > 0 ? text[at - 1] : undefined;
    const isBounded =
      (before === undefined || !isBlockedBefore(before)) &&
      !continuesPast(text, at + keyword.length);
    if (isBounded) return true;
    // Keep scanning: an earlier prefix hit does not rule out a later real one,
    // e.g. "#r10 is wrong, use #r1".
    from = at + 1;
  }
};

/**
 * True when any keyword hits. Sigils match as exact tokens outside code spans;
 * everything else falls back to plain substring. The stripped copy is built at
 * most once per call, and only when a sigil is actually checked.
 */
export const containsAny = (
  text: string,
  keywords: readonly string[],
): boolean => {
  let stripped: string | undefined;
  return keywords.some((keyword) => {
    if (!isSigil(keyword)) return text.includes(keyword);
    if (stripped === undefined) stripped = stripCodeSpans(text);
    return matchesSigil(stripped, keyword);
  });
};
