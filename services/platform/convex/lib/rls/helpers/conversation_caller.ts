/**
 * Who is asking, for a decision that depends on conversation assignment.
 *
 * Extracted so the retrieval gate and any listing surface resolve the caller
 * the SAME way. Assignment privacy is the narrowest rule the platform has, and
 * a listing that resolved its own notion of "admin" would be one refactor away
 * from being wider than the search it sits beside — the failure mode there is
 * publishing an inbox.
 *
 * ## Resolved here, never accepted as an argument
 *
 * The role comes from `resolveAgentReadAccess`, not from a caller-supplied
 * flag. An `isAdmin` boolean travelling in through several frames is exactly
 * how a gate ends up trusting the wrong value.
 *
 * ## Lazy by construction
 *
 * Both lookups cost a cross-component Better Auth round-trip, so nothing is
 * resolved until a caller actually asks. Memoise the returned promise per
 * request — {@link conversationCallerResolver} does that for you — so a page of
 * rows pays for one resolution rather than one per row.
 */

import type { QueryCtx } from '../../../_generated/server';
import { getUserTeamIds } from '../../get_user_teams';
import { resolveAgentReadAccess } from './agent_read_access';
import { isAdmin } from './role_helpers';

/** The caller, as an assignment decision needs them. */
export interface ConversationCallerIdentity {
  readonly isAdmin: boolean;
  readonly userId: string;
  readonly teamIds: ReadonlySet<string>;
}

/**
 * A memoised resolver for one request.
 *
 * Returns `null` when the caller cannot be decided — no identity supplied, not
 * a member, or a role that denies conversations. Every `null` is a denial, so a
 * surface that forgets to say who is asking serves nothing rather than
 * everything.
 */
export function conversationCallerResolver(
  ctx: QueryCtx,
  args: { organizationId: string; userId?: string | undefined },
): () => Promise<ConversationCallerIdentity | null> {
  let pending: Promise<ConversationCallerIdentity | null> | undefined;
  return () => {
    pending ??= (async () => {
      const userId = args.userId;
      // Fail closed on a surface that did not say who is asking. This is the
      // ONE place that decision is made; a second guard at a call site reads as
      // belt-and-braces but no test can tell it from dead code.
      if (userId === undefined) return null;
      const access = await resolveAgentReadAccess(ctx, {
        organizationId: args.organizationId,
        userId,
        subject: 'conversations',
      });
      if (!access.allowed) return null;
      return {
        isAdmin: isAdmin(access.role),
        userId,
        teamIds: new Set(await getUserTeamIds(ctx, userId)),
      };
    })();
    return pending;
  };
}
