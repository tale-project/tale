/**
 * Config-schema fingerprint + drift classifier — the engine behind the
 * file-based-config "missing migration" guard (`scripts/check-config-snapshot.ts`).
 *
 * Per-org config lives in JSON files under `$TALE_CONFIG_DIR/<org>/<domain>/`,
 * validated by the Zod schemas in `lib/shared/schemas/*`. A change to one of
 * those schemas that makes existing on-disk files FAIL validation needs a `node`
 * migration to rewrite the files first. This module turns each schema's JSON
 * Schema (`z.toJSONSchema`) into a fingerprint and classifies a baseline→current
 * diff as `safe` or `breaking`, so the guard can fail the build on changes that
 * need a migration and wave through the ones that don't.
 *
 * Zod break-rules are the INVERSE of Convex on one point: `z.object` STRIPS
 * unknown keys by default, so a REMOVED field and a WIDENED enum are safe; a new
 * REQUIRED field, a real retype, a NARROWED enum/literal, optional→required, or
 * a TIGHTENED constraint break existing files.
 *
 * Known limitations (documented, not bugs):
 *  - `z.toJSONSchema` renders both strip (default) AND `.strict()` objects as
 *    `additionalProperties: false`, so they are indistinguishable here. We treat
 *    a removed field as SAFE (the dominant strip case) and do NOT detect a
 *    `.strict()` transition. A field removed from a genuinely-`.strict()` schema
 *    is the one breaking case this guard cannot see — judge those by hand.
 *  - `.refine()`/`.superRefine()` cross-field rules are not representable in JSON
 *    Schema (rendered away by `unrepresentable: 'any'`), so a new refinement is
 *    invisible here.
 *
 * Pure + dependency-free: no `zod`, no `node:*`, no fs — imported by both the CLI
 * guard and its unit test. The guard supplies already-rendered JSON Schemas.
 */

/** A JSON Schema node (`z.toJSONSchema` output, recursive, untyped). */
export type JsonSchema = Record<string, unknown>;

export interface ConfigFingerprint {
  /** "<schemaFile>.<exportName>" → its JSON Schema (annotations stripped). */
  readonly schemas: Record<string, JsonSchema>;
}

/** Keywords that describe, not validate — ignored so doc edits aren't "drift". */
const ANNOTATION_KEYS = new Set([
  '$schema',
  '$id',
  'id',
  'title',
  'description',
  'default',
  'examples',
  'readOnly',
  'writeOnly',
  'deprecated',
]);

function asObj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

/** Recursively drop annotation-only keywords so they never read as drift. */
function stripAnnotations(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripAnnotations);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (ANNOTATION_KEYS.has(k)) continue;
      out[k] = stripAnnotations(v);
    }
    return out;
  }
  return node;
}

/** Stable JSON (recursively key-sorted) — structural equality + set membership. */
function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    for (const [k, v] of entries) out[k] = sortKeys(v);
    return out;
  }
  return value;
}

/**
 * Build a fingerprint from `{ "<file>.<export>": <jsonSchema> }`. The guard
 * renders each Zod schema with `z.toJSONSchema(s, { unrepresentable: 'any' })`.
 */
export function computeConfigFingerprint(
  raw: Record<string, JsonSchema>,
): ConfigFingerprint {
  const schemas: Record<string, JsonSchema> = {};
  for (const [key, js] of Object.entries(raw)) {
    schemas[key] = asObj(stripAnnotations(js));
  }
  return { schemas };
}

// --- type-change classification --------------------------------------------

/** `safe` = every value valid before is still valid; `breaking` = some isn't. */
type ConfigVerdict = 'same' | 'safe' | 'breaking';

function worst(a: ConfigVerdict, b: ConfigVerdict): ConfigVerdict {
  if (a === 'breaking' || b === 'breaking') return 'breaking';
  if (a === 'safe' || b === 'safe') return 'safe';
  return 'same';
}

/** True for an unconstrained schema (`z.any()`/`z.unknown()` → `{}`). */
function isAny(s: JsonSchema): boolean {
  return Object.keys(s).length === 0;
}

