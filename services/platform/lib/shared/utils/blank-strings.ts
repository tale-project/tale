import { z } from 'zod';

import { isRecord } from '../../utils/type-utils.ts';

/**
 * How a blank string in a request body is read — the one rule the REST
 * door applies to every top-level field of a create and of a patch, so a
 * form- or CSV-shaped client can spell "nothing" the way it always does:
 *
 *  - on a create, a blank string reads as the field left out (`absent`):
 *    the row gets the column's default, never an empty string;
 *  - on a patch, a blank string reads as `null`: the field is CLEARED, the
 *    way an explicit `null` clears it (`""` used to be a silent no-op on
 *    one field, a clear on the next and stored as `""` on a third).
 *
 * Only a field that accepts the substitute is rewritten: a required field
 * (a product's `name`) keeps the blank and answers its own "must not be
 * blank", never "expected string, received null". A blank inside a nested
 * object or array is the caller's own data and stays as sent.
 */
function blankStringsAs<Shape extends z.ZodRawShape>(
  substitute: 'absent' | 'null',
  schema: z.ZodObject<Shape>,
) {
  const replacement = substitute === 'null' ? null : undefined;
  const rewritable = new Set(
    Object.entries(schema.shape)
      .filter(([, field]) => z.safeParse(field, replacement).success)
      .map(([key]) => key),
  );
  return z.preprocess((body) => {
    if (!isRecord(body)) return body;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      const blank =
        rewritable.has(key) && typeof value === 'string' && value.trim() === '';
      if (!blank) {
        out[key] = value;
      } else if (replacement === null) {
        out[key] = null;
      }
    }
    return out;
  }, schema);
}

/** The create composition: a blank optional field reads as left out. */
export function blankStringsAsAbsent<Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
) {
  return blankStringsAs('absent', schema);
}

/** The patch composition: a blank clearable field reads as `null`. */
export function blankStringsAsNull<Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
) {
  return blankStringsAs('null', schema);
}
