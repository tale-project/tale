/**
 * Org slug validation shared across all Tale services.
 *
 * Single source of truth so RAG, crawler, and `@tale/shared/config/providers`
 * agree on what counts as a legal slug. Keep in lockstep with
 * `services/platform/lib/shared/constants/org-slug.ts`'s `ORG_SLUG_REGEX`.
 *
 * The regex protects file-system writes against:
 * - `.` / `..` / absolute paths (e.g. `/etc/...`) — which would otherwise
 *   silently rewrite to a legacy flat layout when joined as a path segment.
 * - shell metacharacters that could leak into log lines or process arguments.
 * - empty / whitespace-only slugs.
 */

export const ORG_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export class InvalidOrgSlugError extends Error {
  constructor(orgSlug: unknown) {
    super(
      `invalid org_slug ${JSON.stringify(orgSlug)}: must match ${ORG_SLUG_RE.source}`,
    );
    this.name = 'InvalidOrgSlugError';
  }
}

/**
 * Return `orgSlug` if it matches {@link ORG_SLUG_RE}; throw otherwise.
 *
 * Returns the slug unchanged so call sites can inline the check:
 * `const dir = path.join(base, validateOrgSlug(orgSlug), 'providers')`.
 */
export function validateOrgSlug(orgSlug: string): string {
  if (typeof orgSlug !== 'string' || !ORG_SLUG_RE.test(orgSlug)) {
    throw new InvalidOrgSlugError(orgSlug);
  }
  return orgSlug;
}
