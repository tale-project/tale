/**
 * Per-mutation legal-hold gate for destructive paths that aren't already
 * gated through the retention / GDPR pipeline.
 *
 * Round-2 v08 B4: `loadActiveHolds` was only consulted by retention,
 * erasure, and the chat-thread delete path. Documents, customers,
 * vendors, conversations, and folders all bypassed it — an org-level
 * "nuclear halt" hold could be silently overridden by a user clicking
 * Delete in the UI or hitting the public REST API.
 *
 * Contract: callers invoke `assertNotHeld` BEFORE any `ctx.db.delete` or
 * cascade. The helper throws `ConvexError({ code: 'LEGAL_HOLD_ACTIVE' })`
 * when the entity is held, surfacing both `targetType` and `targetId` so
 * the UI can show the operator which hold blocks the action.
 *
 * After the User+Org pivot (commit `42de58846`) the only valid hold
 * placements are `org` (whole tenant) and `userMembership` (custodian
 * cascade). The latter is enforced via the `authorUserId` arg —
 * callers pass the row's author / owner user id and the gate refuses
 * when that user is on a custodian hold.
 *
 * `targetType` is now used purely for the **error-message context**
 * (UI shows "This document is on legal hold" vs "This thread …"). It
 * does NOT participate in the hold-matching dispatch any more.
 */

import { ConvexError } from 'convex/values';

import type { MutationCtx, QueryCtx } from '../_generated/server';
import { loadActiveHolds, type ActiveHolds } from './legal_hold';

export type GuardedTargetType =
  | 'thread'
  | 'document'
  | 'execution'
  | 'userMembership'
  | 'customer'
  | 'vendor'
  | 'conversation'
  | 'folder';

/**
 * Throws when the org is under an active hold OR when `authorUserId` is
 * supplied and that user is on a custodian hold.
 *
 * `targetType` and `targetId` only carry through to the error payload —
 * the UI uses them to render the right "This <thing> is on hold" copy
 * without the helper having to know each underlying table.
 *
 * `authorUserId` cascades through user-custodian holds (e.g. deleting a
 * document whose `createdBy` is on hold). Pass the row's author user
 * id when known. For `targetType: 'userMembership'` callers (e.g.
 * `removeMember`), pass the same userId for both `targetId` AND
 * `authorUserId` so the cascade fires.
 */
export async function assertNotHeld(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  targetType: GuardedTargetType,
  targetId: string,
  preloaded?: ActiveHolds,
  authorUserId?: string,
): Promise<void> {
  const holds = preloaded ?? (await loadActiveHolds(ctx, organizationId));
  if (holds.orgHeld) {
    throw new ConvexError({
      code: 'LEGAL_HOLD_ACTIVE',
      message:
        'This organization is under an active legal hold. Release the hold before deleting.',
      targetType,
      targetId,
      orgHeld: true,
    });
  }
  if (authorUserId && holds.userMembershipIds.has(authorUserId)) {
    throw new ConvexError({
      code: 'LEGAL_HOLD_ACTIVE',
      message: `This ${targetType} is owned by a user on a custodian legal hold. Release the user-level hold before deleting.`,
      targetType,
      targetId,
      orgHeld: false,
      userCustodianHeld: true,
    });
  }
}
