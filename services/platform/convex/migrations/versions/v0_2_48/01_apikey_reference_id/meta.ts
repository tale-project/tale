import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.48 / 01 — better-auth 1.5 `apikey.userId` → `referenceId` (+ new
 * `configId`).
 *
 * NOTE — diff differs from the brief: `git diff v0.2.47 v0.2.48 --
 * convex/betterAuth/schema.ts` shows the v0.2.48 change was a SCHEMA
 * RELAXATION, not an in-place rename. better-auth 1.5 renamed the column
 * `userId` → `referenceId` and added a required `configId`; rather than
 * rewrite existing rows at that release, the schema was patched to make
 * `configId` / `referenceId` / `userId` all OPTIONAL so pre-1.5 rows keep
 * validating (the schema comment says "Remove once a migration backfills the
 * new fields"). This reference migration captures that deferred backfill: the
 * data transform that moves `userId` → `referenceId`.
 *
 * up: `referenceId = userId`, leave `configId` unset/undefined, unset `userId`.
 * down: `userId = referenceId`, unset `referenceId` + `configId`.
 *
 * Pure rename of an identity reference — fully reversible, no data lost
 * (`configId` has no pre-1.5 source, so it is left undefined and dropped on
 * down). Reference-only: the runner never executes it.
 */
export const meta: MigrationMeta = {
  id: '0.2.48/01_apikey_reference_id',
  semver: '0.2.48',
  numericId: 1,
  slug: 'apikey_reference_id',
  title: 'Backfill better-auth apikey.userId into referenceId',
  description:
    'better-auth 1.5 renamed apikey.userId to referenceId and added configId. ' +
    'The v0.2.48 schema change relaxed all three to optional (deferring the ' +
    'backfill); this migration is that backfill. up sets referenceId=userId, ' +
    'leaves configId undefined, unsets userId; down sets userId=referenceId and ' +
    'unsets referenceId+configId. Reversible, no data loss.',
  kind: 'reference',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};