/** Allowed-value set for an `enum`/`const` schema, else null. */
function valueSet(s: JsonSchema): Set<string> | null {
  if (Array.isArray(s.enum)) return new Set(s.enum.map((v) => canonical(v)));
  if ('const' in s) return new Set([canonical(s.const)]);
  return null;
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** Canonical signatures of an `anyOf` union's members (single → one-element). */
function unionMembers(s: JsonSchema): string[] {
  if (Array.isArray(s.anyOf)) return s.anyOf.map((m) => canonical(m));
  if (Array.isArray(s.oneOf)) return s.oneOf.map((m) => canonical(m));
  return [canonical(s)];
}

function typeSet(s: JsonSchema): Set<string> {
  if (Array.isArray(s.type)) return new Set(s.type.map((t) => String(t)));
  if (typeof s.type === 'string') return new Set([s.type]);
  return new Set();
}

const numLike = (t: Set<string>): boolean =>
  [...t].every((x) => x === 'number' || x === 'integer');

/**
 * Classify a schema-node change. `safe` widens the accepted set / loosens a
 * constraint; `breaking` narrows it (an existing stored value could now fail).
 */
export function classifyJsonSchema(
  a: JsonSchema,
  b: JsonSchema,
): ConfigVerdict {
  if (canonical(a) === canonical(b)) return 'same';

  if (isAny(b)) return 'safe'; // now accepts anything
  if (isAny(a)) return 'breaking'; // was anything, now constrained

  const la = valueSet(a);
  const lb = valueSet(b);
  if (la && lb) {
    if (isSubset(la, lb)) return la.size === lb.size ? 'same' : 'safe';
    return 'breaking'; // a value the old set allowed was removed
  }
  // enum/const → broader plain type of a compatible base is a widen; reverse narrows.
  if (la && !lb) {
    const tb = typeSet(b);
    const enumType = a.enum ? 'string' : typeof a.const; // const may be non-string
    if (
      tb.size > 0 &&
      (tb.has('string') || tb.has(enumType) || numLike(tb)) &&
      !valueSet(b)
    ) {
      return 'safe';
    }
    return 'breaking';
  }
  if (!la && lb) return 'breaking'; // open type → narrowed to a value set

  // Unions (anyOf/oneOf): a grown member set is a widen, a shrunk one breaks.
  if (a.anyOf || b.anyOf || a.oneOf || b.oneOf) {
    const ma = new Set(unionMembers(a));
    const mb = new Set(unionMembers(b));
    return isSubset(ma, mb) ? 'safe' : 'breaking';
  }

  const ta = typeSet(a);
  const tb = typeSet(b);
  if (canonical([...ta].sort()) !== canonical([...tb].sort())) {
    // type widened (old types ⊆ new types) is safe; otherwise a retype.
    return isSubset(ta, tb) ? 'safe' : 'breaking';
  }

  if (ta.has('object')) return classifyObject(a, b);
  if (ta.has('array')) {
    return worst(
      classifyJsonSchema(asObj(a.items), asObj(b.items)),
      arrayConstraints(a, b),
    );
  }
  if (ta.has('string')) return stringConstraints(a, b);
  if (numLike(ta)) return numberConstraints(a, b);

  // Same type, differ in some other validating way (e.g. format) → conservative.
  return 'breaking';
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

function tighterLooser(
  oldMin: number,
  newMin: number,
  oldMax: number,
  newMax: number,
): ConfigVerdict {
  if (newMin > oldMin || newMax < oldMax) return 'breaking'; // narrowed range
  if (newMin < oldMin || newMax > oldMax) return 'safe'; // widened range
  return 'same';
}

function stringConstraints(a: JsonSchema, b: JsonSchema): ConfigVerdict {
  let verdict = tighterLooser(
    num(a.minLength, 0),
    num(b.minLength, 0),
    num(a.maxLength, Infinity),
    num(b.maxLength, Infinity),
  );
  // pattern/format: adding or changing one rejects previously-valid values.
  if (canonical(a.pattern) !== canonical(b.pattern)) {
    verdict = worst(verdict, b.pattern === undefined ? 'safe' : 'breaking');
  }
  if (canonical(a.format) !== canonical(b.format)) {
    verdict = worst(verdict, b.format === undefined ? 'safe' : 'breaking');
  }
  return verdict === 'same' ? 'breaking' : verdict; // a≠b but nothing classified
}

function numberConstraints(a: JsonSchema, b: JsonSchema): ConfigVerdict {
  const aMin = num(a.minimum, num(a.exclusiveMinimum, -Infinity));
  const bMin = num(b.minimum, num(b.exclusiveMinimum, -Infinity));
  const aMax = num(a.maximum, num(a.exclusiveMaximum, Infinity));
  const bMax = num(b.maximum, num(b.exclusiveMaximum, Infinity));
  let verdict = tighterLooser(aMin, bMin, aMax, bMax);
  if (canonical(a.multipleOf) !== canonical(b.multipleOf)) {
    verdict = worst(verdict, b.multipleOf === undefined ? 'safe' : 'breaking');
  }
  // integer↔number handled by the type compare upstream.
  return verdict === 'same' ? 'breaking' : verdict;
}

function arrayConstraints(a: JsonSchema, b: JsonSchema): ConfigVerdict {
  return tighterLooser(
    num(a.minItems, 0),
    num(b.minItems, 0),
    num(a.maxItems, Infinity),
    num(b.maxItems, Infinity),
  );
}

function classifyObject(a: JsonSchema, b: JsonSchema): ConfigVerdict {
  const aProps = asObj(a.properties);
  const bProps = asObj(b.properties);
  const aReq = new Set(Array.isArray(a.required) ? a.required.map(String) : []);
  const bReq = new Set(Array.isArray(b.required) ? b.required.map(String) : []);
  let verdict: ConfigVerdict = 'same';
  for (const key of new Set([...Object.keys(aProps), ...Object.keys(bProps)])) {
    const inA = key in aProps;
    const inB = key in bProps;
    if (!inA && inB) {
      verdict = worst(verdict, bReq.has(key) ? 'breaking' : 'safe');
    } else if (inA && !inB) {
      verdict = worst(verdict, 'safe'); // removed field: Zod strips (strip default)
    } else {
      if (!aReq.has(key) && bReq.has(key))
        verdict = 'breaking'; // optional→required
      else if (aReq.has(key) && !bReq.has(key))
        verdict = worst(verdict, 'safe');
      verdict = worst(
        verdict,
        classifyJsonSchema(asObj(aProps[key]), asObj(bProps[key])),
      );
    }
  }
  return verdict;
}

// --- fingerprint diff -------------------------------------------------------

interface ConfigSchemaChange {
  readonly schema: string;
  readonly path?: string;
  readonly kind: 'safe' | 'breaking';
  readonly detail: string;
}

function isObjectSchema(s: JsonSchema): boolean {
  return typeSet(s).has('object') || 'properties' in s;
}

/**
 * Diff two config fingerprints. `breaking` changes need a `node` migration to
 * rewrite existing on-disk files before they can validate; `safe` ones do not.
 */
export function diffConfigFingerprints(
  baseline: ConfigFingerprint,
  current: ConfigFingerprint,
): ConfigSchemaChange[] {
  const changes: ConfigSchemaChange[] = [];
  const keys = new Set([
    ...Object.keys(baseline.schemas),
    ...Object.keys(current.schemas),
  ]);

  for (const schema of [...keys].sort()) {
    const o = baseline.schemas[schema];
    const n = current.schemas[schema];
    if (o && !n) {
      changes.push({ schema, kind: 'safe', detail: 'schema removed' });
      continue;
    }
    if (!o && n) {
      changes.push({ schema, kind: 'safe', detail: 'new schema' });
      continue;
    }
    if (!o || !n) continue;

    if (isObjectSchema(o) && isObjectSchema(n)) {
      diffObjectProps(schema, o, n, changes);
    } else {
      const v = classifyJsonSchema(o, n);
      if (v === 'breaking') {
        changes.push({
          schema,
          kind: 'breaking',
          detail: 'type narrowed/retyped/constrained',
        });
      } else if (v === 'safe') {
        changes.push({ schema, kind: 'safe', detail: 'widened' });
      }
    }
  }
  return changes;
}

function diffObjectProps(
  schema: string,
  a: JsonSchema,
  b: JsonSchema,
  changes: ConfigSchemaChange[],
): void {
  const aProps = asObj(a.properties);
  const bProps = asObj(b.properties);
  const aReq = new Set(Array.isArray(a.required) ? a.required.map(String) : []);
  const bReq = new Set(Array.isArray(b.required) ? b.required.map(String) : []);

  for (const path of [
    ...new Set([...Object.keys(aProps), ...Object.keys(bProps)]),
  ].sort()) {
    const inA = path in aProps;
    const inB = path in bProps;

    if (!inA && inB) {
      const required = bReq.has(path);
      changes.push({
        schema,
        path,
        kind: required ? 'breaking' : 'safe',
        detail: required
          ? 'new required field (old files lack it → validation fails)'
          : 'new optional field',
      });
      continue;
    }
    if (inA && !inB) {
      changes.push({
        schema,
        path,
        kind: 'safe',
        detail: 'field removed (Zod strips unknown keys by default)',
      });
      continue;
    }
    if (!aReq.has(path) && bReq.has(path)) {
      changes.push({
        schema,
        path,
        kind: 'breaking',
        detail: 'optional → required (old files may omit it → fails)',
      });
      continue;
    }
    if (aReq.has(path) && !bReq.has(path)) {
      changes.push({
        schema,
        path,
        kind: 'safe',
        detail: 'required → optional',
      });
    }
    const v = classifyJsonSchema(asObj(aProps[path]), asObj(bProps[path]));
    if (v === 'breaking') {
      changes.push({
        schema,
        path,
        kind: 'breaking',
        detail: 'type narrowed/retyped or constraint tightened',
      });
    } else if (v === 'safe') {
      changes.push({ schema, path, kind: 'safe', detail: 'type widened' });
    }
  }
}

/** Deterministic JSON for the committed snapshot file (sorted keys, trailing \n). */
export function serializeConfigFingerprint(fp: ConfigFingerprint): string {
  return JSON.stringify(sortKeys(fp), null, 2) + '\n';
}
