import { TRIGGER_WRAPPER_KEYS } from '@tale/shared/schemas/automation-trigger';

import { parseFixedInput } from './trigger-draft';

/**
 * A trigger's fixed input, as the person filling it sees it: which fields
 * the automation's inputs require that the trigger itself does not send,
 * and the text with typed placeholders for them.
 */

/** A top-level field an input lacks, and the type its schema gives it. */
export interface MissingInputField {
  name: string;
  /** The JSON Schema `type`, when it names exactly one. */
  type: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The fields an `inputs` schema requires at the top that `input` does not
 * have, in the schema's order. Empty when the schema requires nothing or
 * `input` is no object.
 */
export function missingRequiredFields(
  schema: Record<string, unknown> | undefined,
  input: unknown,
): MissingInputField[] {
  if (schema === undefined || !isRecord(input)) return [];
  const required = Array.isArray(schema.required) ? schema.required : [];
  const properties = isRecord(schema.properties) ? schema.properties : {};
  return required
    .filter((name): name is string => typeof name === 'string')
    .filter((name) => !Object.hasOwn(input, name))
    .map((name) => {
      const property = properties[name];
      const type = isRecord(property) ? property.type : undefined;
      return { name, type: typeof type === 'string' ? type : undefined };
    });
}

/** The placeholder a missing field of `type` starts as. */
export function placeholderFor(type: string | undefined): unknown {
  switch (type) {
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return '';
  }
}

/** The missing fields a fixed input can add: the trigger sets its own. */
export function fixableFields(
  missing: readonly MissingInputField[],
): MissingInputField[] {
  const wrapper: ReadonlySet<string> = new Set(TRIGGER_WRAPPER_KEYS);
  return missing.filter((field) => !wrapper.has(field.name));
}

/** The text after filling, and where the caret goes: inside the first new
 * placeholder, or over it when it is a number or a boolean. */
export interface FilledInput {
  text: string;
  selection: { start: number; end: number };
}

/**
 * `text` with a typed placeholder for each of `fields` it lacks (string
 * `""`, number `0`, boolean `false`, array `[]`, object `{}`), written as
 * indented JSON. Null when the text is no JSON object to add to, or nothing
 * is missing.
 */
export function fillMissingFields(
  text: string,
  fields: readonly MissingInputField[],
): FilledInput | null {
  const current = parseFixedInput(text) ?? (text.trim() === '' ? {} : null);
  if (current === null) return null;
  const added = fields.filter((field) => !Object.hasOwn(current, field.name));
  const [first] = added;
  if (first === undefined) return null;
  const next: Record<string, unknown> = { ...current };
  for (const field of added) next[field.name] = placeholderFor(field.type);
  const filled = JSON.stringify(next, null, 2);
  const key = `${JSON.stringify(first.name)}: `;
  const start = filled.indexOf(key) + key.length;
  const value = JSON.stringify(placeholderFor(first.type));
  // Inside "", [] and {}; over 0 and false, so typing replaces them.
  const inside = value === '""' || value === '[]' || value === '{}';
  return {
    text: filled,
    selection: inside
      ? { start: start + 1, end: start + 1 }
      : { start, end: start + value.length },
  };
}
