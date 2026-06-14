/**
 * Org slugs that the platform reserves and refuses to assign to
 * user-created organizations.
 *
 * `default` is reserved because the platform pins several global resources
 * to it (branding, retention defaults, scaffold seed target). If a user
 * could claim that slug they'd inherit those globals, including the platform
 * branding bucket read by the pre-auth shell.
 *
 * Importable from both Convex (`convex/auth.ts`) and the React
 * organization form — kept in `lib/shared/constants/` so it stays
 * Node-runtime-neutral.
 */
const RESERVED_ORG_SLUGS: ReadonlySet<string> = new Set(['default']);

export function isReservedOrgSlug(slug: string): boolean {
  return RESERVED_ORG_SLUGS.has(slug.toLowerCase());
}
