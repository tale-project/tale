/**
 * @deprecated Re-export of `orgSlugFromId` from `lib/helpers/org_slug`.
 *
 * This module used to host its own implementation; that body has been
 * removed and the function now delegates to the canonical helper so
 * there is one source of truth. Existing callers continue to import
 * `resolveOrgSlug` from here; new code should prefer
 * `import { orgSlugFromId } from '../lib/helpers/org_slug'`.
 */
export { orgSlugFromId as resolveOrgSlug } from '../lib/helpers/org_slug';
