/**
 * Request-scoped memoization of the caller's auth context.
 *
 * The RLS wrappers (`queryWithRLS`/`mutationWithRLS`) and many handlers all
 * derive the same `{ user, userOrganizations, userTeamIds }` triple. Each
 * derivation can cost cross-component Better Auth `findMany` round-trips
 * (`getUserOrganizations`, `getUserTeamIds`), which dominate backend latency.
 *
 * A single Convex function execution shares one `ctx` (and therefore one
 * `ctx.auth` reference — preserved across the convex-helpers `customCtx`
 * merge). Keying a module-level `WeakMap` on `ctx.auth` lets the wrapper and
 * any helper invoked inside the same execution reuse a single computation.
 * Because executions are single-shot and the key is the per-request `auth`
 * object, entries are released as soon as the request is collected.
 */

import type { MemberRole } from '../../../../lib/shared/schemas/organizations';
import type { QueryCtx, MutationCtx } from '../../../_generated/server';
import { getUserTeamIds } from '../../get_user_teams';
import { getAuthUserIdentity } from '../auth/get_auth_user_identity';
import { getUserOrganizations } from '../organization/get_user_organizations';
import type { AuthenticatedUser, OrganizationMember } from '../types';

export interface RequestAuthContext {
  user: AuthenticatedUser | null;
  userOrganizations: Array<{
    organizationId: string;
    role: MemberRole;
    member: OrganizationMember;
  }>;
  userTeamIds: Set<string>;
}

// Keyed on the per-request `ctx.auth` object so the cache is request-scoped and
// GC'd with the request. WeakMap requires an object key; `ctx.auth` is stable
// for the lifetime of a single function execution.
const cache = new WeakMap<object, Promise<RequestAuthContext>>();

async function computeRequestAuthContext(
  ctx: QueryCtx | MutationCtx,
): Promise<RequestAuthContext> {
  // JWT identity (0 DB). Org + team lookups run in parallel; each may hit the
  // Better Auth component unless a JWT-claim short-circuit applies.
  const user = await getAuthUserIdentity(ctx);
  const [userOrganizations, userTeamIds] = user
    ? await Promise.all([
        getUserOrganizations(ctx, user),
        getUserTeamIds(ctx, user.userId).then((ids) => new Set(ids)),
      ])
    : [[], new Set<string>()];
  return { user, userOrganizations, userTeamIds };
}

/**
 * Resolve (and memoize for the rest of this request) the caller's auth
 * context. Safe to call from the RLS wrappers and from any handler that also
 * needs the user/org/team triple — the first caller pays the cost, the rest
 * reuse the in-flight promise.
 */
export function getRequestAuthContext(
  ctx: QueryCtx | MutationCtx,
): Promise<RequestAuthContext> {
  const key: object = ctx.auth;
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }
  const computed = computeRequestAuthContext(ctx);
  cache.set(key, computed);
  return computed;
}
