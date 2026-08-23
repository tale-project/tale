/**
 * Global recovery from a dead active organization.
 *
 * A client whose persisted active org was deleted (or whose org context is
 * an empty/garbage id — a stale demo tab) keeps firing org-scoped queries
 * that can only ever fail: the server classifies them as `ConvexError`
 * `code: 'ORG_NOT_FOUND'` (`lib/rls/organization/get_organization_member.ts`,
 * `lib/auth/require_org_membership.ts`, `lib/helpers/org_slug.ts`). Observed
 * as a month of weekly `listAgents` / `readBranding` / `listProviders` error
 * bursts from one user in GlitchTip — the session never healed on its own.
 *
 * Wired as the query cache's global `onError` (app/router.tsx): on the first
 * dead-org failure it clears every client hint that would rehydrate the dead
 * org, then routes back through `/dashboard/` — whose index re-resolves a
 * valid membership (or the create-organization wizard) and re-persists it.
 *
 * Deliberately NOT triggered by `ORG_FORBIDDEN` (org exists, caller isn't a
 * member): the dashboard layout renders the intentional "you've been removed"
 * AccessDenied screen for that state (see routes/dashboard/$id.tsx), and a
 * structured ConvexError is never retried, so forbidden states don't loop.
 */

import { convexErrorCode } from '@/app/hooks/use-action-query';
import { clearMemberContextCache } from '@/app/lib/member-context-cache';
import { authClient } from '@/lib/auth-client';

/** True when a query failed because its organization no longer exists. */
export function isDeadOrgError(error: unknown): boolean {
  return convexErrorCode(error) === 'ORG_NOT_FOUND';
}

/**
 * One recovery per window: a dead org fails every org-scoped query on the
 * page at once (sidebar, branding, policy, …), and each failure lands here.
 */
const RECOVERY_THROTTLE_MS = 10_000;
let lastRecoveryAt: number | null = null;

/** Test-only: forget the throttle so each test observes a fresh recovery. */
export function resetOrgErrorRecoveryForTests(): void {
  lastRecoveryAt = null;
}

/**
 * Query-cache `onError` hook. Fire-and-forget: react-query's error handling
 * (error states, boundaries) proceeds regardless; this only heals the session
 * in the background.
 */
export function handleOrgScopedQueryError(error: unknown): void {
  if (!isDeadOrgError(error)) return;
  const now = Date.now();
  if (lastRecoveryAt !== null && now - lastRecoveryAt < RECOVERY_THROTTLE_MS) {
    return;
  }
  lastRecoveryAt = now;
  void recoverFromDeadOrg();
}

async function recoverFromDeadOrg(): Promise<void> {
  // Drop the client-side hint that would instantly rehydrate the dead org's
  // shell on the next dashboard load.
  clearMemberContextCache();

  // Dynamic import: this module is created BY app/router.tsx, so a static
  // import would be a cycle (same pattern as branding-provider.tsx).
  const { router, queryClient } = await import('@/app/router');

  // Leave the dead org's routes for the picker, which re-resolves a valid
  // membership. Only when actually inside an org's dashboard subtree —
  // recovery must not yank a user out of the picker or the login shell.
  const insideOrgDashboard = router.state.matches.some((match) =>
    match.routeId.startsWith('/dashboard/$id'),
  );
  if (insideOrgDashboard) {
    void router.navigate({ to: '/dashboard', replace: true });
  }

  // Clear the session's persisted active org so every consumer (other tabs,
  // the next login) stops resolving to it. Best-effort: /dashboard/ validates
  // the session org against live memberships anyway.
  try {
    await authClient.organization.setActive({ organizationId: null });
  } catch (err) {
    console.warn(
      '[org-error-recovery] failed to clear the session active org',
      err instanceof Error ? err.message : err,
    );
  }
  await queryClient
    .invalidateQueries({ queryKey: ['auth', 'session'] })
    .catch((err: unknown) => {
      console.warn(
        '[org-error-recovery] failed to refresh the session cache',
        err instanceof Error ? err.message : err,
      );
    });
}
