import type { z } from 'zod';

import { bodyIssues, type BodyIssue } from './invalid-body-response.ts';

/** A row the door refused before the domain saw it, at the caller's index. */
export interface RefusedBulkRow {
  index: number;
  error: string;
  errorCode: 'INVALID_BODY';
  issues: BodyIssue[];
  input: unknown;
}

/**
 * Validate a bulk import row by row — the REST contacts-bulk semantics for
 * the app doors: a refused row is reported at its input index with the same
 * field-named issues a single create answers, and the valid rows go on to
 * the domain's own per-row lane (duplicates). A whole-body 400 used to hide
 * which row of a thousand was wrong and import none of the others.
 */
export function partitionBulkRows<T>(
  rows: unknown[],
  schema: z.ZodType<T>,
): { valid: { index: number; item: T }[]; refused: RefusedBulkRow[] } {
  const valid: { index: number; item: T }[] = [];
  const refused: RefusedBulkRow[] = [];
  for (const [index, row] of rows.entries()) {
    const parsed = schema.safeParse(row);
    if (parsed.success) {
      valid.push({ index, item: parsed.data });
      continue;
    }
    const issues = bodyIssues(parsed.error);
    const first = issues[0];
    refused.push({
      index,
      error:
        first === undefined ? 'invalid row' : `${first.path}: ${first.message}`,
      errorCode: 'INVALID_BODY',
      issues,
      input: row,
    });
  }
  return { valid, refused };
}

/**
 * The domain answered by position in the VALID list; map its `errors[]`
 * (and `created[]`, where the domain reports it) back to the caller's own
 * indexes, fold the door's refusals in, and count them as failed.
 */
export function mergeBulkResult<
  Landed extends {
    success: number;
    failed: number;
    errors: { index: number }[];
    created?: { index: number; id: string }[];
  },
  Refused extends { index: number },
>(
  valid: { index: number }[],
  refused: Refused[],
  landed: Landed,
): Landed & { errors: (Landed['errors'][number] | Refused)[] } {
  const originalIndex = (position: number): number =>
    valid[position]?.index ?? position;
  const errors: (Landed['errors'][number] | Refused)[] = [...refused];
  for (const entry of landed.errors) {
    errors.push({ ...entry, index: originalIndex(entry.index) });
  }
  errors.sort((a, b) => a.index - b.index);
  const merged = {
    ...landed,
    failed: landed.failed + refused.length,
    errors,
  };
  if (landed.created !== undefined) {
    merged.created = landed.created
      .map((entry) => ({ ...entry, index: originalIndex(entry.index) }))
      .sort((a, b) => a.index - b.index);
  }
  return merged;
}
