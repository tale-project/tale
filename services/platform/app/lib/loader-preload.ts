import {
  isPolicyReadableByMember,
  type PolicyType,
} from '@tale/shared/schemas/governance';

import {
  activeOrganizationId,
  projectAdaptedRead,
  READ_ADAPTERS,
  retryAdaptedRead,
  runAdapted,
} from '@/app/lib/backend/adapters';
import type { ArgsOf, QueryName } from '@/app/lib/backend/contract';
import { MissingBackendRowError } from '@/app/lib/backend/missing-row';
import {
  memberContextQuery,
  type MemberContextView,
} from '@/app/lib/backend/org';
import type { RouterContext } from '@/app/router';
import { defineAbilityFor, type AppAbility } from '@/lib/permissions/ability';
import { AppError } from '@/lib/shared/errors/app-error';

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
    // The same lane as the component's hook and the non-blocking prefetch:
    // a 4xx is normalized to a structured `AppError` and never retried. The
    // raw `queryFn` used to ride the router's default retry, which cannot
    // tell a bare 403 from a transport fault — a member deep-linking an
    // admin page sat on the skeleton through three back-offs (~10 s)
    // before the denied state (2026-09-26 evaluation, E-05).
    return context.queryClient
      .ensureQueryData({
        queryKey: adapted.queryKey,
        queryFn: () => runAdapted(adapted.queryFn),
        ...(adapted.staleTime !== undefined
          ? { staleTime: adapted.staleTime }
          : {}),
        retry: retryAdaptedRead,
      })
      .then((data) => projectAdaptedRead(adapted, data));
  }
  // A render-gating read with no row cannot degrade quietly: the route would
  // paint its denied/empty state as if that were the answer.
  throw new MissingBackendRowError(name);
}

function abilityOf(memberContext: MemberContextView): AppAbility {
  return defineAbilityFor(
    memberContext?.status === 'ok' ? memberContext.role : null,
  );
}

/**
 * The caller's ability in one organization, when the dashboard route's
 * member-context read has already settled in the cache — null while it
 * has not (a cold deep link), in which case a loader must not guess.
 */
export function cachedAbility(
  context: RouterContext,
  organizationId: string,
): AppAbility | null {
  const cached = context.queryClient.getQueryData<MemberContextView>(
    memberContextQuery(organizationId).queryKey,
  );
  if (cached === undefined || cached === null) return null;
  return abilityOf(cached);
}

/**
 * {@link ensureConvexQuery} for a read only an organization admin may make
 * (`read orgSettings`): when the cached member context already says the
 * caller cannot, the loader resolves at once and the page paints its
 * denied state — instead of awaiting a 403 the server was always going
 * to answer.
 */
export function ensureOrgSettingsQuery<Name extends QueryName>(
  context: RouterContext,
  organizationId: string,
  name: Name,
  ...args: QueryArgs<Name>
) {
  const ability = cachedAbility(context, organizationId);
  if (ability !== null && ability.cannot('read', 'orgSettings')) {
    return Promise.resolve(undefined);
  }
  return ensureConvexQuery(context, name, ...args);
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
 * Which governance policies a settings loader may ask for (#3098). The
 * governance pages are admin-only (`read orgSettings`), so once the member
 * context has settled the answer is all or nothing. On a cold deep link it
 * has not: TanStack runs the dashboard's loader, which starts that read,
 * beside the page's. A policy any member may read then warms at once, and
 * an admin-only one waits for the caller's role, joining the dashboard's
 * read in flight rather than asking twice. So a member's visit never asks
 * for a policy the server refuses them. A member-context read that fails
 * rejects the admin-only reads with its error, for the caller to log.
 */
function governancePolicyGate(
  context: RouterContext,
  organizationId: string,
): (policyType: PolicyType) => boolean | Promise<boolean> {
  const cached = cachedAbility(context, organizationId);
  if (cached !== null) {
    const canRead = cached.can('read', 'orgSettings');
    return () => canRead;
  }
  let adminGate: Promise<boolean> | undefined;
  return (policyType) => {
    if (isPolicyReadableByMember(policyType)) return true;
    adminGate ??= context.queryClient
      .ensureQueryData(memberContextQuery(organizationId))
      .then((memberContext) =>
        abilityOf(memberContext).can('read', 'orgSettings'),
      );
    return adminGate;
  };
}

/**
 * Warm every governance policy a settings page reads, in parallel, from its
 * route `loader`. Each is a bounded single-row `getPolicy` read, so awaiting
 * the lot costs ~one round-trip on the already-open socket — and in exchange
 * the page's skeleton-aware editors render their REAL content on first paint
 * (no skeleton flash, no staggered reveal). The `RouteProgressBar` covers the
 * brief loader wait. Only what the caller may read is asked for
 * ({@link governancePolicyGate}); a skipped policy resolves `undefined`.
 * Always `.catch` at the call site so a transient/auth error never fails the
 * transition — the editors' own loading + access checks still render
 * correctly.
 */
export function ensureGovernancePolicies(
  context: RouterContext,
  organizationId: string,
  policyTypes: readonly PolicyType[],
) {
  const mayRead = governancePolicyGate(context, organizationId);
  return Promise.all(
    policyTypes.map(async (policyType) => {
      if (!(await mayRead(policyType))) return undefined;
      return ensureConvexQuery(context, 'governance/queries:getPolicy', {
        organizationId,
        policyType,
      }).catch((error: unknown) => {
        // Pre-auth rejections are expected and self-heal via the reactive
        // subscription; swallow them so they never reach the caller's warning
        // log. Real errors still propagate.
        if (isPreAuthError(error)) return undefined;
        throw error;
      });
    }),
  );
}
