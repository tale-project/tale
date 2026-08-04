// Read-only workspace file explorer backend for external-agent sandbox
// sessions. The chat browser lists a directory and reads/downloads a single
// file from the live session workspace (rooted at /user in the container).
//
// The security boundary is `canAccessThread`: every entry point resolves the
// caller's identity, runs the SAME thread RLS the chat message queries enforce,
// and only then maps the thread → its per-(org,user) sandbox session. A bare
// threadId from another org can never reach another org's workspace because
// `canAccessThread` returns null for it (no membership / not shared in) and the
// resolver yields no session.
//
// Two identity sources funnel through one shared check (`resolveBrowsableFor`):
//   - the JWT-cookie path (`resolveBrowsableSession`, used by the list action)
//     via `getAuthUserIdentity`, and
//   - the Better-Auth-userId path (`resolveBrowsableSessionForUser`, used by the
//     httpAction download route, which has no ctx.auth identity from the cookie).
// Both build an `AuthenticatedUser` and hand it to `canAccessThread`, so the
// cross-org denial is identical on either path.

import { v } from 'convex/values';

import type { QueryCtx } from '../_generated/server';
import { internalQuery } from '../_generated/server';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { UnauthorizedError } from '../lib/rls/errors';
import type { AuthenticatedUser } from '../lib/rls/types';
import { userOwnerId } from './session_naming';
import { isLiveSessionStatus } from './sessions_schema';

/** Convex validator for the resolver result, reused by both internalQueries. */
const browsableSessionValidator = v.object({
  sessionId: v.union(v.string(), v.null()),
  status: v.union(
    v.literal('creating'),
    v.literal('active'),
    v.literal('degraded'),
    v.literal('stopped'),
    v.null(),
  ),
  organizationId: v.string(),
});

export interface BrowsableSession {
  /** null when the thread has no live session — the "resume to browse" state,
   * NOT an auth failure (cross-org access already threw via canAccessThread). */
  sessionId: string | null;
  status: 'creating' | 'active' | 'degraded' | 'stopped' | null;
  organizationId: string;
}

/**
 * Shared thread → session → org resolution + authorization. The ONE place the
 * cross-org boundary lives: `canAccessThread` gates the supplied identity
 * against the thread's org (member, owner, or shared-in) and returns null for
 * anything else, which we surface as an UnauthorizedError. Owner resolution and
 * the live-status scan match the session writers' derivation exactly
 * (per-(org,user) `userOwnerId`, thread-owned fallback, `by_owner` indexed
 * scan, `isLiveSessionStatus` to skip terminal incarnations) so the browser
 * reads the same session row the agent turn ran in.
 */
async function resolveBrowsableFor(
  ctx: QueryCtx,
  threadId: string,
  authUser: AuthenticatedUser,
): Promise<BrowsableSession> {
  // Same allow-list the thread message queries enforce — a bare threadId must
  // not leak another user's/org's workspace. null ⇒ thread missing OR access
  // denied (the two are conflated here, like canAccessThread itself).
  const metadata = await canAccessThread(ctx, threadId, authUser);
  if (!metadata) {
    throw new UnauthorizedError('Not authorized to access this thread.');
  }

  const organizationId = metadata.organizationId ?? '';

  // Owner key MUST match the session writers': user-owned (org, user) when
  // both are present, else the thread-owned fallback.
  const userOwned = Boolean(metadata.userId && metadata.organizationId);
  const ownerType = userOwned ? 'user' : 'thread';
  const ownerId =
    userOwned && metadata.userId && metadata.organizationId
      ? userOwnerId(metadata.organizationId, metadata.userId)
      : threadId;

  // Single indexed read on by_owner. The deterministic per-(org,user) sessionId
  // is reused across incarnations, so the index also holds terminal rows for
  // the same owner — isLiveSessionStatus skips them. Inlined (not
  // getActiveSessionByOwner) so `degraded` is surfaced too.
  for await (const row of ctx.db
    .query('sandboxSessions')
    .withIndex('by_owner', (q) =>
      q.eq('ownerType', ownerType).eq('ownerId', ownerId),
    )) {
    if (!isLiveSessionStatus(row.status)) continue;
    return {
      sessionId: row.sessionId,
      status: row.status,
      organizationId,
    };
  }
  return { sessionId: null, status: null, organizationId };
}

/**
 * JWT-cookie path: resolve the thread's browsable session for the currently
 * authenticated viewer. Used by `listWorkspaceDir`. Throws UnauthorizedError
 * when unauthenticated or thread access is denied; returns `sessionId: null`
 * when there's simply no running session (resume-to-browse state).
 */
export const resolveBrowsableSession = internalQuery({
  args: { threadId: v.string() },
  returns: browsableSessionValidator,
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new UnauthorizedError();
    return resolveBrowsableFor(ctx, args.threadId, authUser);
  },
});

/**
 * Better-Auth-userId path: identical RLS to `resolveBrowsableSession` but keyed
 * by an explicit userId (+ optional email for the mid-migration fallback that
 * the rest of the cookie-authenticated routes use). The httpAction download
 * route resolves identity from the session cookie via `auth.api.getSession`
 * (ctx.auth carries no identity there), then passes the userId here so the SAME
 * `canAccessThread` boundary runs. Throws UnauthorizedError on no-access.
 */
export const resolveBrowsableSessionForUser = internalQuery({
  args: {
    threadId: v.string(),
    userId: v.string(),
    email: v.optional(v.string()),
  },
  returns: browsableSessionValidator,
  handler: async (ctx, args) => {
    const authUser: AuthenticatedUser = {
      userId: args.userId,
      ...(args.email !== undefined && { email: args.email }),
    };
    return resolveBrowsableFor(ctx, args.threadId, authUser);
  },
});
