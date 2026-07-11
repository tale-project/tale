/**
 * Structural row validator over Convex's exported validator JSON — the chain
 * harness's "does the migrated world actually satisfy the CURRENT schema"
 * check, per document, with a precise error path. Interprets the same
 * `schema.export()` node forms `framework/schema_fingerprint.ts` fingerprints
 * (string/number/boolean/null/any/id/literal/union/array/object/record).
 *
 * Chosen over re-inserting rows into a strict convexTest probe (breaks
 * `v.id` references — the probe would mint different ids) and over the
 * fingerprint diff (compares schemas, not data). Known limit, by design:
 * `v.id(table)` is checked structurally as a string — id PROVENANCE can't be
 * verified without the live database.
 *
 * Two-dot basename: test-only, excluded from the Convex bundle.
 */

import type { FieldType, TableShape } from '../framework/schema_fingerprint';

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Validate one value against a validator-JSON node; null = valid. */
export function validateValue(
  value: unknown,
  ft: FieldType,
  path: string,
): string | null {
  const type = typeof ft.type === 'string' ? ft.type : '';
  switch (type) {
    case 'any':
      return null;
    case 'null':
      return value === null
        ? null
        : `${path}: expected null, got ${describe(value)}`;
    case 'string':
      return typeof value === 'string'
        ? null
        : `${path}: expected string, got ${describe(value)}`;
    case 'number':
      return typeof value === 'number'
        ? null
        : `${path}: expected number, got ${describe(value)}`;
    case 'boolean':
      return typeof value === 'boolean'
        ? null
        : `${path}: expected boolean, got ${describe(value)}`;
    case 'bigint':
    case 'int64':
      return typeof value === 'bigint'
        ? null
        : `${path}: expected bigint, got ${describe(value)}`;
    case 'id':
      return typeof value === 'string'
        ? null
        : `${path}: expected id(${String(ft.tableName)}) string, got ${describe(value)}`;
    case 'literal':
      return JSON.stringify(value) === JSON.stringify(ft.value)
        ? null
        : `${path}: expected literal ${JSON.stringify(ft.value)}, got ${JSON.stringify(value)}`;
    case 'union': {
      const members = Array.isArray(ft.value) ? ft.value : [];
      for (const member of members) {
        if (validateValue(value, member as FieldType, path) === null) {
          return null;
        }
      }
      return `${path}: no union member matches ${JSON.stringify(value)?.slice(0, 120)}`;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        return `${path}: expected array, got ${describe(value)}`;
      }
      for (let i = 0; i < value.length; i++) {
        const err = validateValue(
          value[i],
          ft.value as FieldType,
          `${path}[${i}]`,
        );
        if (err) return err;
      }
      return null;
    }
    case 'object': {
      if (!isRecordValue(value)) {
        return `${path}: expected object, got ${describe(value)}`;
      }
      const fields = isRecordValue(ft.value)
        ? (ft.value as Record<
            string,
            { fieldType: FieldType; optional?: boolean }
          >)
        : {};
      for (const [name, field] of Object.entries(fields)) {
        const child = value[name];
        if (child === undefined) {
          if (!field.optional) return `${path}.${name}: required field missing`;
          continue;
        }
        const err = validateValue(child, field.fieldType, `${path}.${name}`);
        if (err) return err;
      }
      for (const key of Object.keys(value)) {
        if (!(key in fields)) {
          return `${path}.${key}: field not declared in the schema`;
        }
      }
      return null;
    }
    case 'record': {
      if (!isRecordValue(value)) {
        return `${path}: expected record, got ${describe(value)}`;
      }
      const valueField = isRecordValue(ft.values)
        ? (ft.values as { fieldType: FieldType })
        : null;
      for (const [key, child] of Object.entries(value)) {
        const keyErr = validateValue(
          key,
          ft.keys as FieldType,
          `${path}<key ${key}>`,
        );
        if (keyErr) return keyErr;
        if (valueField) {
          const err = validateValue(
            child,
            valueField.fieldType,
            `${path}.${key}`,
          );
          if (err) return err;
        }
      }
      return null;
    }
    default:
      return `${path}: unknown validator node type "${type}" — extend schema_validate`;
  }
}

/**
 * Validate one document against a table's exported shape. System fields are
 * allowed; any other undeclared field fails — exactly what catches leftover
 * legacy fields a chain `up` failed to clean.
 */
export function validateDoc(
  doc: Record<string, unknown>,
  shape: TableShape,
  table: string,
): string | null {
  for (const [name, field] of Object.entries(shape)) {
    const value = doc[name];
    if (value === undefined) {
      if (!field.optional) return `${table}.${name}: required field missing`;
      continue;
    }
    const err = validateValue(value, field.ft, `${table}.${name}`);
    if (err) return err;
  }
  for (const key of Object.keys(doc)) {
    if (key === '_id' || key === '_creationTime') continue;
    if (!(key in shape)) {
      return `${table}.${key}: field not declared in the current schema`;
    }
  }
  return null;
}
