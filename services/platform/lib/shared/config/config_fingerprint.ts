/**
 * Fingerprints the org-config Zod schemas and classifies baseline→current
 * drift — the engine behind the file-based-config "missing migration" guard
 * (`scripts/check-config-snapshot.ts`).
 *
 * Per-org config lives in JSON files under `$TALE_CONFIG_DIR/<org>/<domain>/`,
 * validated against the Zod schemas in `lib/shared/schemas/*`. When a schema
 * edit would make an already-written file fail that validation, the org needs
 * a `node` migration to reshape its files first. This module renders each
 * schema to JSON Schema (`z.toJSONSchema`), fingerprints the result, and
 * labels a schema-by-schema diff `safe` (no rewrite needed) or `breaking`
 * (rewrite first), so the guard can gate the build on the latter.
 *
 * Zod's break rules run OPPOSITE to Convex's on one point: `z.object`
 * silently strips unknown keys on parse, so removing a field or widening an
 * enum is safe, while adding a required field, retyping, narrowing an
 * enum/literal, flipping optional→required, or tightening a constraint all
 * break files written under the old shape.
 *
 * The actual shape comparison is delegated to the shared drift core in
 * `lib/shared/fingerprint/` (one classifier, swappable per-language rule
 * tables) — this module owns everything specific to the JSON-Schema storage
 * format: stripping descriptive annotations, serializing the snapshot, and
 * building the human-readable diff report. Its on-disk form must stay
 * byte-compatible with the committed `config.snapshot.json`.
 *
 * Two known gaps (by design, not bugs):
 *  - `z.toJSONSchema` renders a plain (strip) object and a `.strict()` object
 *    identically (`additionalProperties: false`), so this module cannot tell
 *    them apart. A removed field is always classified `safe` (true for the
 *    common strip case); the one case this misses is a field dropped from a
 *    genuinely `.strict()` schema — review those by hand.
 *  - `.refine()` / `.superRefine()` cross-field checks have no JSON Schema
 *    representation (`unrepresentable: 'any'` erases them), so a new
 *    refinement produces no visible diff here.
 *
 * Dependency-free by design (no `zod`, no `node:*`, no fs) so both the CLI
 * guard and its unit test can import it directly; the guard is the one that
 * renders the Zod schemas and hands this module plain JSON Schema.
 */

import { classifyShapes } from '../fingerprint/classify';
import { asRecord, sortKeys, type Verdict } from '../fingerprint/ir';
import {
  isObjectJsonSchema,
  jsonSchemaRules,
  jsonSchemaShape,
} from '../fingerprint/json_schema';

/** A JSON Schema node (`z.toJSONSchema` output, recursive, untyped). */
export type JsonSchema = Record<string, unknown>;

export interface ConfigFingerprint {
  /** "<schemaFile>.<exportName>" → its JSON Schema (annotations stripped). */
  readonly schemas: Record<string, JsonSchema>;
}

/** Descriptive keywords, not validation — excluded so a doc-only edit never reads as drift. */
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

/**
 * Keys whose value maps property NAMES to nested schemas. Those names are
 * config data, not schema keywords — a real field can be called `description`
 * or `default`, and stripping it here would hide genuine drift on that field
 * (a case the version-checkpoint corpus caught previously).
 */
const PROPERTY_MAP_KEYS = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
]);

/** Recursively remove annotation-only keywords so they never register as drift. */
function stripAnnotations(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripAnnotations);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (PROPERTY_MAP_KEYS.has(key) && value && typeof value === 'object') {
        const map: Record<string, unknown> = {};
        for (const [name, schema] of Object.entries(value)) {
          map[name] = stripAnnotations(schema);
        }
        out[key] = map;
        continue;
      }
      if (ANNOTATION_KEYS.has(key)) continue;
      out[key] = stripAnnotations(value);
    }
    return out;
  }
  return node;
}

/**
 * Build a fingerprint from `{ "<file>.<export>": <jsonSchema> }` — the guard
 * supplies each entry as `z.toJSONSchema(schema, { unrepresentable: 'any' })`.
 */
export function computeConfigFingerprint(
  raw: Record<string, JsonSchema>,
): ConfigFingerprint {
  const schemas: Record<string, JsonSchema> = {};
  for (const [key, js] of Object.entries(raw)) {
    schemas[key] = asRecord(stripAnnotations(js));
  }
  return { schemas };
}

// --- type-change classification --------------------------------------------

/** `safe` = everything the old shape accepted still validates; `breaking` = something no longer does. */
type ConfigVerdict = Verdict;

/**
 * Classify a single schema-node change. `safe` covers widening the accepted
 * set or loosening a constraint; `breaking` covers narrowing it — a value an
 * on-disk file already stores could now fail to parse.
 */
export function classifyJsonSchema(
  a: JsonSchema,
  b: JsonSchema,
): ConfigVerdict {
  return classifyShapes(
    jsonSchemaShape(a),
    jsonSchemaShape(b),
    jsonSchemaRules,
  );
}

// --- fingerprint diff -------------------------------------------------------

interface ConfigSchemaChange {
  readonly schema: string;
  readonly path?: string;
  readonly kind: 'safe' | 'breaking';
  readonly detail: string;
}

/**
 * Diff two fingerprints schema-by-schema. `breaking` entries need a `node`
 * migration to reshape existing on-disk files before the new schema can
 * validate them; `safe` entries need nothing.
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

    if (isObjectJsonSchema(o) && isObjectJsonSchema(n)) {
      diffObjectProps(schema, o, n, changes);
    } else {
      const verdict = classifyJsonSchema(o, n);
      if (verdict === 'breaking') {
        changes.push({
          schema,
          kind: 'breaking',
          detail: 'type narrowed/retyped/constrained',
        });
      } else if (verdict === 'safe') {
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
  const aProps = asRecord(a.properties);
  const bProps = asRecord(b.properties);
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
    const verdict = classifyJsonSchema(
      asRecord(aProps[path]),
      asRecord(bProps[path]),
    );
    if (verdict === 'breaking') {
      changes.push({
        schema,
        path,
        kind: 'breaking',
        detail: 'type narrowed/retyped or constraint tightened',
      });
    } else if (verdict === 'safe') {
      changes.push({ schema, path, kind: 'safe', detail: 'type widened' });
    }
  }
}

/** Deterministic JSON for the committed snapshot file (sorted keys, trailing newline). */
export function serializeConfigFingerprint(fp: ConfigFingerprint): string {
  return JSON.stringify(sortKeys(fp), null, 2) + '\n';
}
