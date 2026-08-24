/**
 * Get organization member for authenticated user from Better Auth
 */

import { components } from '../../../_generated/api';
import type { QueryCtx, MutationCtx } from '../../../_generated/server';
import { normalizeAuthEmail } from '../../auth/normalize_auth_email';
import { looksLikeConvexDocumentId } from '../../helpers/id_shape';
import { requireAuthenticatedUser } from '../auth/require_authenticated_user';
import { UnauthorizedError } from '../errors';
import type { AuthenticatedUser, OrganizationMember } from '../types';

/**
 * Get organization member for authenticated user from Better Auth's member table
 */
/**
 * Resolve a member from the local `memberMirror` by `(organizationId, userId)` —
 * a single indexed db read, no cross-component round-trip.
 *
 * This is what keeps raw-query callers like `getMyPreferences` (via
 * `assertSelfAndOrgMember`) off the 1s-budget cliff: they don't prime the RLS
 * request cache, so without the mirror they pay a cold cross-component
 * `member.findMany` here — the read that, amplified on a self-hosted backend,
 * tripped the chat composer's error boundary (white screen). Disabled members
 * ARE in the mirror (stored unchanged), so the disabled check below still fires.
 * A miss (not-yet-backfilled / disabled-only edge / email-linking principal)
 * falls through to the authoritative Better Auth lookup, preserving the original
 * semantics. Returns undefined on miss or any read error so the caller falls
 * back.
 */
async function findMemberInMirror(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  userId: string,
): Promise<OrganizationMember | undefined> {
  try {
    const row = await ctx.db
      .query('memberMirror')
      .withIndex('by_org_user', (q) =>
        q.eq('organizationId', organizationId).eq('userId', userId),
      )
      .first();
    if (!row) return undefined;
    return {
      _id: row.memberId,
      createdAt: row.createdAt,
      organizationId: row.organizationId,
      userId: row.userId,
      role: row.role,
    };
  } catch (err) {
    console.warn(
      '[getOrganizationMember] member mirror read failed; falling back to Better Auth',
      err instanceof Error ? err.message : err,
    );
    return undefined;
  }
}

/**
 * Classify a membership miss the moment the authoritative member lookup
 * comes back empty: an org that no longer exists (deleted, or the id is not
 * even id-shaped — a stale client polling a dead persisted active org) is
 * `ORG_NOT_FOUND`, a live org the user simply isn't in is `ORG_FORBIDDEN`.
 * Clients dispatch recovery on `ORG_NOT_FOUND` (clear the stale active org,
 * return to the picker), so the two must not be conflated.
 *
 * Checked BEFORE the email fallback: no fallback can conjure a membership in
 * an organization that has no row, so a dead org short-circuits here — two
 * cross-component reads total, CHEAPER than the old always-run fallback
 * chain. That matters precisely on this path's hot case: an org deletion
 * re-executes every subscribed org-scoped query at once, and on a loaded
 * backend the 4-read fallback chain blew the function budget, surfacing
 * timeouts instead of the structured miss (observed in manual testing).
 * The `looksLikeConvexDocumentId` pre-check keeps a non-id string out of the
 * adapter's `db.get`, which would throw an opaque decode error (see
 * `lib/helpers/id_shape.ts`).
 */
async function organizationExists(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
): Promise<boolean> {
  if (!looksLikeConvexDocumentId(organizationId)) return false;
  try {
    const org = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'organization',
      where: [{ field: '_id', value: organizationId, operator: 'eq' }],
    });
    return org != null;
  } catch (err) {
    console.warn(
      '[getOrganizationMember] organization existence check failed; treating as missing',
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

export async function getOrganizationMember(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  user?: AuthenticatedUser,
): Promise<OrganizationMember> {
  // Reject an empty id at the boundary: callers validate `organizationId` as
  // `v.string()`, so a client with an empty persisted org context reaches
  // this gate with `""` — which can never match a membership and used to
  // surface as the unactionable "Not a member of organization " (sic). Fail
  // it as the structured, terminal miss it is, before any lookup.
  if (!organizationId) {
    throw new UnauthorizedError(
      'Organization id is required.',
      'ORG_NOT_FOUND',
    );
  }

  const authUser = user || (await requireAuthenticatedUser(ctx));

  // Hot path: read the membership from the local mirror (synced inline on every
  // write path + an hourly reconcile). Falls back to Better Auth on a miss.
  let member: OrganizationMember | undefined = await findMemberInMirror(
    ctx,
    organizationId,
    authUser.userId,
  );

  // Authoritative lookup: Better Auth's member table by (organizationId, userId).
  let result = member
    ? undefined
    : await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        paginationOpts: {
          cursor: null,
          numItems: 1,
        },
        where: [
          {
            field: 'organizationId',
            value: organizationId,
            operator: 'eq',
          },
          {
            field: 'userId',
            value: authUser.userId,
            operator: 'eq',
          },
        ],
      });

  member = member ?? result?.page?.[0];

  // Membership miss: classify the org FIRST. A deleted/nonexistent org is a
  // terminal, structured miss — running the email fallback for it would only
  // add two more cross-component reads that cannot succeed (see
  // `organizationExists` above for why that latency matters here).
  if (!member && !(await organizationExists(ctx, organizationId))) {
    throw new UnauthorizedError(
      `Organization "${organizationId}" not found.`,
      'ORG_NOT_FOUND',
    );
  }

  // Fallback to email lookup if no direct match (org known to exist here).
  // This handles cases where the JWT userId doesn't match the stored userId, which can occur during:
  // - Account migrations (e.g., user data moved between auth providers)
  // - Account linking (e.g., social login linked to existing email account)
  // - Session/JWT created before user record was updated in Better Auth
  // NOTE: This fallback adds 2 sequential queries when triggered. Monitor frequency in production.
  if (!member && authUser.email) {
    console.warn('[RLS] Falling back to email lookup for organization member', {
      organizationId,
      userId: authUser.userId,
      email: authUser.email,
    });
    const userRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [
        {
          field: 'email',
          value: normalizeAuthEmail(authUser.email),
          operator: 'eq',
        },
      ],
    });
    const userByEmail = userRes?.page?.[0];
    if (userByEmail?._id) {
      result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          {
            field: 'organizationId',
            value: organizationId,
            operator: 'eq',
          },
          { field: 'userId', value: userByEmail._id, operator: 'eq' },
        ],
      });
      member = result?.page?.[0];
    }
  }

  if (!member) {
    // The org exists (checked above before the fallback) — this is a live-org
    // membership refusal, not a dead-org miss.
    throw new UnauthorizedError(
      `Not a member of organization ${organizationId}`,
      'ORG_FORBIDDEN',
    );
  }

  if (member.role === 'disabled') {
    throw new UnauthorizedError(
      `Member account is disabled in organization ${organizationId}`,
      'ORG_FORBIDDEN',
    );
  }

  return member;
}
