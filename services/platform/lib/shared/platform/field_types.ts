/**
 * Field types for `collection` columns and `review` (form) inputs. Drives
 * locale-aware formatting in the renderer (currency/date/number via
 * `@tale/ui` formatters, which already handle de-CH / fr-CH).
 */
export const FIELD_TYPES = [
  'text',
  'number',
  'currency',
  'date',
  'datetime',
  'boolean',
  'enum',
  'ref',
] as const;

type FieldType = (typeof FIELD_TYPES)[number];

const FIELD_TYPE_SET = new Set<string>(FIELD_TYPES);

export function isFieldType(value: string): value is FieldType {
  return FIELD_TYPE_SET.has(value);
}
