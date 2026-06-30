/**
 * Active-organization coherence guard.
 *
 * The platform's "active org" is the URL's `/dashboard/$id` segment (read on the
 * client via `useOrganizationId`) and is passed into a query/mutation as an
 * explicit `organizationId` arg — there is no ambient request org on the
 * backend, so every by-id surface has to be told which org it is acting in.
 *
 * A by-id read or write must verify the loaded entity actually belongs to that
 * active org. Authorizing only against the entity's OWN org (plus the caller's
 * membership) is not enough: a user who belongs to both org A and org B and has
 * switched to B can still load an org-A entity by a carried-over URL, a warm
 * cache, or a deep link, because membership in A still passes. This is the same
 * boundary `canAccessThread`'s `expectedOrgId` enforces for threads — extracted
 * here so every other by-id surface (projects, tasks, docs, …) shares one check
 * instead of re-deriving it (the gap that let the bug spread silently: there was
 * no single thing to grep for).
 *
 * Convention, mirroring threads: READS shape a mismatch into `null`/`[]` via
 * {@link isActiveOrg} so an org switch never flashes an error boundary on a
 * still-mounted stale query; WRITES call {@link assertActiveOrg} to hard-fail
 * with `OrganizationMismatchError`.
 */

import { OrganizationMismatchError } from '../errors';

/**
 * True when `entityOrgId` is the caller's active org.
 *
 * A by-id READ should shape a `false` into `null` / `[]` (see file header) so a
 * carried-over cross-org id resolves to "not found" rather than rendering the
 * other org's content. `entityOrgId` is intentionally nullable: an org-less
 * entity belongs to no active org, so it correctly returns `false`.
 */
export function isActiveOrg(
  entityOrgId: string | undefined,
  activeOrgId: string,
): boolean {
  return entityOrgId === activeOrgId;
}

/**
 * Throwing variant for WRITE paths (and the rare read that should hard-fail
 * rather than return empty). Throws `OrganizationMismatchError` when the entity
 * does not belong to the active org.
 */
export function assertActiveOrg(
  entityOrgId: string | undefined,
  activeOrgId: string,
): void {
  if (entityOrgId !== activeOrgId) {
    throw new OrganizationMismatchError();
  }
}
