/**
 * Schema fingerprint + drift classifier — the engine behind the "missing
 * migration" guard (`scripts/check-schema-snapshot.ts`).
 *
 * Convex runs `schemaValidation: true`, so at push time EVERY stored row must
 * validate against the new schema. A schema change that makes existing rows
 * invalid (a field dropped/renamed/retyped, a required field added, a union
 * narrowed) needs a data migration to reshape rows FIRST — otherwise the deploy
 * fails. New tables, new optional fields, and widened unions are data-safe.
 *
 * This module turns `schema.export()` (Convex's canonical JSON) into a compact
 * per-field fingerprint and classifies a baseline→current diff as `safe` or
 * `incompatible`, so the guard can fail the build on the changes that need a
 * migration and wave through the ones that don't.
 *
 * The classification itself is the shared shape-drift core in
 * `lib/shared/fingerprint/` (one classifier, per-language rule tables); this
 * facade owns the Convex storage format — parsing `schema.export()`, the
 * snapshot serialization, and the diff report — which stays byte-compatible
 * with the committed `schema.snapshot.json`.
 *
 * Pure + V8-safe: no `node:*`, no Convex runtime — imported by both the CLI
 * guard and its unit test.
 */

import { classifyShapes } from '../../../lib/shared/fingerprint/classify';
import {
  convexShape,
  convexValidatorRules,
} from '../../../lib/shared/fingerprint/convex_validator';
import { sortKeys, type Verdict } from '../../../lib/shared/fingerprint/ir';

export { canonical } from '../../../lib/shared/fingerprint/ir';

/** A Convex `Validator.json` node from `schema.export()` (recursive, untyped). */
export type FieldType = Record<string, unknown>;

export interface FieldShape {
  /** The field's full type tree (captures unions, ids, arrays, nesting). */
  readonly ft: FieldType;
  readonly optional: boolean;
}

export type TableShape = Record<string, FieldShape>;

export interface SchemaFingerprint {
  readonly schemaValidation: boolean;
  readonly tables: Record<string, TableShape>;
}

/** Shape of one table entry in the JSON `schema.export()` produces. */
interface ExportedTable {
  tableName: string;
  documentType?: { type?: string; value?: Record<string, ExportedField> };
}
interface ExportedField {
  fieldType: FieldType;
  optional: boolean;
}

/** Build a fingerprint from `schema.export()` output (JSON string or parsed). */
export function computeFingerprint(
  exported: string | { tables?: ExportedTable[]; schemaValidation?: boolean },
): SchemaFingerprint {
  const obj: { tables?: ExportedTable[]; schemaValidation?: boolean } =
    typeof exported === 'string' ? JSON.parse(exported) : exported;
  const tables: Record<string, TableShape> = {};
  for (const t of obj.tables ?? []) {
    const fields: TableShape = {};
    for (const [name, def] of Object.entries(t.documentType?.value ?? {})) {
      fields[name] = { ft: def.fieldType, optional: def.optional };
    }
    tables[t.tableName] = fields;
  }
  return { schemaValidation: obj.schemaValidation !== false, tables };
}

// --- type-change classification -------------------------------------------

/** How a field type changed between baseline and current. */
export type TypeVerdict = 'same' | 'widen' | 'incompatible';

/** Shared-core verdicts in this module's historical vocabulary. */
const TYPE_VERDICTS: Record<Verdict, TypeVerdict> = {
  same: 'same',
  safe: 'widen',
  breaking: 'incompatible',
};

/**
 * Classify a field's type change. `widen` = every value valid under the old
 * type is still valid under the new one (safe for existing rows); `incompatible`
 * = some old value would now fail validation (needs a migration).
 */
export function classifyType(a: FieldType, b: FieldType): TypeVerdict {
  return TYPE_VERDICTS[
    classifyShapes(convexShape(a), convexShape(b), convexValidatorRules)
  ];
}

// --- fingerprint diff -------------------------------------------------------

export interface SchemaChange {
  readonly table: string;
  readonly field?: string;
  readonly kind: 'safe' | 'incompatible';
  readonly detail: string;
}

/**
 * Diff two fingerprints. `incompatible` changes need a data migration before
 * they can deploy; `safe` changes do not.
 */
export function diffFingerprints(
  baseline: SchemaFingerprint,
  current: SchemaFingerprint,
): SchemaChange[] {
  const changes: SchemaChange[] = [];
  const tableNames = new Set([
    ...Object.keys(baseline.tables),
    ...Object.keys(current.tables),
  ]);

  for (const table of [...tableNames].sort()) {
    const oldT = baseline.tables[table];
    const newT = current.tables[table];

    if (oldT && !newT) {
      changes.push({ table, kind: 'incompatible', detail: 'table dropped' });
      continue;
    }
    if (!oldT && newT) {
      changes.push({ table, kind: 'safe', detail: 'new table' });
      continue;
    }
    if (!oldT || !newT) continue;

    for (const field of [
      ...new Set([...Object.keys(oldT), ...Object.keys(newT)]),
    ].sort()) {
      const oldF = oldT[field];
      const newF = newT[field];

      if (oldF && !newF) {
        changes.push({
          table,
          field,
          kind: 'incompatible',
          detail: 'field dropped (rows still carry it → push fails)',
        });
        continue;
      }
      if (!oldF && newF) {
        changes.push({
          table,
          field,
          kind: newF.optional ? 'safe' : 'incompatible',
          detail: newF.optional
            ? 'new optional field'
            : 'new required field (old rows lack it → push fails)',
        });
        continue;
      }
      if (!oldF || !newF) continue;

      if (oldF.optional && !newF.optional) {
        changes.push({
          table,
          field,
          kind: 'incompatible',
          detail: 'optional → required (old rows missing it → push fails)',
        });
        continue;
      }

      const verdict = classifyType(oldF.ft, newF.ft);
      if (verdict === 'incompatible') {
        changes.push({
          table,
          field,
          kind: 'incompatible',
          detail: 'type narrowed/retyped (some old values no longer validate)',
        });
      } else if (verdict === 'widen') {
        changes.push({
          table,
          field,
          kind: 'safe',
          detail: 'type widened',
        });
      } else if (!oldF.optional !== !newF.optional) {
        // optionality loosened, type unchanged
        changes.push({
          table,
          field,
          kind: 'safe',
          detail: 'required → optional',
        });
      }
    }
  }
  return changes;
}

/** Deterministic JSON for the committed snapshot file (sorted keys, trailing \n). */
export function serializeFingerprint(fp: SchemaFingerprint): string {
  return JSON.stringify(sortKeys(fp), null, 2) + '\n';
}
