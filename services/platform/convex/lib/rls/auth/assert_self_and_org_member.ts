import type { MutationCtx, QueryCtx } from '../../../_generated/server';
import { UnauthorizedError } from '../errors';
import { getOrganizationMember } from '../organization/get_organization_member';
import type { AuthenticatedUser } from '../types';

/**
 * Tale resources are scoped along three orthogonal axes — pick one when
 * adding a new table:
 *  - org-scoped (e.g. agentBindings, integrations): gate via
 *    getOrganizationMember; every member with the right role can read.
 *  - team-scoped (e.g. team-bound documents): org membership + teamMember
 *    lookup, sharing opt-in via per-resource fields.
 *  - user-private (e.g. userPreferences, userMemories, threadMetadata):
 *    visibility belongs to the row owner only, not derivable from org role —
 *    use this helper. Mixing axes on one row is a compatibility minefield;
 *    model as two rows or two relations instead.
 *
 * Assert the authenticated principal is the owner of a user-private resource
 * (e.g. userPreferences, userMemories) AND is a current member of the org
 * the resource is scoped to.
 *
 * Composes two checks:
 *  1. self-only — `authUser.userId === targetUserId`
 *  2. org membership — Better Auth `member` row still exists for (user, org)
 *
 * The org-membership check defends against a stale-token scenario: a user
 * removed from org B mid-session whose JWT still names B; without this
 * check they could continue reading their old memories until the JWT
 * expires.
 *
 * Use this helper for every public query/mutation that touches a
 * user-private personalization row. Internal mutations called from cascade
 * hooks bypass it (they already know they have authority — the cascade is
 * the authoritative event).
 */
export async function assertSelfAndOrgMember(
  ctx: QueryCtx | MutationCtx,
  authUser: AuthenticatedUser,
  targetUserId: string,
  organizationId: string,
): Promise<void> {
  if (authUser.userId !== targetUserId) {
    throw new UnauthorizedError('User-private resource');
  }
  // Throws UnauthorizedError if the user is no longer a member of the org.
  await getOrganizationMember(ctx, organizationId, authUser);
}
