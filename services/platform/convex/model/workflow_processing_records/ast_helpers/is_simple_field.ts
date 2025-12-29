/**
 * Check if a field name is a simple field (not nested via dots).
 *
 * Simple fields can typically be indexed more efficiently than nested fields.
 *
 * @param field - The field name to check
 * @returns True if the field is simple (no dots), false if nested
 *
 * @example
 * isSimpleField('status')           // Returns true
 * isSimpleField('metadata.status')  // Returns false
 */
export function isSimpleField(field: string): boolean {
  return !field.includes('.');
}
