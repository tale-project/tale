/**
 * Action-context auth helper keyed by `organizationId`.
 *
 * Mirrors `providers/auth.ts::requireOrgMembership` (which is keyed by
 * `orgSlug`), but takes the Better Auth doc id as the input — matching the
 * unified public action surface where `organizationId` is the single public
 * identity and `orgSlug` is resolved server-side.
 *
 * The single call replaces the common pattern:
 *   const authUser = await authComponent.getAuthUser(ctx);
 *   if (!authUser) throw …;
 *   const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
 *   // ... (no membership check)
 *
 * with:
 *   const { orgSlug, userId, member } = await requireOrgMembershipById(ctx, args.organizationId);
 *
 * Closes the cross-tenant authz gap on every public action in
 * `agents/file_actions.ts`, `connectors/file_actions.ts`,
 * `threads/{edit_and_branch,fork_and_chat}.ts`,
 * `conversations/actions.ts`, `workflows/triggers/actions.ts`, and
 * `onedrive/actions.ts`.
 *
 * Throws `AppError` with stable `code` so UI can dispatch:
 *  - `UNAUTHENTICATED` — no auth user.
 *  - `ORG_NOT_FOUND` — id does not resolve to any organization, or the
 *    organization row is missing its `slug` field.
 *  - `ORG_FORBIDDEN` — caller is not a non-disabled member.
 *
 * NOTE: this file is intentionally NOT `'use node'` — it does only V8 work
 * (ctx.runQuery against Better Auth), so it can be imported from both Node
 * and V8 actions.
 */

import { AppError } from '../../../lib/shared/errors/app-error';
import type { ActionCtx, MutationCtx } from '../ctx';
import { components } from '../handler_names';
import { getAuthUserIdentity } from '../rls/auth/get_auth_user_identity';

interface BetterAuthMember {
  _id: string;
  role: string;
}

export interface OrgMembershipAuth {
  /** Better Auth organization `_id`. */
  orgId: string;
  /** Resolved human-readable slug — use for filesystem paths and SOPS lookups. */
  orgSlug: string;
  /** Better Auth user id (string-coerced). */
  userId: string;
  /** Authenticated user's email — feeds audit logging and `startChat`. */
  email: string;
  /** Authenticated user's display name. Empty string when unset. */
  name: string;
  /** `(user, org)` member row. `role` is the Better Auth role. */
  member: BetterAuthMember;
}

export async function requireOrgMembershipById(
  ctx: ActionCtx | MutationCtx,
  organizationId: string,
): Promise<OrgMembershipAuth> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) {
    throw new AppError({
      code: 'UNAUTHENTICATED',
      message: 'Authentication required.',
    });
  }
  const userId = authUser.userId;

  // Reject an empty id up front: the adapter resolves an `_id` `eq` filter via
  // `db.get(value)`, and `db.get('')` throws the opaque "Invalid ID length 0"
  // instead of a clean miss. `ORG_ID_REQUIRED`, not `ORG_NOT_FOUND`: an empty
  // id is a caller-side gap (a component racing its data), not evidence the
  // caller's persisted org is gone — the client's dead-org recovery keys on
  // `ORG_NOT_FOUND` and must not fire for it (see
  // `lib/rls/organization/get_organization_member.ts`, same rule).
  if (!organizationId) {
    throw new AppError({
      code: 'ORG_ID_REQUIRED',
      message: 'Organization id is required.',
    });
  }

  const org = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'organization',
    where: [{ field: '_id', value: organizationId, operator: 'eq' }],
  });
  if (!org) {
    throw new AppError({
      code: 'ORG_NOT_FOUND',
      message: `Organization "${organizationId}" not found.`,
    });
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter returns unknown; we only consume _id and slug
  const orgRecord = org as { _id: string; slug?: string };
  const orgSlug = orgRecord.slug;
  if (!orgSlug) {
    throw new AppError({
      code: 'ORG_NOT_FOUND',
      message: `Organization "${organizationId}" is missing a slug.`,
    });
  }

  const memberRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'member',
    paginationOpts: { cursor: null, numItems: 1 },
    where: [
      { field: 'organizationId', value: orgRecord._id, operator: 'eq' },
      { field: 'userId', value: userId, operator: 'eq' },
    ],
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter findMany returns paginated unknown
  const member = (memberRes as { page?: BetterAuthMember[] })?.page?.[0];
  if (!member || member.role === 'disabled') {
    throw new AppError({
      code: 'ORG_FORBIDDEN',
      message: `Not a member of organization "${orgSlug}".`,
    });
  }

  return {
    orgId: orgRecord._id,
    orgSlug,
    userId,
    email: authUser.email ?? '',
    name: authUser.name ?? '',
    member,
  };
}
