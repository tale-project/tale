import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.66 / 01 — widen `documents.sourceProvider` from a literal union to
 * `v.string()`.
 *
 * Shipped in v0.2.66 (verified against `git diff v0.2.65 v0.2.66 --
 * convex/documents/schema.ts`): the field went from
 * `v.optional(v.union(literal('onedrive'|'upload'|'sharepoint'|'agent')))` to
 * `v.optional(v.string())` so new integration slugs need no schema change.
 *
 * up: NO-OP. Every old literal is already a valid string, so widening the type
 * leaves all existing values valid — there is nothing to rewrite. Implemented
 * as an idempotent no-op and documented as such.
 *
 * down: ASYMMETRIC. Narrowing back to the old literal set must coerce any value
 * outside `{onedrive, upload, sharepoint, agent}` (e.g. a newer integration
 * slug like `google_drive`) to a safe old literal so the row re-validates
 * against the pre-widen schema. We coerce unknown providers to `'upload'` (the
 * neutral "non-integration source" literal). This is lossy for the original
 * slug, hence the asymmetry; `reversible: true` because the SHAPE round-trips
 * (string → old-literal union), but the exact slug for post-widen providers is
 * not recoverable. Reference-only: the runner never executes it.
 */
export const meta: MigrationMeta = {
  id: '0.2.66/01_documents_source_provider_widen',
  semver: '0.2.66',
  numericId: 1,
  slug: 'documents_source_provider_widen',
  title: 'Widen documents.sourceProvider literal union to string',
  description:
    'Widens documents.sourceProvider from a literal union ' +
    '(onedrive|upload|sharepoint|agent) to an open string. up is a documented ' +
    'no-op (every old literal is already a valid string). down is ASYMMETRIC: ' +
    'it coerces any value outside the old literal set to the safe old literal ' +
    "'upload' so rows re-validate against the pre-widen schema. Reversible in " +
    'shape; the original slug of post-widen providers is not recoverable.',
  kind: 'reference',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};
