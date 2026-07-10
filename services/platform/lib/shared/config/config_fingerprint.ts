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
 * The classification itself is the shared shape-drift core in
 * `lib/shared/fingerprint/` (one classifier, per-language rule tables); this
 * facade owns the JSON-Schema storage format — annotation stripping, the
 * snapshot serialization, and the diff report — which stays byte-compatible
 * with the committed `config.snapshot.json`.
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

/**
 * Build a fingerprint from `{ "<file>.<export>": <jsonSchema> }`. The guard
 * renders each Zod schema with `z.toJSONSchema(s, { unrepresentable: 'any' })`.
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

/** `safe` = every value valid before is still valid; `breaking` = some isn't. */
type ConfigVerdict = Verdict;

/**
 * Classify a schema-node change. `safe` widens the accepted set / loosens a
 * constraint; `breaking` narrows it (an existing stored value could now fail).
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

    if (isObjectJsonSchema(o) && isObjectJsonSchema(n)) {
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
    const v = classifyJsonSchema(
      asRecord(aProps[path]),
      asRecord(bProps[path]),
    );
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
