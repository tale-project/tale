/**
 * Full trusted-headers authentication flow business logic.
 *
 * This wraps the lower-level helpers for:
 * - finding/creating the user from headers
 * - resolving team names to IDs
 * - creating/reusing a Better Auth session with role and teams stored
 */

import type { MutationCtx } from '../../_generated/server';
import { findOrCreateUserFromHeaders } from './find_or_create_user_from_headers';
import { createSessionForTrustedUser } from './create_session_for_trusted_user';
import { resolveTeams } from './resolve_team_names';

export interface TrustedHeadersTeamEntry {
  id: string;
  name: string;
}

export interface TrustedHeadersAuthenticateArgs {
  email: string;
  name: string;
  role: string;
  teams: TrustedHeadersTeamEntry[] | null;
  existingSessionToken?: string;
  ipAddress?: string;
  userAgent?: string;
  secret?: string;
}

export interface TrustedHeadersAuthenticateResult {
  userId: string;
  organizationId: string | null;
  sessionToken: string;
  shouldClearOldSession: boolean;
  trustedHeadersChanged: boolean;
}

export async function trustedHeadersAuthenticate(
  ctx: MutationCtx,
  args: TrustedHeadersAuthenticateArgs,
): Promise<TrustedHeadersAuthenticateResult> {
  const requiredSecret = process.env.TRUSTED_HEADERS_INTERNAL_SECRET;
  if (requiredSecret && args.secret !== requiredSecret) {
    throw new Error('Invalid internal secret for trusted headers authentication');
  }

  const { email, name, role, teams, existingSessionToken, ipAddress, userAgent } = args;

  // First, find or create the user and ensure their profile matches headers
  const userResult = await findOrCreateUserFromHeaders(ctx, {
    email,
    name,
    role,
  });

  // Pass through external team data if teams header was provided
  // In trusted headers mode, external IdP is the single source of truth
  // Store full team data (id + name) for both filtering and UI display
  let trustedTeams: string | undefined;
  if (teams !== null) {
    const teamResult = resolveTeams({ teams });
    trustedTeams = JSON.stringify(teamResult.teams);
  }

  // Then, create or reuse a session for this user, handling account switching
  // Store role and teams in the session for JWT claims
  const sessionResult = await createSessionForTrustedUser(ctx, {
    userId: userResult.userId,
    existingSessionToken,
    ipAddress,
    userAgent,
    trustedRole: role,
    trustedTeams,
  });

  return {
    userId: userResult.userId,
    organizationId: userResult.organizationId,
    sessionToken: sessionResult.sessionToken,
    shouldClearOldSession: sessionResult.shouldClearOldSession,
    trustedHeadersChanged: sessionResult.trustedHeadersChanged,
  };
}
