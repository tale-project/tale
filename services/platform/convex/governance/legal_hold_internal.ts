/**
 * Internal-only legal-hold query for use from `'use node'` actions.
 *
 * The dispatcher (`runOrgRetentionCleanup`) lives in a Node action and
 * needs to look up holds before running cleanup. Convex requires that
 * action ↔ query crossings go through the registered API surface, so
 * this module exposes `loadActiveHoldsForOrg` as a typed `internalQuery`
 * wrapping the pure `loadActiveHolds` helper from `legal_hold.ts`.
 */

import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { loadActiveHolds } from './legal_hold';

export const loadActiveHoldsForOrg = internalQuery({
  args: { organizationId: v.string() },
  // We return plain serializable shapes (arrays) instead of Sets so the
  // query/action boundary serializes cleanly. The action wraps the
  // result back into Sets for O(1) lookup.
  returns: v.object({
    orgHeld: v.boolean(),
    threadIds: v.array(v.string()),
    documentIds: v.array(v.string()),
    executionIds: v.array(v.string()),
    userMembershipIds: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const holds = await loadActiveHolds(ctx, args.organizationId);
    return {
      orgHeld: holds.orgHeld,
      threadIds: [...holds.threadIds],
      documentIds: [...holds.documentIds],
      executionIds: [...holds.executionIds],
      userMembershipIds: [...holds.userMembershipIds],
    };
  },
});
