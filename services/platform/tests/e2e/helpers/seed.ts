/**
 * Backend-seeded starter content every fresh org receives from
 * `convex/provisioning/seed_starter.ts` (scheduled by
 * `auth.ts:afterCreateOrganization`, ~15s after create). These are product
 * literals (not translated UI copy), so they stay constants here — shared by
 * the specs and the worker-org bootstrap — rather than going through `t()`.
 * Rename-safety lives in one place.
 *
 * The pre-rewrite fixture-config seeds (agent / provider / prompt / workflow
 * under `fixtures/config/default/`) are gone as an org-seeding mechanism: the
 * AI-backend rewrite's interim scaffolder copies only the domains registered
 * in `lib/shared/config/registry.ts` (today `governance`), so none of those
 * files ever reach a new org. The starter project is the one deterministic
 * post-create artifact left to gate on.
 */

/** Seeded starter project — `seed_starter.ts` creates it for every new org. */
export const STARTER_PROJECT_NAME = 'Getting started';
