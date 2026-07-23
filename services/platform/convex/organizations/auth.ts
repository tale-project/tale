'use node';

/**
 * Org guard helpers — action-context auth for organization-scoped resources.
 *
 * Moved here from `providers/auth.ts` (the `providers/` domain was retired
 * in the AI-backend rewrite): these four helpers are generic org
 * membership / developer-settings guards, not provider-specific — the
 * doc comments below (unchanged from the original) already describe them
 * that way. `requireDeveloperSettingsAccessById` is the one the live tree
 * currently imports (`organizations/actions.ts`'s provisioning-status/repair
 * actions); the other three form its call chain and are kept alongside it as
 * one coherent unit.
 *
 * Every public action in the old `providers/file_actions.ts` took an
 * `orgSlug` arg and resolved it to a filesystem path under
 * `providers/<orgSlug>/`. Without a membership check, any authenticated user
 * could read or overwrite another org's secrets by passing that org's slug.
 *
 * `requireOrgMembership` performs both the auth + membership checks in one
 * call and returns the resolved `orgId`, `userId`, and member record. The
 * returned member feeds audit logging downstream so destructive actions
 * carry actor attribution.
 */

import { ConvexError } from 'convex/values';

import { defineAbilityFor } from '../../lib/permissions/ability';
import { components } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { resolveOrgSlug } from './resolve_org_slug';

interface BetterAuthMember {
  _id: string;
  role: string;
}

export interface ProviderActionAuth {
  /** Better Auth organization ID. */
  orgId: string;
  /** Resolved human-readable slug — use for filesystem and SOPS paths. */
  orgSlug: string;
  /** Better Auth user ID (string-coerced). */
  userId: string;
  /** Authenticated user's email, when available — used by audit logging. */
  email?: string;
  /** Member record for this (user, org) pair. `role` is the Better Auth role. */
  member: BetterAuthMember;
}

/**
 * Authenticate the caller and verify membership in the org identified by
 * `orgSlug`. Throws a `ConvexError` with a stable `code` so the UI can
 * dispatch on it:
 *
 * - `UNAUTHENTICATED` — no auth user.
 * - `ORG_NOT_FOUND` — slug does not resolve to any organization.
 * - `ORG_FORBIDDEN` — caller is not a non-disabled member.
 */
export async function requireOrgMembership(
  ctx: ActionCtx,
  orgSlug: string,
): Promise<ProviderActionAuth> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) {
    throw new ConvexError({
      code: 'UNAUTHENTICATED',
      message: 'Authentication required.',
    });
  }
  const userId = authUser.userId;

  // Slug → org. Mirrors the lookup in auth.ts beforeCreateOrganization.
  const org = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'organization',
    where: [{ field: 'slug', value: orgSlug, operator: 'eq' }],
  });
  if (!org) {
    throw new ConvexError({
      code: 'ORG_NOT_FOUND',
      message: `Organization "${orgSlug}" not found.`,
    });
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter returns unknown; we only consume _id
  const orgId = (org as { _id: string })._id;

  // Member lookup by (organizationId, userId). Mirrors getOrganizationMember
  // in lib/rls/organization/get_organization_member.ts but inlined because that
  // helper is typed for QueryCtx | MutationCtx, not ActionCtx.
  const memberRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'member',
    paginationOpts: { cursor: null, numItems: 1 },
    where: [
      { field: 'organizationId', value: orgId, operator: 'eq' },
      { field: 'userId', value: userId, operator: 'eq' },
    ],
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter findMany returns paginated unknown
  const member = (memberRes as { page?: BetterAuthMember[] })?.page?.[0];
  if (!member || member.role === 'disabled') {
    throw new ConvexError({
      code: 'ORG_FORBIDDEN',
      message: `Not a member of organization "${orgSlug}".`,
    });
  }

  return {
    orgId,
    orgSlug,
    userId,
    email: authUser.email,
    member,
  };
}

/**
 * Stricter gate for provider config mutations. The dashboard route is
 * protected by a `cannot('read', 'developerSettings')` check, but the Convex
 * actions previously only required org membership — meaning any non-disabled
 * `member` could call `saveProvider`/`saveProviderSecret`/`deleteProvider`
 * directly via the Convex client, bypassing the UI gate. This helper
 * additionally enforces the `developerSettings` capability so action-layer
 * auth matches route-layer auth (defense in depth).
 *
 * Throws `FORBIDDEN_DEVELOPER_SETTINGS` for roles that lack the capability.
 */
export async function requireDeveloperSettingsAccess(
  ctx: ActionCtx,
  orgSlug: string,
): Promise<ProviderActionAuth> {
  const auth = await requireOrgMembership(ctx, orgSlug);
  const ability = defineAbilityFor(auth.member.role);
  if (ability.cannot('read', 'developerSettings')) {
    throw new ConvexError({
      code: 'FORBIDDEN_DEVELOPER_SETTINGS',
      message: `Role "${auth.member.role}" lacks developer-settings access required to modify provider configuration.`,
    });
  }
  return auth;
}

/**
 * Same as `requireOrgMembership` but keyed by `organizationId` — used by the
 * public provider actions that have migrated off `orgSlug` per the unified
 * org-identity surface. Resolves the slug internally so legacy on-disk paths
 * (`providers/<slug>/...`) continue to work without leaking the slug into the
 * public API.
 */
export async function requireOrgMembershipById(
  ctx: ActionCtx,
  organizationId: string,
): Promise<ProviderActionAuth> {
  const orgSlug = await resolveOrgSlug(ctx, organizationId);
  return requireOrgMembership(ctx, orgSlug);
}

/**
 * Same as `requireDeveloperSettingsAccess` but keyed by `organizationId`.
 */
export async function requireDeveloperSettingsAccessById(
  ctx: ActionCtx,
  organizationId: string,
): Promise<ProviderActionAuth> {
  const orgSlug = await resolveOrgSlug(ctx, organizationId);
  return requireDeveloperSettingsAccess(ctx, orgSlug);
}
