/**
 * Request-scoped memoization of the caller's auth context.
 *
 * The RLS wrappers (`queryWithRLS`/`mutationWithRLS`) and many handlers all
 * derive the same `{ user, userOrganizations }` pair. Each derivation can cost
 * a cross-component Better Auth `findMany` round-trip (`getUserOrganizations`),
 * which dominates backend latency.
 *
 * Team IDs are deliberately NOT resolved here: only the few team-scoped tables
 * in `rlsRules` consult them, so that lookup is resolved lazily (and memoized)
 * inside `rlsRules` and skipped entirely by the majority of queries.
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
}

// Keyed on the per-request `ctx.auth` object so the cache is request-scoped and
// GC'd with the request. WeakMap requires an object key; `ctx.auth` is stable
// for the lifetime of a single function execution.
const cache = new WeakMap<object, Promise<RequestAuthContext>>();

async function computeRequestAuthContext(
  ctx: QueryCtx | MutationCtx,
): Promise<RequestAuthContext> {
  // JWT identity (0 DB). The org lookup may hit the Better Auth component
  // unless a JWT-claim short-circuit applies.
  const user = await getAuthUserIdentity(ctx);
  const userOrganizations = user ? await getUserOrganizations(ctx, user) : [];
  return { user, userOrganizations };
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
