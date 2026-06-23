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
 * Pure + V8-safe: no `node:*`, no Convex runtime — imported by both the CLI
 * guard and its unit test.
 */

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

/** Stable JSON (recursively key-sorted) — for structural equality + set membership. */
export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
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
function asFt(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
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

function isType(ft: FieldType, type: string): boolean {
  return ft?.type === type;
}

/** Literal value set if `ft` is a single literal or a union of only literals; else null. */
function literalSet(ft: FieldType): Set<string> | null {
  if (isType(ft, 'literal')) return new Set([canonical(ft.value)]);
  if (isType(ft, 'union') && Array.isArray(ft.value)) {
    const out = new Set<string>();
    for (const m of ft.value) {
      const mf = asFt(m);
      if (!isType(mf, 'literal')) return null;
      out.add(canonical(mf.value));
    }
    return out;
  }
  return null;
}

/** Canonical signatures of a union's members (single type → one-element list). */
function unionMembers(ft: FieldType): string[] {
  if (isType(ft, 'union') && Array.isArray(ft.value)) {
    return ft.value.map((m) => canonical(m));
  }
  return [canonical(ft)];
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * Classify a field's type change. `widen` = every value valid under the old
 * type is still valid under the new one (safe for existing rows); `incompatible`
 * = some old value would now fail validation (needs a migration).
 */
export function classifyType(a: FieldType, b: FieldType): TypeVerdict {
  if (canonical(a) === canonical(b)) return 'same';

  // `any` accepts everything: narrowing TO any is safe, FROM any is not.
  if (isType(b, 'any')) return 'widen';
  if (isType(a, 'any')) return 'incompatible';

  const la = literalSet(a);
  const lb = literalSet(b);
  if (la && lb) {
    if (isSubset(la, lb)) return la.size === lb.size ? 'same' : 'widen';
    return 'incompatible'; // a literal the old set allowed was removed
  }
  // literal(s) → open string is a widen; the reverse narrows.
  if (la && isType(b, 'string')) return 'widen';
  if (isType(a, 'string') && lb) return 'incompatible';

  // Unions of non-literals (e.g. union of objects): a grew member set is a widen.
  if (isType(a, 'union') || isType(b, 'union')) {
    const ma = new Set(unionMembers(a));
    const mb = new Set(unionMembers(b));
    return isSubset(ma, mb) ? 'widen' : 'incompatible';
  }

  if (isType(a, 'array') && isType(b, 'array')) {
    return classifyType(asFt(a.value), asFt(b.value));
  }
  if (isType(a, 'object') && isType(b, 'object')) {
    return classifyObject(asFt(a.value), asFt(b.value));
  }
  if (isType(a, 'id') && isType(b, 'id')) {
    return a.tableName === b.tableName ? 'same' : 'incompatible';
  }

  // Same primitive but not canonically equal, or a different `type` entirely
  // (string→number, id→string, …): a stored value may no longer validate.
  return 'incompatible';
}

function worst(a: TypeVerdict, b: TypeVerdict): TypeVerdict {
  if (a === 'incompatible' || b === 'incompatible') return 'incompatible';
  if (a === 'widen' || b === 'widen') return 'widen';
  return 'same';
}

/** `fieldType` of an `{ fieldType, optional }` field entry (guarded). */
function fieldTypeOf(field: unknown): FieldType {
  return asFt(asFt(field).fieldType);
}
/** `optional` flag of an `{ fieldType, optional }` field entry (guarded). */
function optionalOf(field: unknown): boolean {
  return Boolean(asFt(field).optional);
}

/** `a`/`b` are object field-maps: `{ fieldName: { fieldType, optional } }`. */
function classifyObject(a: FieldType, b: FieldType): TypeVerdict {
  let verdict: TypeVerdict = 'same';
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const af = a[key];
    const bf = b[key];
    if (af === undefined) {
      // Added nested field: required → breaks old rows; optional → safe growth.
      verdict = worst(verdict, optionalOf(bf) ? 'widen' : 'incompatible');
    } else if (bf === undefined) {
      verdict = 'incompatible'; // nested field dropped
    } else {
      if (optionalOf(af) && !optionalOf(bf))
        verdict = 'incompatible'; // tightened
      else if (!optionalOf(af) && optionalOf(bf))
        verdict = worst(verdict, 'widen');
      verdict = worst(verdict, classifyType(fieldTypeOf(af), fieldTypeOf(bf)));
    }
  }
  return verdict;
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
