/**
 * Per-mutation legal-hold gate for destructive paths that aren't already
 * gated through the retention / GDPR pipeline.
 *
 * Round-2 v08 B4: `loadActiveHolds` was only consulted by retention,
 * erasure, and the chat-thread delete path. Documents, customers,
 * vendors, conversations, and folders all bypassed it — an org-level
 * "nuclear halt" hold or a per-document hold could be silently overridden
 * by a user clicking Delete in the UI or hitting the public REST API.
 *
 * Contract: callers invoke `assertNotHeld` BEFORE any `ctx.db.delete` or
 * cascade. The helper throws `ConvexError({ code: 'LEGAL_HOLD_ACTIVE' })`
 * when the entity is held, surfacing both `targetType` and `targetId` so
 * the UI can show the operator which hold blocks the action.
 *
 * targetType set covers the schema's full literal union plus four
 * surfaces that have no per-row hold today (customer/vendor/conversation/
 * folder). For those, only `orgHeld` is consulted — adding per-row holds
 * for them is a follow-up schema change.
 */

import { ConvexError } from 'convex/values';

import type { MutationCtx, QueryCtx } from '../_generated/server';
import { isHeld, loadActiveHolds, type ActiveHolds } from './legal_hold';

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
 * Throws when the org is under an active hold OR when the targetType is
 * one of the schema-supported per-row hold types and a row matches OR
 * when `authorUserId` is supplied and that user is on a custodian hold.
 *
 * For `customer`/`vendor`/`conversation`/`folder` the schema has no
 * per-row hold today, so only `orgHeld` blocks. The helper still accepts
 * `targetId` for those types so future per-row holds drop in without
 * call-site changes.
 *
 * `authorUserId` lets callers cascade through user-custodian holds
 * (e.g. deleting a document whose `createdBy` is on hold). Pass the
 * row's author user-id when known.
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
  // Per-row checks only apply to types the schema supports today.
  if (
    targetType === 'thread' ||
    targetType === 'document' ||
    targetType === 'execution' ||
    targetType === 'userMembership'
  ) {
    if (isHeld(holds, targetType, targetId)) {
      throw new ConvexError({
        code: 'LEGAL_HOLD_ACTIVE',
        message: `This ${targetType} is under an active legal hold. Release the hold before deleting.`,
        targetType,
        targetId,
        orgHeld: false,
      });
    }
  }
  // User-custodian cascade. When the row's author is on a userMembership
  // hold, every entity authored by that user is preserved — admins must
  // release the custodian hold before deleting individual rows.
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
