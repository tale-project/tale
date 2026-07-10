/**
 * JSON-Schema → shape-IR adapter, plus the Zod/JSON-Schema-side rule table.
 *
 * Input nodes are `z.toJSONSchema(schema, { unrepresentable: 'any' })` output
 * (annotations already stripped by the fingerprint). The adapter mirrors the
 * exact coercion points of the legacy classifier (`asRecord` at recursion
 * edges, raw node at the top) so every `Shape.sig` matches what the legacy
 * code compared — the committed `config.snapshot.json` baseline depends on it.
 *
 * The rules encode why this side disagrees with Convex: config files are
 * revalidated by Zod on LOAD, and `z.object()` strips unknown keys — so a
 * removed field is harmless while a tightened constraint breaks files that
 * already exist on disk.
 */

import type { ClassifyRules } from './classify';
import {
  asRecord,
  canonical,
  isSubset,
  worst,
  type ArrayShape,
  type ScalarShape,
  type Shape,
  type ShapeProp,
  type Verdict,
} from './ir';

/** The `type` keyword as a set (`type` may be a string, a list, or absent). */
function typeSetOf(s: Record<string, unknown>): ReadonlySet<string> {
  if (Array.isArray(s.type)) return new Set(s.type.map((t) => String(t)));
  if (typeof s.type === 'string') return new Set([s.type]);
  return new Set();
}

/** True when every named type is numeric (vacuously true for an empty set). */
const numLike = (t: ReadonlySet<string>): boolean =>
  [...t].every((x) => x === 'number' || x === 'integer');

/** Allowed-value signatures for an `enum`/`const` schema, else null. */
function valueSetOf(s: Record<string, unknown>): Set<string> | null {
  if (Array.isArray(s.enum)) return new Set(s.enum.map((v) => canonical(v)));
  if ('const' in s) return new Set([canonical(s.const)]);
  return null;
}

/** `properties` + `required` → IR props (own keys only). */
function propsOf(s: Record<string, unknown>): ReadonlyMap<string, ShapeProp> {
  const props = new Map<string, ShapeProp>();
  const properties = asRecord(s.properties);
  const required = new Set(
    Array.isArray(s.required) ? s.required.map(String) : [],
  );
  for (const key of Object.keys(properties)) {
    props.set(key, {
      required: required.has(key),
      shape: jsonSchemaShape(asRecord(properties[key])),
    });
  }
  return props;
}

/** Convert one JSON-Schema node into the shared shape IR. */
export function jsonSchemaShape(node: unknown): Shape {
  const sig = canonical(node);
  const s = asRecord(node);
  const types = typeSetOf(s);

  // `z.any()` / `z.unknown()` (and rendered-away refinements) emit `{}`.
  if (Object.keys(s).length === 0) return { kind: 'any', sig, types };

  const values = valueSetOf(s);
  if (values !== null) {
    return {
      kind: 'literals',
      sig,
      types,
      values,
      memberSigs: [sig],
      // Legacy widen-target base: enums are strings, a const keeps its type.
      base: s.enum ? 'string' : typeof s.const,
    };
  }

  // Truthiness (not is-array) is the legacy union trigger; a non-array payload
  // compares as a single opaque member.
  if (s.anyOf || s.oneOf) {
    const members = Array.isArray(s.anyOf)
      ? s.anyOf
      : Array.isArray(s.oneOf)
        ? s.oneOf
        : null;
    return {
      kind: 'union',
      sig,
      types,
      memberSigs: members ? members.map((m) => canonical(m)) : [sig],
    };
  }

  if (types.has('object')) {
    return { kind: 'object', sig, types, props: propsOf(s) };
  }
  if (types.has('array')) {
    return {
      kind: 'array',
      sig,
      types,
      element: jsonSchemaShape(asRecord(s.items)),
      minItems: s.minItems,
      maxItems: s.maxItems,
    };
  }
  // Everything else — string/number/boolean/null, multi-type, or typeless —
  // is a scalar; `scalarPair` dispatches on `types` exactly as the legacy
  // string/numLike chain did (a typeless node lands in the numeric branch).
  return {
    kind: 'scalar',
    sig,
    types,
    constraints: {
      minLength: s.minLength,
      maxLength: s.maxLength,
      pattern: s.pattern,
      format: s.format,
      minimum: s.minimum,
      maximum: s.maximum,
      exclusiveMinimum: s.exclusiveMinimum,
      exclusiveMaximum: s.exclusiveMaximum,
      multipleOf: s.multipleOf,
    },
  };
}

