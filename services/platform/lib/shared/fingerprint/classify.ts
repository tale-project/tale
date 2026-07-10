/**
 * The one recursive shape-drift classifier, shared by the Convex-schema and
 * config-schema fingerprints. It walks two `Shape` trees (see `ir.ts`) and
 * answers: does the baseline→current change invalidate already-stored data?
 *
 * The walk order is load-bearing — it reproduces, branch for branch, the two
 * legacy classifiers this replaced (`classifyType` in `schema_fingerprint.ts`
 * and `classifyJsonSchema` in `config_fingerprint.ts`), whose verdicts the
 * committed baselines and CI guards depend on:
 *
 *   1. signature equality → `same`
 *   2. `any` on either side (widening to it is safe, from it breaks)
 *   3. literal-set × literal-set → subset logic
 *   4. literal-set × open shape → per-language rule (may fall through)
 *   5. union on either side → member-signature subset (no recursion)
 *   6. per-language kind gate (retypes; JSON Schema type-set widening)
 *   7. structural recursion: object props / array element / id target / scalar
 *
 * Everywhere the two languages deliberately disagree, the decision is a
 * `ClassifyRules` hook — the rule tables live next to their adapters
 * (`convex_validator.ts`, `json_schema.ts`), each divergence cited there.
 */

import {
  isSubset,
  worst,
  type ArrayShape,
  type LiteralSetShape,
  type ObjectShape,
  type ScalarShape,
  type Shape,
  type Verdict,
} from './ir';

/**
 * The deliberate divergences between the two schema languages. Hooks returning
 * `Verdict | null` use `null` for "no opinion — keep evaluating" (fall through
 * to the later shared steps).
 */
export interface ClassifyRules {
  /**
   * Verdict for a property present in the baseline object but missing from the
   * current one. Convex: `breaking` — stored rows still carry the field, so
   * the push-time revalidation fails. Zod/JSON Schema: `safe` — `z.object()`
   * strips unknown keys, so existing files still parse.
   */
  readonly removedProperty: Verdict;
  /** Baseline is a literal set, current is not (and not `any`). */
  literalsVsOpen(a: LiteralSetShape, b: Shape): Verdict | null;
  /** Current is a literal set, baseline is not (and not `any`). */
  openVsLiterals(a: Shape, b: LiteralSetShape): Verdict | null;
  /**
   * Kind/base-type compatibility gate before structural recursion. Return a
   * verdict to stop (retype, type-set widening), or `null` to recurse.
   */
  kindGate(a: Shape, b: Shape): Verdict | null;
  /** Two scalars of the same base type(s) that are not signature-equal. */
  scalarPair(a: ScalarShape, b: ScalarShape): Verdict;
  /** Array cardinality constraints (`minItems`/`maxItems`), combined via `worst`. */
  arrayConstraints(a: ArrayShape, b: ArrayShape): Verdict;
}

/** Member signatures for the union-subset comparison (single shape → itself). */
function memberSigs(shape: Shape): ReadonlySet<string> {
  if (shape.kind === 'union' || shape.kind === 'literals') {
    return new Set(shape.memberSigs);
  }
  return new Set([shape.sig]);
}

/**
 * Classify a baseline→current shape change. `safe` = every stored value valid
 * under `a` is still valid under `b`; `breaking` = some value may now fail.
 */
export function classifyShapes(
  a: Shape,
  b: Shape,
  rules: ClassifyRules,
): Verdict {
  if (a.sig === b.sig) return 'same';

  // `any` accepts everything: widening TO it is safe, narrowing FROM it is not.
  if (b.kind === 'any') return 'safe';
  if (a.kind === 'any') return 'breaking';

  if (a.kind === 'literals' && b.kind === 'literals') {
    if (isSubset(a.values, b.values)) {
      return a.values.size === b.values.size ? 'same' : 'safe';
    }
    return 'breaking'; // a value the old set allowed was removed
  }
  if (a.kind === 'literals') {
    const ruled = rules.literalsVsOpen(a, b);
    if (ruled !== null) return ruled;
  } else if (b.kind === 'literals') {
    const ruled = rules.openVsLiterals(a, b);
    if (ruled !== null) return ruled;
  }

  // Unions compare as member-signature sets: a grown set is a widen, a shrunk
  // or reshaped one breaks. Members are never recursed into (legacy contract).
  if (a.kind === 'union' || b.kind === 'union') {
    return isSubset(memberSigs(a), memberSigs(b)) ? 'safe' : 'breaking';
  }

  const gated = rules.kindGate(a, b);
  if (gated !== null) return gated;

  if (a.kind === 'object' && b.kind === 'object') {
    return classifyProps(a, b, rules);
  }
  if (a.kind === 'array' && b.kind === 'array') {
    return worst(
      classifyShapes(a.element, b.element, rules),
      rules.arrayConstraints(a, b),
    );
  }
  if (a.kind === 'id' && b.kind === 'id') {
    return a.table === b.table ? 'same' : 'breaking';
  }
  if (a.kind === 'scalar' && b.kind === 'scalar') {
    return rules.scalarPair(a, b);
  }

  // Unmodeled or mismatched kinds past the gate: a stored value may no longer
  // validate — conservative.
  return 'breaking';
}

/** Object property recursion — shared except for the removed-property rule. */
function classifyProps(
  a: ObjectShape,
  b: ObjectShape,
  rules: ClassifyRules,
): Verdict {
  let verdict: Verdict = 'same';
  for (const key of new Set([...a.props.keys(), ...b.props.keys()])) {
    const ap = a.props.get(key);
    const bp = b.props.get(key);
    if (ap === undefined && bp !== undefined) {
      // Added property: required → old data lacks it; optional → safe growth.
      verdict = worst(verdict, bp.required ? 'breaking' : 'safe');
    } else if (ap !== undefined && bp === undefined) {
      verdict = worst(verdict, rules.removedProperty);
    } else if (ap !== undefined && bp !== undefined) {
      if (!ap.required && bp.required) {
        verdict = 'breaking'; // optional → required tightens
      } else if (ap.required && !bp.required) {
        verdict = worst(verdict, 'safe');
      }
      verdict = worst(verdict, classifyShapes(ap.shape, bp.shape, rules));
    }
  }
  return verdict;
}
