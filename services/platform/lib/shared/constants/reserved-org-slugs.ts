/**
 * Org slugs that the platform reserves and refuses to assign to
 * user-created organizations.
 *
 * Two classes:
 *
 * 1. **Platform-pinned globals.** `default` is reserved because the
 *    platform pins several global resources to it (branding, retention
 *    defaults, scaffold seed target). If a user could claim that slug
 *    they'd inherit those globals, including the ability to mutate
 *    platform branding via `isCallerAdmin` (see
 *    `convex/branding/internal_queries.ts`).
 *
 * 2. **Legacy per-domain directory names** — the names a pre-refactor
 *    `tale init` would have created at the project root (`agents/`,
 *    `workflows/`, …). The org-first refactor moved everything under
 *    `<orgSlug>/<domain>/`, so a user-created org named `agents` would
 *    produce a `<root>/agents/` directory that's indistinguishable from
 *    a legacy artifact. `tale deploy`'s `findOrgDirs` classifies any
 *    such top-level dir as a legacy artifact and refuses to push;
 *    silently accepting the slug at create time would manufacture a
 *    permanent deploy failure for that org. Round-2 P1-33: reject the
 *    name up front so the UI never lets the operator into that state.
 *
 * Importable from both Convex (`convex/auth.ts`) and the React
 * organization form — kept in `lib/shared/constants/` so it stays
 * Node-runtime-neutral.
 */
const RESERVED_ORG_SLUGS: ReadonlySet<string> = new Set([
  'default',
  // Legacy per-domain dirs (kept in lockstep with
  // `tools/cli/src/lib/actions/deploy.ts:LEGACY_DOMAIN_DIR_NAMES`).
  'agents',
  'workflows',
  'integrations',
  'branding',
  'providers',
  'skills',
  'retention',
]);

export function isReservedOrgSlug(slug: string): boolean {
  return RESERVED_ORG_SLUGS.has(slug.toLowerCase());
}