/** True when the node is an object schema (used by the per-property diff). */
export function isObjectJsonSchema(node: unknown): boolean {
  const s = asRecord(node);
  return typeSetOf(s).has('object') || 'properties' in s;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

function tighterLooser(
  oldMin: number,
  newMin: number,
  oldMax: number,
  newMax: number,
): Verdict {
  if (newMin > oldMin || newMax < oldMax) return 'breaking'; // narrowed range
  if (newMin < oldMin || newMax > oldMax) return 'safe'; // widened range
  return 'same';
}

function stringConstraints(a: ScalarShape, b: ScalarShape): Verdict {
  const ac = a.constraints;
  const bc = b.constraints;
  let verdict = tighterLooser(
    num(ac.minLength, 0),
    num(bc.minLength, 0),
    num(ac.maxLength, Infinity),
    num(bc.maxLength, Infinity),
  );
  // pattern/format: adding or changing one rejects previously-valid values.
  if (canonical(ac.pattern) !== canonical(bc.pattern)) {
    verdict = worst(verdict, bc.pattern === undefined ? 'safe' : 'breaking');
  }
  if (canonical(ac.format) !== canonical(bc.format)) {
    verdict = worst(verdict, bc.format === undefined ? 'safe' : 'breaking');
  }
  return verdict === 'same' ? 'breaking' : verdict; // a≠b but nothing classified
}

function numberConstraints(a: ScalarShape, b: ScalarShape): Verdict {
  const ac = a.constraints;
  const bc = b.constraints;
  const aMin = num(ac.minimum, num(ac.exclusiveMinimum, -Infinity));
  const bMin = num(bc.minimum, num(bc.exclusiveMinimum, -Infinity));
  const aMax = num(ac.maximum, num(ac.exclusiveMaximum, Infinity));
  const bMax = num(bc.maximum, num(bc.exclusiveMaximum, Infinity));
  let verdict = tighterLooser(aMin, bMin, aMax, bMax);
  if (canonical(ac.multipleOf) !== canonical(bc.multipleOf)) {
    verdict = worst(verdict, bc.multipleOf === undefined ? 'safe' : 'breaking');
  }
  // integer↔number is decided by the kind gate's type-set compare.
  return verdict === 'same' ? 'breaking' : verdict;
}

/**
 * The Zod/JSON-Schema-side rule table. Each divergence cites the storage
 * semantics that force it; the twin table lives in `convex_validator.ts`.
 */
export const jsonSchemaRules: ClassifyRules = {
  // Zod side: `z.object()` STRIPS unknown keys when parsing, so a property
  // removed from the schema leaves existing on-disk files valid. (The Convex
  // side is the inverse — stored rows still carry the field.)
  removedProperty: 'safe',

  literalsVsOpen(a, b) {
    // Zod side: enum/const → a broader plain type of a compatible base is a
    // widen; every other counterpart (unions included) is a narrow/retype.
    // This branch decides ALL pairings — it never falls through, unlike the
    // Convex side. Faithful to the legacy check, including its numeric
    // catch-all (`numLike`) for const-of-number → number/integer widening.
    if (
      b.types.size > 0 &&
      (b.types.has('string') ||
        (a.base !== undefined && b.types.has(a.base)) ||
        numLike(b.types))
    ) {
      return 'safe';
    }
    return 'breaking';
  },

  openVsLiterals() {
    // Zod side: ANY open type narrowed to a value set breaks existing files.
    // Decides before the union check (legacy branch order) — so even a union
    // baseline collapsing to an enum is breaking, where Convex would give the
    // member-subset comparison a chance.
    return 'breaking';
  },

  kindGate(a, b) {
    // JSON-Schema side: `type` may be a SET (`["string","null"]`) — growing it
    // is a widen, shrinking it breaks; equal sets recurse. Convex nodes carry
    // exactly one type, so its gate is a plain kind-equality check instead.
    if (canonical([...a.types].sort()) !== canonical([...b.types].sort())) {
      return isSubset(a.types, b.types) ? 'safe' : 'breaking';
    }
    return null;
  },

  scalarPair(a, b) {
    // Zod side only: scalar CONSTRAINTS (min/max/pattern/format/multipleOf)
    // are validation — tightening breaks on-disk files, loosening is safe.
    // Convex validators carry no constraints, so its side never gets here.
    if (a.types.has('string')) return stringConstraints(a, b);
    if (numLike(a.types)) return numberConstraints(a, b);
    // Same non-string/number type differing some other validating way (e.g.
    // a boolean with an unknown keyword) — conservative.
    return 'breaking';
  },

  arrayConstraints(a: ArrayShape, b: ArrayShape) {
    // Zod side only: array cardinality is validation like any constraint.
    return tighterLooser(
      num(a.minItems, 0),
      num(b.minItems, 0),
      num(a.maxItems, Infinity),
      num(b.maxItems, Infinity),
    );
  },
};
