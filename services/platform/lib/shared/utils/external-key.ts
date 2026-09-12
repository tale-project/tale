import { z } from 'zod';

/**
 * The caller-owned keys the machine door dedupes on — a project's
 * `externalItemId`, a task's `externalSystem` and `externalId` — in ONE
 * canonical form: Unicode NFC, surrounding whitespace removed. The doors
 * canonicalize before validating, and the domains canonicalize again before
 * every lookup and write, so the two families cannot drift apart: a key
 * pasted with a trailing newline, or handed over in NFD by a macOS
 * filesystem, finds the row a worker created in NFC from a CSV. Two keys
 * that differ only in normalization or padding used to be two projects
 * (the 409 never fired) and two tasks (the idempotent re-pick never
 * happened).
 */
export function canonicalExternalKey(raw: string): string {
  return raw.normalize('NFC').trim();
}

/**
 * The body/query field of a caller-owned key: the canonical form is what
 * the schema answers, and a key that is blank once canonicalized is refused
 * by name (`must not be blank`) — whitespace-only used to store as an
 * empty key on one family and verbatim on the other. `max` bounds the
 * canonical form.
 */
export function externalKeySchema(max: number) {
  return z
    .string()
    .transform(canonicalExternalKey)
    .pipe(z.string().min(1, 'must not be blank').max(max));
}
