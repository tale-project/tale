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

export async function getOrganizationMember(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  user?: AuthenticatedUser,
): Promise<OrganizationMember> {
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

  // Fallback to email lookup if no direct match.
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
    // An empty member lookup has two very different causes: the organization
    // row is gone (a stale bookmark/session after a deletion — routine) or the
    // organization exists and the caller is simply not in it (a real
    // authorization refusal). Re-check the org row only on this failure path
    // so the thrown code and sentence name the right one (#3021) — a deleted
    // org must not be reported as "Not a member". The shape guard keeps
    // sentinels/slugs from throwing inside the betterAuth component; the
    // catch keeps a re-check hiccup from masking the refusal itself.
    let orgExists = false;
    if (looksLikeConvexDocumentId(organizationId)) {
      try {
        const org = await ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: 'organization',
          where: [{ field: '_id', value: organizationId, operator: 'eq' }],
        });
        orgExists = org !== null && org !== undefined;
      } catch (err) {
        console.warn(
          '[RLS] organization existence re-check failed; reporting the organization as not found',
          err instanceof Error ? err.message : err,
        );
      }
    }
    if (!orgExists) {
      throw new UnauthorizedError(
        `Organization ${organizationId} not found`,
        'ORG_NOT_FOUND',
      );
    }
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
