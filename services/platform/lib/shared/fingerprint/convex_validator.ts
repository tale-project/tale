/**
 * Convex validator-JSON → shape-IR adapter, plus the Convex-side rule table.
 *
 * Input nodes are `Validator.json` trees as `schema.export()` emits them:
 * `{ type: 'string' | 'union' | 'object' | 'id' | … , … }`. The adapter mirrors
 * the exact coercion points of the legacy classifier (`asRecord` at recursion
 * edges, raw node at the top) so every `Shape.sig` matches what the legacy
 * code compared — the committed `schema.snapshot.json` baseline depends on it.
 *
 * The rules encode why Convex disagrees with the Zod/JSON-Schema side: Convex
 * runs `schemaValidation: true`, so at push time every STORED ROW must
 * revalidate against the new schema — data that already exists is the thing
 * a change can break.
 */

import type { ClassifyRules } from './classify';
import {
  asRecord,
  canonical,
  type Shape,
  type ShapeProp,
  type ScalarConstraintValues,
} from './ir';

/** Convex validator nodes carry no scalar constraint keywords. */
const NO_CONSTRAINTS: ScalarConstraintValues = {
  minLength: undefined,
  maxLength: undefined,
  pattern: undefined,
  format: undefined,
  minimum: undefined,
  maximum: undefined,
  exclusiveMinimum: undefined,
  exclusiveMaximum: undefined,
  multipleOf: undefined,
};

/** Literal-value signatures if every member is a literal node, else null. */
function literalValuesOf(members: readonly unknown[]): Set<string> | null {
  const out = new Set<string>();
  for (const member of members) {
    const node = asRecord(member);
    if (node.type !== 'literal') return null;
    out.add(canonical(node.value));
  }
  return out;
}

/** `{ fieldName: { fieldType, optional } }` map → IR props (own keys only). */
function propsOf(
  value: Record<string, unknown>,
): ReadonlyMap<string, ShapeProp> {
  const props = new Map<string, ShapeProp>();
  for (const [key, field] of Object.entries(value)) {
    // The legacy classifier treated an `undefined` field entry as absent.
    if (field === undefined) continue;
    const entry = asRecord(field);
    props.set(key, {
      required: !entry.optional,
      shape: convexShape(asRecord(entry.fieldType)),
    });
  }
  return props;
}

/** Convert one Convex validator-JSON node into the shared shape IR. */
export function convexShape(node: unknown): Shape {
  const sig = canonical(node);
  const ft = asRecord(node);
  const type = typeof ft.type === 'string' ? ft.type : null;
  const types: ReadonlySet<string> =
    type === null ? new Set() : new Set([type]);

  if (type === 'any') return { kind: 'any', sig, types };
  if (type === 'literal') {
    return {
      kind: 'literals',
      sig,
      types,
      values: new Set([canonical(ft.value)]),
      memberSigs: [sig],
      base: undefined, // the Convex literal-widen rule never consults it
    };
  }
  if (type === 'union') {
    if (Array.isArray(ft.value)) {
      const memberSigs = ft.value.map((member) => canonical(member));
      const values = literalValuesOf(ft.value);
      if (values !== null) {
        // A union of only literals is a literal SET (subset-comparable).
        return {
          kind: 'literals',
          sig,
          types,
          values,
          memberSigs,
          base: undefined,
        };
      }
      return { kind: 'union', sig, types, memberSigs };
    }
    // Malformed union payload: compares as a single opaque member (legacy).
    return { kind: 'union', sig, types, memberSigs: [sig] };
  }
  if (type === 'array') {
    return {
      kind: 'array',
      sig,
      types,
      element: convexShape(asRecord(ft.value)),
      minItems: undefined,
      maxItems: undefined,
    };
  }
  if (type === 'object') {
    return { kind: 'object', sig, types, props: propsOf(asRecord(ft.value)) };
  }
  if (type === 'record') {
    return {
      kind: 'record',
      sig,
      types,
      keys: convexShape(asRecord(ft.keys)),
      values: convexShape(asRecord(asRecord(ft.values).fieldType)),
    };
  }
  if (type === 'id') return { kind: 'id', sig, types, table: ft.tableName };
  if (type !== null) {
    // string / number / float64 / int64 / boolean / null / bytes / …
    return { kind: 'scalar', sig, types, constraints: NO_CONSTRAINTS };
  }
  return { kind: 'opaque', sig, types };
}

/**
 * The Convex-side rule table. Each divergence cites the storage semantics
 * that force it; the twin table lives in `json_schema.ts`.
 */
export const convexValidatorRules: ClassifyRules = {
  // Convex side: rows already stored still CARRY a dropped field, and
  // `schemaValidation` revalidates them at push time → removal breaks.
  // (The Zod side is the inverse — parsers strip unknown keys.)
  removedProperty: 'breaking',

  literalsVsOpen(_a, b) {
    // Convex side: literal(s) → the open `string` validator is a widen. Any
    // other counterpart falls through to the union/kind checks — unlike the
    // JSON-Schema side, whose value-set branch decides every pairing.
    return b.kind === 'scalar' && b.types.has('string') ? 'safe' : null;
  },

  openVsLiterals(a, _b) {
    // Convex side: open `string` → a literal set narrows what rows may hold.
    // Other kinds fall through (a union baseline still gets the subset check).
    return a.kind === 'scalar' && a.types.has('string') ? 'breaking' : null;
  },

  kindGate(a, b) {
    // Convex side: validator nodes carry exactly one `type`, so only same-kind
    // array/object/id pairs recurse; any other pairing is a retype. `record`
    // deliberately does NOT recurse — the classifier has always treated a
    // non-identical record change as breaking (conservative), and the
    // committed baseline verdicts depend on that.
    if (
      a.kind === b.kind &&
      (a.kind === 'array' || a.kind === 'object' || a.kind === 'id')
    ) {
      return null;
    }
    return 'breaking';
  },

  scalarPair() {
    // Unreachable behind the kind gate (scalars never proceed); two same-type
    // Convex scalars are signature-equal, so a differing pair is a retype.
    return 'breaking';
  },

  arrayConstraints() {
    // Convex side: `v.array()` has no cardinality constraints.
    return 'same';
  },
};
