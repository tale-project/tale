'use node';

/**
 * Provider-action auth helper.
 *
 * Every public action in `providers/file_actions.ts` takes an `orgSlug` arg
 * and resolves it to a filesystem path under `providers/<orgSlug>/`. Without
 * a membership check, any authenticated user could read or overwrite another
 * org's secrets by passing that org's slug — including discarding a SOPS
 * ciphertext via `force: true` on `saveProviderSecret`.
 *
 * This helper performs both checks in one call and returns the resolved
 * `orgId`, `userId`, and member record. The returned member feeds the audit
 * logger downstream so destructive actions (force-overwrite) carry actor
 * attribution.
 *
 * Pattern parity: `integrations/credential_mutations.ts` uses
 * `getOrganizationMember` directly because it runs in a MutationCtx. Provider
 * actions are `'use node'` actions, so we issue the same Better Auth adapter
 * queries via `ctx.runQuery` from the action context.
 */

import { ConvexError } from 'convex/values';

import { defineAbilityFor } from '../../lib/permissions/ability';
import { components } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { authComponent } from '../auth';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';

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
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    throw new ConvexError({
      code: 'UNAUTHENTICATED',
      message: 'Authentication required.',
    });
  }
  const userId = String(authUser._id);

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
