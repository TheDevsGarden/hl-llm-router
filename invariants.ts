/**
 * Runtime guarantees for the routing path.
 *
 * These are invariants, not tests: conditions that must hold no matter the
 * input or state. They are cheap (O(n) over a chain of <= ~20 refs) and are
 * therefore always on, not debug-gated.
 *
 * Throwing is safe at every site they are used:
 *  - inside runClassifier, the throw is caught and that classifier returns
 *    undefined, so routing falls through to the next entry or to heuristics;
 *  - inside provider.ts, the outer handler turns it into a named stream error
 *    instead of routing somewhere wrong;
 *  - at module load, it fails at startup rather than mid-turn.
 *
 * A violation always means the router is internally inconsistent — degrading
 * loudly beats routing to a model the user believes is switched off.
 */
/**
 * The explicit type annotation is required: TypeScript rejects an `asserts`
 * signature on a `const` arrow function without one (TS2775).
 */
type Invariant = (cond: unknown, msg: string) => asserts cond;

export const invariant: Invariant = (cond, msg) => {
  if (!cond) {
    throw new Error(`Router invariant violated: ${msg}`);
  }
};
