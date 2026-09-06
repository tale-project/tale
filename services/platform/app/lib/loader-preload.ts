import {
  activeOrganizationId,
  READ_ADAPTERS,
} from '@/app/lib/backend/adapters';
import type { ArgsOf, QueryName } from '@/app/lib/backend/contract';
import { MissingBackendRowError } from '@/app/lib/backend/missing-row';
import type { RouterContext } from '@/app/router';
import { AppError } from '@/lib/shared/errors/app-error';
import type { PolicyType } from '@/lib/shared/schemas/governance';

type QueryArgs<Name extends QueryName> =
  Record<string, never> extends ArgsOf<Name>
    ? [args?: ArgsOf<Name>]
    : [args: ArgsOf<Name>];

/**
 * Await a small, render-gating read in a route loader — it warms the SAME
 * react-query entry the component's hook reads, so the first paint has the
 * answer already (no client loading flash).
 *
 * Use ONLY for bounded data that decides what renders (access/member context,
 * the entity that gates content vs. an empty/denied state). Never await a list
 * or unbounded query — blocking the transition is worse than the skeleton.
 */
export function ensureConvexQuery<Name extends QueryName>(
  context: RouterContext,
  name: Name,
  ...[args]: QueryArgs<Name>
) {
  const adapter = READ_ADAPTERS[name];
  if (adapter !== undefined) {
    const organizationId = activeOrganizationId();
    const adapted = adapter(
      args ?? {},
      organizationId !== undefined ? { organizationId } : {},
    );
    if (adapted === null) return Promise.resolve(undefined);
    return context.queryClient.ensureQueryData({
      queryKey: adapted.queryKey,
      queryFn: adapted.queryFn,
    });
  }
  // A render-gating read with no row cannot degrade quietly: the route would
  // paint its denied/empty state as if that were the answer.
  throw new MissingBackendRowError(name);
}

/**
 * A render-gating read can reject during the brief pre-auth window (the Convex
 * client has not attached the auth token yet), which surfaces as an
 * `UNAUTHENTICATED` AppError. The reactive subscription re-runs the moment
 * auth lands, so this case is expected, not a preload failure worth logging —
 * anything else propagates to the caller for diagnostics.
 */
function isPreAuthError(error: unknown): boolean {
  if (!(error instanceof AppError)) return false;
  const data: unknown = error.data;
  return (
    typeof data === 'object' &&
    data !== null &&
    'code' in data &&
    data.code === 'UNAUTHENTICATED'
  );
}

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
  policyTypes: readonly PolicyType[],
) {
  return Promise.all(
    policyTypes.map((policyType) =>
      ensureConvexQuery(context, 'governance/queries:getPolicy', {
        organizationId,
        policyType,
      }).catch((error: unknown) => {
        // Pre-auth rejections are expected and self-heal via the reactive
        // subscription; swallow them so they never reach the caller's warning
        // log. Real errors still propagate.
        if (isPreAuthError(error)) return undefined;
        throw error;
      }),
    ),
  );
}
