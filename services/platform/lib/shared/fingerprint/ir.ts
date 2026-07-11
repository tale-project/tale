/**
 * Shared shape IR for the two schema-drift fingerprints.
 *
 * Two guards answer the same question over different schema languages: "does
 * this baseline→current schema change invalidate data that already exists?"
 *  - `convex/migrations/framework/schema_fingerprint.ts` — Convex validator
 *    JSON (`schema.export()`), stored rows revalidated at push time.
 *  - `lib/shared/config/config_fingerprint.ts` — JSON Schema rendered from the
 *    Zod config schemas, on-disk org config files revalidated at load time.
 *
 * This module is the common vocabulary: a normalized `Shape` tree both sides
 * adapt into, and the three-level verdict lattice the classifier speaks. The
 * classification itself lives in `classify.ts`; the per-language adapters (and
 * their deliberate rule divergences) in `convex_validator.ts` / `json_schema.ts`.
 *
 * Pure + V8-safe: no `node:*`, no runtime deps — `schema_fingerprint.ts` sits
 * in the Convex module graph, so everything it pulls in must bundle cleanly.
 */

/**
 * How a shape change affects already-stored data. `same` = structurally
 * identical; `safe` = every value valid under the old shape is still valid
 * (pure widening); `breaking` = some stored value could now fail validation.
 */
export type Verdict = 'same' | 'safe' | 'breaking';

/** Combine verdicts: the lattice max (`breaking` > `safe` > `same`). */
export function worst(a: Verdict, b: Verdict): Verdict {
  if (a === 'breaking' || b === 'breaking') return 'breaking';
  if (a === 'safe' || b === 'safe') return 'safe';
  return 'same';
}

/** Stable JSON (recursively key-sorted) — structural equality + set membership. */
export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/** Recursively sort object keys (arrays keep their order) — snapshot determinism. */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    for (const [key, val] of entries) out[key] = sortKeys(val);
    return out;
  }
  return value;
}

/** Coerce an untyped JSON node to a keyed object (guarded, never throws). */
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

export function isSubset(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): boolean {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// --- shape IR ----------------------------------------------------------------

interface ShapeBase {
  /**
   * Canonical signature of the SOURCE node (`canonical(rawNode)`). Signature
   * equality is the classifier's `same` test and the unit of union-member
   * comparison, so it must be computed from the raw language node — never from
   * the normalized IR — to stay bit-exact with the committed baselines.
   */
  readonly sig: string;
  /**
   * The source node's declared base type name(s). Convex nodes carry exactly
   * one; JSON Schema `type` may be a set (`["string","null"]`) or absent.
   * Consulted by the JSON-Schema rules (type-set gate, literal-widen targets).
   */
  readonly types: ReadonlySet<string>;
}

/** Accepts everything (`v.any()` / `z.any()`,`z.unknown()`). */
export interface AnyShape extends ShapeBase {
  readonly kind: 'any';
}

/** A finite set of allowed values (literal / union-of-literals / enum / const). */
export interface LiteralSetShape extends ShapeBase {
  readonly kind: 'literals';
  /** Canonical signature of each allowed value. */
  readonly values: ReadonlySet<string>;
  /**
   * Union-member signatures for the union-subset comparison: the raw member
   * sigs when the source node was a union of literals, else `[sig]`.
   */
  readonly memberSigs: readonly string[];
  /**
   * Broad base type of the allowed values. Only the JSON-Schema literal-widen
   * rule consults it (legacy: `a.enum ? 'string' : typeof a.const`); the
   * Convex adapter leaves it undefined — its rule never looks.
   */
  readonly base: string | undefined;
}

/** One-of over members, compared as a set of member signatures (no recursion). */
export interface UnionShape extends ShapeBase {
  readonly kind: 'union';
  readonly memberSigs: readonly string[];
}

export interface ArrayShape extends ShapeBase {
  readonly kind: 'array';
  readonly element: Shape;
  /** Raw cardinality keywords (JSON Schema only; Convex arrays have none). */
  readonly minItems: unknown;
  readonly maxItems: unknown;
}

export interface ShapeProp {
  readonly shape: Shape;
  readonly required: boolean;
}

/** Keyed fields with required flags. Own-key lookups only (a `Map`). */
export interface ObjectShape extends ShapeBase {
  readonly kind: 'object';
  readonly props: ReadonlyMap<string, ShapeProp>;
}

/**
 * String-keyed map with uniform key/value shapes (Convex `v.record()`). The
 * Convex rules deliberately never recurse into it — see `convex_validator.ts`.
 */
export interface RecordShape extends ShapeBase {
  readonly kind: 'record';
  readonly keys: Shape;
  readonly values: Shape;
}

/** A Convex `v.id(table)` reference; JSON Schema has no equivalent. */
export interface IdRefShape extends ShapeBase {
  readonly kind: 'id';
  /** Raw `tableName` value, compared by identity (legacy `===`). */
  readonly table: unknown;
}

/** Raw validation keywords a scalar may carry (JSON Schema only). */
export interface ScalarConstraintValues {
  readonly minLength: unknown;
  readonly maxLength: unknown;
  readonly pattern: unknown;
  readonly format: unknown;
  readonly minimum: unknown;
  readonly maximum: unknown;
  readonly exclusiveMinimum: unknown;
  readonly exclusiveMaximum: unknown;
  readonly multipleOf: unknown;
}

/** A primitive type, optionally constrained (`types` may be empty/multi). */
export interface ScalarShape extends ShapeBase {
  readonly kind: 'scalar';
  readonly constraints: ScalarConstraintValues;
}

/** An unmodeled node — only signature equality can prove it unchanged. */
export interface OpaqueShape extends ShapeBase {
  readonly kind: 'opaque';
}

export type Shape =
  | AnyShape
  | LiteralSetShape
  | UnionShape
  | ArrayShape
  | ObjectShape
  | RecordShape
  | IdRefShape
  | ScalarShape
  | OpaqueShape;
