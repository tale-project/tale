/**
 * Canonical org slug validator.
 *
 * Single source of truth: importable from Convex Node actions
 * (`convex/lib/file_io.ts`), Convex regular query/mutation/action
 * modules (`convex/organizations/reseed_all_orgs.ts`), the platform
 * file-watcher (`lib/config-watcher.ts`), and the React side. Kept in
 * `lib/shared/constants/` so it stays Node-runtime-neutral (no
 * `'use node'`).
 *
 * Rules:
 *   - Must start with a lowercase letter or digit
 *   - Body may include lowercase letters, digits, `_`, `-`
 *   - Length capped at {@link MAX_ORG_SLUG_LENGTH} (64): the regex
 *     allows a leading char plus `{0,63}` (≤64 total). The cap keeps
 *     slugs usable as stable identifiers (e.g. derived resource names)
 *     across the stack.
 */
export const MAX_ORG_SLUG_LENGTH = 64;
const ORG_SLUG_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Soft check — does NOT throw. Returns true for valid slugs. */
export function isValidOrgSlug(slug: string): boolean {
  return slug.length <= MAX_ORG_SLUG_LENGTH && ORG_SLUG_REGEX.test(slug);
}

/** Hard check — throws `Error` with a uniform message on invalid input. */
export function assertValidOrgSlug(slug: string): void {
  if (!isValidOrgSlug(slug)) {
    throw new Error(
      `Invalid org slug "${slug}". Must match ${ORG_SLUG_REGEX.source} ` +
        `(max ${MAX_ORG_SLUG_LENGTH} chars).`,
    );
  }
}
