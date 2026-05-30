import { convexQuery } from '@convex-dev/react-query';
import type { FunctionArgs, FunctionReference } from 'convex/server';

import type { RouterContext } from '@/app/router';
import { api } from '@/convex/_generated/api';
import type { GOVERNANCE_POLICY_TYPES } from '@/convex/governance/schema';

type QueryArgs<Func extends FunctionReference<'query'>> =
  keyof FunctionArgs<Func> extends never
    ? [args?: FunctionArgs<Func>]
    : [args: FunctionArgs<Func>];

/**
 * Await a small, render-gating Convex query in a route loader. Resolves on the
 * first WebSocket result, warms the React Query cache (so the component reads it
 * warm — no client loading flash), and leaves the live subscription in place.
 *
 * Use ONLY for bounded data that decides what renders (access/member context,
 * the entity that gates content vs. an empty/denied state). Never await a list
 * or unbounded query — blocking the transition is worse than the skeleton.
 */
export function ensureConvexQuery<Func extends FunctionReference<'query'>>(
  context: RouterContext,
  func: Func,
  ...[args]: QueryArgs<Func>
) {
  return context.queryClient.ensureQueryData(convexQuery(func, args ?? {}));
}

type GovernancePolicyType = (typeof GOVERNANCE_POLICY_TYPES)[number];

/**
 * Warm every governance policy a settings page reads, in parallel, from its
 * route `loader`. Each is a bounded single-row `getPolicy` read, so awaiting
 * the lot costs ~one round-trip on the already-open socket — and in exchange
 * the page's skeleton-aware editors render their REAL content on first paint
 * (no skeleton flash, no staggered reveal). The `RouteProgressBar` covers the
 * brief loader wait. Always `.catch` at the call site so a transient/auth
 * error never fails the transition — the editors' own loading + access checks
 * still render correctly.
 */
export function ensureGovernancePolicies(
  context: RouterContext,
  organizationId: string,
  policyTypes: readonly GovernancePolicyType[],
) {
  return Promise.all(
    policyTypes.map((policyType) =>
      ensureConvexQuery(context, api.governance.queries.getPolicy, {
        organizationId,
        policyType,
      }),
    ),
  );
}
